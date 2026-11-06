use crate::reflection_ai::{parse_epilogue, serialize_payload, ReflectionEpilogue, SanitizedReflectionPayload, SYSTEM_PROMPT};
use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use reqwest::{redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use std::{fs, net::IpAddr, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::Manager;

pub const LOCAL_AI_URL: &str = "http://127.0.0.1:11434/v1/chat/completions";
const CONFIG_FILE: &str = "ai-endpoint.json";
const CONFIG_ERROR: &str = "无法读取 AI 本机设置，请重新保存设置。";
const KEY_ERROR: &str = "系统凭据库中没有此服务的有效密钥，请重新保存密钥。";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiEndpointMode { #[default] Disabled, Local, Cloud }

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiEndpointConfig {
    pub mode: AiEndpointMode,
    pub base_url: String,
    pub endpoint_url: String,
    pub model: String,
    pub revision: u64,
    pub has_api_key: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiEndpointSettingsInput {
    pub mode: AiEndpointMode,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SecretRecord { endpoint_url: String, api_key: String }

trait CredentialStore {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}
struct SystemCredentials;
impl CredentialStore for SystemCredentials {
    fn read(&self) -> Result<Option<String>, String> { crate::ai_credentials::read() }
    fn write(&self, value: &str) -> Result<(), String> { crate::ai_credentials::write(value) }
    fn delete(&self) -> Result<(), String> { crate::ai_credentials::delete() }
}

#[derive(Default)]
pub struct AiRuntime {
    settings: Mutex<()>,
    active: Mutex<Option<(String, AbortHandle)>>,
}
impl AiRuntime {
    fn begin(&self, id: &str) -> Result<AbortRegistration, String> {
        if id.is_empty() || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err("请求标识无效，请重新打开授权面板。".into());
        }
        let mut active = self.active.lock().map_err(|_| CONFIG_ERROR)?;
        if active.is_some() { return Err("已有按语请求正在进行，请先取消或等待完成。".into()); }
        let (handle, registration) = AbortHandle::new_pair();
        *active = Some((id.into(), handle));
        Ok(registration)
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| CONFIG_ERROR)?;
        if active.as_ref().is_some_and(|(current, _)| current == id) {
            if let Some((_, handle)) = active.take() { handle.abort(); }
        }
        Ok(())
    }
    fn finish(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if active.as_ref().is_some_and(|(current, _)| current == id) { active.take(); }
        }
    }
}
struct RequestGuard<'a> { runtime: &'a AiRuntime, id: String }
impl Drop for RequestGuard<'_> { fn drop(&mut self) { self.runtime.finish(&self.id); } }

fn endpoint(mode: AiEndpointMode, input: &str) -> Result<String, String> {
    let error = "请输入有效的 OpenAI 兼容服务地址；本机模式仅允许回环地址，云端模式使用 HTTPS。";
    let mut url = Url::parse(input.trim()).map_err(|_| error.to_owned())?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("服务地址不能包含用户名、密码、查询参数或片段。".into());
    }
    if !matches!(url.scheme(), "http" | "https") { return Err(error.into()); }
    if mode == AiEndpointMode::Local {
        let host = url.host_str().ok_or(error)?.to_owned();
        if host.eq_ignore_ascii_case("localhost") {
            url.set_host(Some("127.0.0.1")).map_err(|_| error)?;
        } else if !host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()) {
            return Err(error.into());
        }
    } else if mode != AiEndpointMode::Cloud || url.scheme() != "https" || url.host_str().is_none() {
        return Err(error.into());
    }
    let path = url.path().trim_end_matches('/');
    let path = if path.ends_with("/chat/completions") { path.to_owned() }
        else { format!("{path}/chat/completions") };
    url.set_path(&path);
    Ok(url.to_string())
}

fn validate_model(model: &str) -> Result<(), String> {
    if model.is_empty() || model.chars().count() > 200 || model.chars().any(char::is_control)
        || model.starts_with('/') || model.starts_with("~/") || model.starts_with("./") || model.starts_with("../")
        || model.to_ascii_lowercase().starts_with("file:") || model.contains('\\') || model.to_ascii_lowercase().contains(".md")
        || (model.as_bytes().get(1) == Some(&b':') && model.as_bytes().get(2) == Some(&b'/')) {
        Err("请填写模型名称，不要填写文件路径。".into())
    } else { Ok(()) }
}

