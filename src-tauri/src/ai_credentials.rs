const SERVICE: &str = "com.weihusong.sliens.reflection-ai";
const ACCOUNT: &str = "endpoint";
#[cfg(not(target_os = "linux"))]
const ERROR: &str = "无法访问系统凭据库，请解锁凭据库后重试；密钥未写入普通配置。";
#[cfg(target_os = "linux")]
const ERROR: &str = "无法访问系统凭据库，请检查 Secret Service 与 secret-tool 是否可用；密钥未写入普通配置。";

#[cfg(target_os = "macos")]
pub fn read() -> Result<Option<String>, String> {
    match security_framework::passwords::get_generic_password(SERVICE, ACCOUNT) {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| ERROR.into()),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err(ERROR.into()),
    }
}

#[cfg(target_os = "macos")]
pub fn write(secret: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, secret.as_bytes()).map_err(|_| ERROR.into())
}

#[cfg(target_os = "macos")]
pub fn delete() -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err(ERROR.into()),
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn command(action: &str) -> Command {
        let mut command = Command::new("/usr/bin/secret-tool");
        command.arg(action);
        if action == "store" { command.arg("--label=Silens AI 拾遗伴侣"); }
        command.args(["service", SERVICE, "account", ACCOUNT]);
        command
    }
    pub fn read() -> Result<Option<String>, String> {
        let output = command("lookup").output().map_err(|_| ERROR.to_owned())?;
        if output.status.success() {
            String::from_utf8(output.stdout).map(|text| Some(text.trim_end_matches('\n').to_owned())).map_err(|_| ERROR.into())
        } else if output.status.code() == Some(1) && output.stderr.is_empty() { Ok(None) }
        else { Err(ERROR.into()) }
    }
    pub fn write(secret: &str) -> Result<(), String> {
        let mut child = command("store").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|_| ERROR.to_owned())?;
        let result = child.stdin.take().ok_or(ERROR.to_owned())?.write_all(secret.as_bytes());
        let status = child.wait().map_err(|_| ERROR.to_owned())?;
        if result.is_ok() && status.success() { Ok(()) } else { Err(ERROR.into()) }
    }
    pub fn delete() -> Result<(), String> {
        if read()?.is_none() { return Ok(()); }
        let status = command("clear").stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|_| ERROR.to_owned())?;
        if status.success() { Ok(()) } else { Err(ERROR.into()) }
    }
}
#[cfg(target_os = "linux")]
pub use linux::{delete, read, write};

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::ffi::c_void;
    #[repr(C)]
    struct FileTime { low: u32, high: u32 }
    #[repr(C)]
    struct Credential {
        flags: u32, kind: u32, target: *mut u16, comment: *mut u16, written: FileTime,
        blob_size: u32, blob: *mut u8, persist: u32, attribute_count: u32,
        attributes: *mut c_void, alias: *mut u16, username: *mut u16,
    }
    #[link(name = "Advapi32")]
    unsafe extern "system" {
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut Credential) -> i32;
        fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }
    #[link(name = "Kernel32")]
    unsafe extern "system" { fn GetLastError() -> u32; }
    fn target() -> Vec<u16> { format!("{SERVICE}:{ACCOUNT}\0").encode_utf16().collect() }
    pub fn read() -> Result<Option<String>, String> {
        let target = target();
        let mut entry = std::ptr::null_mut();
        unsafe {
            if CredReadW(target.as_ptr(), 1, 0, &mut entry) == 0 {
                return if GetLastError() == 1168 { Ok(None) } else { Err(ERROR.into()) };
            }
            let bytes = if (*entry).blob_size == 0 { vec![] }
                else { std::slice::from_raw_parts((*entry).blob, (*entry).blob_size as usize).to_vec() };
            CredFree(entry.cast());
            String::from_utf8(bytes).map(Some).map_err(|_| ERROR.into())
        }
    }
    pub fn write(secret: &str) -> Result<(), String> {
        let mut target = target();
        let mut username: Vec<u16> = format!("{ACCOUNT}\0").encode_utf16().collect();
        let mut bytes = secret.as_bytes().to_vec();
        let entry = Credential { flags: 0, kind: 1, target: target.as_mut_ptr(), comment: std::ptr::null_mut(),
            written: FileTime { low: 0, high: 0 }, blob_size: bytes.len() as u32, blob: bytes.as_mut_ptr(), persist: 2,
            attribute_count: 0, attributes: std::ptr::null_mut(), alias: std::ptr::null_mut(), username: username.as_mut_ptr() };
        let success = unsafe { CredWriteW(&entry, 0) != 0 };
        bytes.fill(0);
        if success { Ok(()) } else { Err(ERROR.into()) }
    }
    pub fn delete() -> Result<(), String> {
        let target = target();
        unsafe { if CredDeleteW(target.as_ptr(), 1, 0) != 0 || GetLastError() == 1168 { Ok(()) } else { Err(ERROR.into()) } }
    }
}
#[cfg(target_os = "windows")]
pub use windows::{delete, read, write};