fn load_config(path: &Path) -> Result<AiEndpointConfig, String> {
    let config: AiEndpointConfig = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| CONFIG_ERROR)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(AiEndpointConfig::default()),
        Err(_) => return Err(CONFIG_ERROR.into()),
    };
    if config.mode == AiEndpointMode::Disabled {
        if config.has_api_key || !config.base_url.is_empty() || !config.endpoint_url.is_empty() || !config.model.is_empty() {
            return Err(CONFIG_ERROR.into());
        }
    } else {
        if endpoint(config.mode, &config.base_url)? != config.endpoint_url { return Err(CONFIG_ERROR.into()); }
        validate_model(&config.model)?;
        if config.mode == AiEndpointMode::Local && config.has_api_key { return Err(CONFIG_ERROR.into()); }
    }
    Ok(config)
}

fn save_config_with(
    path: &Path, store: &impl CredentialStore, input: AiEndpointSettingsInput,
    commit: impl FnOnce(&Path, &[u8]) -> Result<(), String>,
) -> Result<AiEndpointConfig, String> {
    let previous = load_config(path)?;
    let mut next = AiEndpointConfig { mode: input.mode, revision: previous.revision.checked_add(1).ok_or(CONFIG_ERROR)?, ..Default::default() };
    if input.mode != AiEndpointMode::Disabled {
        next.base_url = input.base_url.trim().to_owned();
        if next.mode == AiEndpointMode::Local && next.base_url.is_empty() { next.base_url = LOCAL_AI_URL.into(); }
        next.endpoint_url = endpoint(next.mode, &next.base_url)?;
        next.model = input.model.trim().to_owned();
        validate_model(&next.model)?;
    }
    let key = input.api_key.filter(|value| !value.trim().is_empty());
    if let Some(key) = &key {
        if key.len() > 4096 || key.chars().any(char::is_control) { return Err("密钥格式无效，请重新输入。".into()); }
    }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|_| CONFIG_ERROR)?; }
    let must_change_key = previous.has_api_key || (next.mode == AiEndpointMode::Cloud && key.is_some());
    let old_secret = if must_change_key { store.read()? } else { None };
    let next_secret = if next.mode == AiEndpointMode::Cloud {
        let secret = if let Some(key) = key {
            SecretRecord { endpoint_url: next.endpoint_url.clone(), api_key: key.trim().to_owned() }
        } else {
            if previous.mode != AiEndpointMode::Cloud || previous.endpoint_url != next.endpoint_url {
                return Err("更换服务地址后，请重新输入该服务的密钥。".into());
            }
            let record: SecretRecord = serde_json::from_str(old_secret.as_deref().ok_or(KEY_ERROR)?).map_err(|_| KEY_ERROR)?;
            if record.endpoint_url != next.endpoint_url { return Err(KEY_ERROR.into()); }
            record
        };
        next.has_api_key = true;
        Some(serde_json::to_string(&secret).map_err(|_| CONFIG_ERROR)?)
    } else { None };
    for value in [old_secret.as_deref(), next_secret.as_deref()].into_iter().flatten() {
        if let Ok(record) = serde_json::from_str::<SecretRecord>(value) {
            if record.api_key.len() >= 8 && [&next.base_url, &next.endpoint_url, &next.model].iter().any(|text| text.contains(&record.api_key)) {
                return Err("请仅在密钥栏填写 API Key，不要放入服务地址或模型名称。".into());
            }
        }
    }
    let bytes = serde_json::to_vec_pretty(&next).map_err(|_| CONFIG_ERROR)?;
    if must_change_key || next.mode == AiEndpointMode::Cloud {
        match &next_secret { Some(secret) => store.write(secret)?, None => store.delete()? }
    }
    if let Err(error) = commit(path, &bytes) {
        let restored = if must_change_key || next.mode == AiEndpointMode::Cloud {
            match old_secret { Some(secret) => store.write(&secret), None => store.delete() }
        } else { Ok(()) };
        return if restored.is_err() { Err("设置未保存，系统凭据恢复失败，请在系统凭据库中检查 Silens 项目。".into()) }
            else { Err(error) };
    }
    Ok(next)
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|_| CONFIG_ERROR)?.join(CONFIG_FILE))
}

#[tauri::command]
pub async fn get_ai_endpoint_config(app: tauri::AppHandle) -> Result<AiEndpointConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AiRuntime>();
        let _guard = state.settings.lock().map_err(|_| CONFIG_ERROR)?;
        load_config(&config_path(&app)?)
    }).await.map_err(|_| CONFIG_ERROR.to_owned())?
}

#[tauri::command]
pub async fn save_ai_endpoint_config(app: tauri::AppHandle, input: AiEndpointSettingsInput) -> Result<AiEndpointConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AiRuntime>();
        let _guard = state.settings.lock().map_err(|_| CONFIG_ERROR)?;
        let saved = save_config_with(&config_path(&app)?, &SystemCredentials, input, |path, bytes|
            crate::atomic_write(path, bytes).map_err(|_| "无法保存 AI 本机设置。".into()))?;
        if let Some((_, handle)) = state.active.lock().map_err(|_| CONFIG_ERROR)?.take() { handle.abort(); }
        Ok(saved)
    }).await.map_err(|_| CONFIG_ERROR.to_owned())?
}

fn authorized_key(store: &impl CredentialStore, stored: &AiEndpointConfig, approved: &AiEndpointConfig) -> Result<Option<String>, String> {
    if stored != approved { return Err("AI 设置已改变，请重新查看预览并授权。".into()); }
    if stored.mode == AiEndpointMode::Cloud {
        if !stored.has_api_key { return Err(KEY_ERROR.into()); }
        let record: SecretRecord = serde_json::from_str(&store.read()?.ok_or(KEY_ERROR)?).map_err(|_| KEY_ERROR)?;
        if record.endpoint_url != stored.endpoint_url || record.api_key.is_empty() { return Err(KEY_ERROR.into()); }
        Ok(Some(record.api_key))
    } else { Ok(None) }
}

fn request_body(payload: &SanitizedReflectionPayload, config: &AiEndpointConfig) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({"model": config.model, "messages": [
        {"role":"system","content":SYSTEM_PROMPT},
        {"role":"user","content":serialize_payload(payload)?}
    ], "stream":false,"temperature":0.6,"max_tokens":768}))
}

fn contains_secret(value: &serde_json::Value, key: &str) -> bool {
    match value {
        serde_json::Value::String(text) => text.contains(key),
        serde_json::Value::Array(values) => values.iter().any(|value| contains_secret(value, key)),
        serde_json::Value::Object(fields) => fields.values().any(|value| contains_secret(value, key)),
        _ => false,
    }
}

async fn send_once(payload: &SanitizedReflectionPayload, config: &AiEndpointConfig, key: Option<&str>, timeout: Duration) -> Result<ReflectionEpilogue, String> {
    let body = request_body(payload, config)?;
    if let Some(key) = key.filter(|key| !key.is_empty()) {
        let data = serde_json::to_value(payload).map_err(|_| CONFIG_ERROR)?;
        if config.model.contains(key) || contains_secret(&data, key) {
            return Err("摘要中可能含有当前凭据，请更换摘录后重新预览。".into());
        }
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder().timeout(timeout).redirect(Policy::none())
        .retry(reqwest::retry::never()).no_proxy().referer(false).build().map_err(|_| "无法建立按语连接。")?;
    let mut request = client.post(&config.endpoint_url).json(&body);
    if config.mode == AiEndpointMode::Cloud {
        request = request.bearer_auth(key.ok_or(KEY_ERROR)?);
    }
    let network_error = |error: reqwest::Error| if error.is_timeout() { "等待按语超过 30 秒，请稍后重新授权。".to_owned() }
        else if config.mode == AiEndpointMode::Local { "无法连接本机模型，请检查本地服务和模型名称。".into() }
        else { "未能完成云端请求，请检查服务地址与网络后重新授权。".into() };
    let mut response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "服务拒绝授权，请检查密钥与模型权限。",
            429 => "服务暂时繁忙，请稍后重新授权。",
            300..=399 => "接口返回重定向，未转发摘要；请直接配置最终接口地址。",
            _ => "服务未能完成请求，请检查接口与模型名称。",
        }.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > 65_536 { return Err("模型响应过长，请检查接口设置。".into()); }
        bytes.extend_from_slice(&chunk);
    }
    #[derive(Deserialize)] struct Completion { choices: Vec<Choice> }
    #[derive(Deserialize)] struct Choice { message: Message }
    #[derive(Deserialize)] struct Message { content: String }
    let completion: Completion = serde_json::from_slice(&bytes).map_err(|_| "模型返回的响应格式无效，请重新授权。")?;
    let content = &completion.choices.first().ok_or("模型没有返回按语，请重新授权。")?.message.content;
    let result = parse_epilogue(content)?;
    if key.is_some_and(|key| !key.is_empty() && (result.poetic_title.contains(key) || result.epilogue.contains(key))) {
        return Err("模型响应可能含有凭据，已停止展示，请检查服务设置。".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn generate_reflection_epilogue(
    app: tauri::AppHandle, payload: SanitizedReflectionPayload, config: AiEndpointConfig, request_id: String,
) -> Result<ReflectionEpilogue, String> {
    serialize_payload(&payload)?;
    if config.mode == AiEndpointMode::Disabled { return Err("请先配置 AI 拾遗伴侣。".into()); }
    let state = app.state::<AiRuntime>();
    let registration = state.begin(&request_id)?;
    let _guard = RequestGuard { runtime: &state, id: request_id };
    let operation = async {
        let source = app.clone();
        let approved = config.clone();
        let key = tauri::async_runtime::spawn_blocking(move || {
            let runtime = source.state::<AiRuntime>();
            let _guard = runtime.settings.lock().map_err(|_| CONFIG_ERROR)?;
            let stored = load_config(&config_path(&source)?)?;
            authorized_key(&SystemCredentials, &stored, &approved)
        }).await.map_err(|_| CONFIG_ERROR.to_owned())??;
        send_once(&payload, &config, key.as_deref(), Duration::from_secs(30)).await
    };
    Abortable::new(operation, registration).await.map_err(|_| "按语请求已取消。".to_owned())?
}

#[tauri::command]
pub fn cancel_reflection_epilogue(app: tauri::AppHandle, request_id: String) -> Result<(), String> {
    app.state::<AiRuntime>().cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, io::{Read, Write}, net::TcpListener, sync::{Arc, atomic::{AtomicUsize, Ordering}}};

    #[derive(Default)] struct FakeStore(RefCell<Option<String>>);
    impl CredentialStore for FakeStore {
        fn read(&self) -> Result<Option<String>, String> { Ok(self.0.borrow().clone()) }
        fn write(&self, value: &str) -> Result<(), String> { *self.0.borrow_mut() = Some(value.into()); Ok(()) }
        fn delete(&self) -> Result<(), String> { *self.0.borrow_mut() = None; Ok(()) }
    }
    fn path() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("silens-ai-test-{}", crate::unique_suffix()));
        fs::create_dir(&dir).unwrap();
        dir.join(CONFIG_FILE)
    }
    fn save(path: &Path, store: &FakeStore, mode: AiEndpointMode, base: &str, key: Option<&str>) -> AiEndpointConfig {
        save_config_with(path, store, AiEndpointSettingsInput { mode, base_url: base.into(), model: "test-model".into(), api_key: key.map(str::to_owned) },
            |path, bytes| crate::atomic_write(path, bytes)).unwrap()
    }
    fn payload() -> SanitizedReflectionPayload {
        serde_json::from_value(serde_json::json!({"period_label":"本月","perspective_label":"全部", "rhythm_summary":{
            "active_days":1,"daily_blocks":2,"titled_articles":0,"untagged_blocks":1,"favorite_time":null},
            "top_works":[],"brewed_articles":[],"sampled_snippets":["窗外的光慢慢落在纸上。"]})).unwrap()
    }
    #[test]
    fn local_endpoint_is_loopback_only_and_cloud_requires_https() {
        assert_eq!(endpoint(AiEndpointMode::Local, LOCAL_AI_URL).unwrap(), LOCAL_AI_URL);
        assert_eq!(endpoint(AiEndpointMode::Local, "http://localhost:11434/v1").unwrap(), LOCAL_AI_URL);
        assert!(endpoint(AiEndpointMode::Local, "http://[::1]:11434/v1").unwrap().contains("[::1]"));
        for url in ["http://192.168.1.2/v1", "https://example.com/v1", "http://localhost.evil/v1", "file:///tmp/model", "http://user:pass@127.0.0.1/v1", "http://127.0.0.1/v1?key=secret", "http://127.0.0.1/v1#x"] {
            assert!(endpoint(AiEndpointMode::Local, url).is_err());
        }
        assert!(endpoint(AiEndpointMode::Cloud, "http://example.com/v1").is_err());
        assert_eq!(endpoint(AiEndpointMode::Cloud, "https://example.com/v1/").unwrap(), "https://example.com/v1/chat/completions");
        for model in ["/Users/private/model", "C:/Users/private/model", "PRIVATE.MD", "FILE:///tmp/model", "../model"] {
            assert!(validate_model(model).is_err());
        }
    }
    #[test]
    fn credentials_are_separate_bound_and_erased_on_mode_changes() {
        let path = path(); let store = FakeStore::default();
        assert_eq!(load_config(&path).unwrap().mode, AiEndpointMode::Disabled);
        let first = save(&path, &store, AiEndpointMode::Cloud, "https://example.com/v1", Some("test-secret"));
        assert!(first.has_api_key);
        assert!(!fs::read_to_string(&path).unwrap().contains("test-secret"));
        let leaked_model = save_config_with(&path, &store, AiEndpointSettingsInput {mode:AiEndpointMode::Cloud,
            base_url:first.base_url.clone(),model:"test-secret".into(),api_key:None}, crate::atomic_write);
        assert!(leaked_model.is_err());
        assert!(!fs::read_to_string(&path).unwrap().contains("test-secret"));
        let failed = save_config_with(&path, &store, AiEndpointSettingsInput { mode: AiEndpointMode::Cloud, base_url:"https://other.example/v1".into(),model:"test".into(),api_key:None }, crate::atomic_write);
        assert!(failed.is_err()); assert_eq!(load_config(&path).unwrap(), first);
        let previous = store.0.borrow().clone();
        let failed = save_config_with(&path, &store, AiEndpointSettingsInput { mode: AiEndpointMode::Cloud,base_url:first.base_url.clone(),model:"new-model".into(),api_key:Some("replacement".into()) }, |_, _| Err("disk failure".into()));
        assert!(failed.is_err()); assert_eq!(*store.0.borrow(), previous);
        let local = save(&path, &store, AiEndpointMode::Local, LOCAL_AI_URL, None);
        assert!(!local.has_api_key); assert!(store.0.borrow().is_none());
        save(&path, &store, AiEndpointMode::Cloud, "https://example.com/v1", Some("another-secret"));
        let disabled = save(&path, &store, AiEndpointMode::Disabled, "", None);
        assert!(disabled.model.is_empty() && disabled.endpoint_url.is_empty() && !disabled.has_api_key);
        assert!(store.0.borrow().is_none());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn canonical_preview_is_exact_user_message_and_prompt_is_fixed() {
        let config = AiEndpointConfig { model: "test-model".into(), ..Default::default() };
        let body = request_body(&payload(), &config).unwrap();
        assert_eq!(body["messages"][1]["content"], serialize_payload(&payload()).unwrap());
        assert_eq!(body["messages"][0]["content"], SYSTEM_PROMPT);
        assert!(body.get("apiKey").is_none() && body.get("requestId").is_none());
    }
    #[test]
    fn authorization_is_bound_to_revision_endpoint_and_key_presence() {
        let path = path();
        let store = FakeStore::default();
        let stored = save(&path, &store, AiEndpointMode::Cloud, "https://example.com/v1", Some("test-secret"));
        assert_eq!(authorized_key(&store, &stored, &stored).unwrap().as_deref(), Some("test-secret"));
        let mut changed = stored.clone(); changed.revision += 1;
        assert!(authorized_key(&store, &stored, &changed).is_err());
        store.write(&serde_json::to_string(&SecretRecord {endpoint_url:"https://other.example/v1/chat/completions".into(),api_key:"test-secret".into()}).unwrap()).unwrap();
        assert!(authorized_key(&store, &stored, &stored).is_err());
        let mut no_key = stored.clone(); no_key.has_api_key = false;
        assert!(authorized_key(&store, &no_key, &no_key).is_err());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn copied_api_credentials_are_rejected_before_any_connection() {
        let mut data = payload(); data.sampled_snippets = vec!["误贴的 test-secret 请隐藏。".into()];
        let config = AiEndpointConfig {mode:AiEndpointMode::Cloud,endpoint_url:"https://example.com/v1/chat/completions".into(),model:"test".into(),..Default::default()};
        let error = tauri::async_runtime::block_on(send_once(&data, &config, Some("test-secret"), Duration::from_secs(1))).unwrap_err();
        assert!(error.contains("凭据") && !error.contains("test-secret"));
    }
    #[test]
    fn cancellation_does_not_clear_a_new_request() {
        let state = AiRuntime::default();
        let first = state.begin("first").unwrap();
        assert!(state.begin("second").is_err());
        state.cancel("not-first").unwrap(); assert!(state.begin("second").is_err());
        state.cancel("first").unwrap();
        let second = state.begin("second").unwrap();
        state.finish("first"); assert!(state.begin("third").is_err());
        tauri::async_runtime::block_on(async { assert!(Abortable::new(std::future::pending::<()>(), first).await.is_err()); });
        state.cancel("second").unwrap();
        drop(second);
    }
    fn server(status: &str, content: String) -> (String, std::thread::JoinHandle<String>, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap(); let count = Arc::new(AtomicUsize::new(0));
        let requests = count.clone(); let status = status.to_owned();
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 2048];
            loop {
                let n = stream.read(&mut chunk).unwrap(); if n == 0 { break; } bytes.extend_from_slice(&chunk[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length: usize = headers.lines().find_map(|line| line.to_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse().unwrap())).unwrap_or(0);
                    if bytes.len() >= end + 4 + length { break; }
                }
            }
            requests.fetch_add(1, Ordering::SeqCst);
            let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{content}", content.len());
            stream.write_all(response.as_bytes()).ok();
            String::from_utf8(bytes).unwrap()
        });
        (format!("http://{address}/v1/chat/completions"), task, count)
    }
    fn stalled_server() -> (String, std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>, std::thread::JoinHandle<usize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let (ready, received) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let task = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while std::time::Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                        let mut bytes = [0; 4096];
                        let count = stream.read(&mut bytes).unwrap_or(0);
                        let _ = ready.send(());
                        let _ = wait.recv_timeout(Duration::from_secs(3));
                        return usize::from(bytes[..count].starts_with(b"POST "));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::park_timeout(Duration::from_millis(2)),
                    Err(_) => break,
                }
            }
            0
        });
        (format!("http://{address}/v1/chat/completions"), received, release, task)
    }
    #[test]
    fn transport_deadline_and_abort_drop_the_single_pending_request() {
        let (url, _, release, server) = stalled_server();
        let config = AiEndpointConfig {mode:AiEndpointMode::Local,endpoint_url:url,model:"test".into(),..Default::default()};
        let error = tauri::async_runtime::block_on(send_once(&payload(), &config, None, Duration::from_millis(500))).unwrap_err();
        let _ = release.send(());
        assert!(error.contains("30 秒")); assert_eq!(server.join().unwrap(), 1);
        let (url, received, release, server) = stalled_server();
        let state = AiRuntime::default();
        let registration = state.begin("cancel-http").unwrap();
        let config = AiEndpointConfig {mode:AiEndpointMode::Local,endpoint_url:url,model:"test".into(),..Default::default()};
        let future = tauri::async_runtime::spawn(async move {
            Abortable::new(send_once(&payload(), &config, None, Duration::from_secs(30)), registration).await
        });
        received.recv_timeout(Duration::from_secs(3)).unwrap();
        state.cancel("cancel-http").unwrap();
        assert!(tauri::async_runtime::block_on(future).unwrap().is_err());
        let _ = release.send(());
        assert_eq!(server.join().unwrap(), 1);
    }
    #[test]
    fn local_http_posts_once_without_key_and_validates_output() {
        let text = serde_json::json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(160)}).to_string();
        let (url, task, count) = server("200 OK", serde_json::json!({"choices":[{"message":{"content":text}}]}).to_string());
        let config = AiEndpointConfig { mode:AiEndpointMode::Local,endpoint_url:url,model:"test".into(),..Default::default() };
        let result = tauri::async_runtime::block_on(send_once(&payload(), &config, None, Duration::from_secs(2))).unwrap();
        assert_eq!(result.epilogue.chars().count(), 160);
        let request = task.join().unwrap(); assert_eq!(count.load(Ordering::SeqCst), 1);
        assert!(!request.to_lowercase().contains("authorization:"));
        let body: serde_json::Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["messages"][1]["content"], serialize_payload(&payload()).unwrap());
    }
    #[test]
    fn cloud_transport_puts_the_key_only_in_the_authorization_header() {
        let text = serde_json::json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(160)}).to_string();
        let (url, server, _) = server("200 OK", serde_json::json!({"choices":[{"message":{"content":text}}]}).to_string());
        let config = AiEndpointConfig {mode:AiEndpointMode::Cloud,endpoint_url:url,model:"test".into(),..Default::default()};
        tauri::async_runtime::block_on(send_once(&payload(), &config, Some("test-secret"), Duration::from_secs(2))).unwrap();
        let request = server.join().unwrap();
        let (headers, data) = request.split_once("\r\n\r\n").unwrap();
        assert!(headers.to_lowercase().contains("authorization: bearer test-secret"));
        assert!(!data.contains("test-secret"));
    }
    #[test]
    fn credential_echoes_are_not_returned_to_the_ui() {
        let output = serde_json::json!({"poetic_title":"灯下缓缓翻过一页","epilogue":format!("{}test-secret", "夜".repeat(145))}).to_string();
        let (url, server, _) = server("200 OK", serde_json::json!({"choices":[{"message":{"content":output}}]}).to_string());
        let config = AiEndpointConfig {mode:AiEndpointMode::Cloud,endpoint_url:url,model:"test".into(),..Default::default()};
        let error = tauri::async_runtime::block_on(send_once(&payload(), &config, Some("test-secret"), Duration::from_secs(2))).unwrap_err();
        assert!(error.contains("凭据") && !error.contains("test-secret"));
        server.join().unwrap();
    }
    #[test]
    fn http_errors_and_oversized_bodies_are_not_returned_as_private_text() {
        for (status, body) in [("401 Unauthorized", "PRIVATE-SECRET".into()), ("302 Found\r\nLocation: http://127.0.0.1:1/", "PRIVATE-SECRET".into()), ("200 OK", "x".repeat(70_000))] {
            let (url, task, count) = server(status, body);
            let config = AiEndpointConfig {mode:AiEndpointMode::Local,endpoint_url:url,model:"test".into(),..Default::default()};
            let error = tauri::async_runtime::block_on(send_once(&payload(), &config, None, Duration::from_secs(2))).unwrap_err();
            assert!(!error.contains("PRIVATE-SECRET"));
            if status.starts_with("302") { assert!(error.contains("重定向")); }
            if status == "200 OK" { assert!(error.contains("响应过长")); }
            task.join().unwrap(); assert_eq!(count.load(Ordering::SeqCst), 1);
        }
    }
}
