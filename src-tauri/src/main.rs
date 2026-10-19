// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backlinks;
use backlinks::query_backlinks;

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};

#[derive(Default)]
struct StorageLock(Mutex<()>);

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn unique_suffix() -> String {
    format!("{}-{}-{}", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed))
}

fn document_filename(current: Option<&str>, today: &str) -> Result<String, String> {
    let name = current.map(str::to_owned).unwrap_or_else(|| format!("{}.md", today));
    if name.starts_with('.') || !name.ends_with(".md") || name.len() <= 3
        || name.chars().any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
        || Path::new(&name).components().count() != 1
    {
        return Err("INVALID_FILENAME: expected a single non-hidden .md filename".into());
    }
    Ok(name)
}

fn read_document(path: &Path) -> Result<String, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_file() => return Err("DOCUMENT_READ_ERROR: not a regular file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("DOCUMENT_NOT_FOUND".into()),
        Err(e) => return Err(format!("DOCUMENT_READ_ERROR: {}", e)),
        _ => {}
    }
    fs::read_to_string(path).map_err(|e| format!("DOCUMENT_READ_ERROR: {}", e))
}

fn check_expected(path: &Path, expected: Option<&str>) -> Result<(), String> {
    match read_document(path) {
        Ok(actual) if expected == Some(actual.as_str()) => Ok(()),
        Ok(_) => Err("DOCUMENT_CONFLICT: on-disk content differs (or expectedContent is missing)".into()),
        Err(e) if e == "DOCUMENT_NOT_FOUND" && expected.is_none() => Ok(()),
        Err(e) if e == "DOCUMENT_NOT_FOUND" => Err("DOCUMENT_CONFLICT: document was removed".into()),
        Err(e) => Err(e),
    }
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    atomic_write_checked(path, content, None)
}

fn atomic_write_checked(path: &Path, content: &[u8], expected: Option<Option<&str>>) -> Result<(), String> {
    let temp = path.with_file_name(format!(".silens-{}.tmp", unique_suffix()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|e| format!("WRITE_ERROR: {}", e))?;
        file.write_all(content).and_then(|_| file.sync_all()).map_err(|e| format!("WRITE_ERROR: {}", e))?;
        if let Some(expected) = expected { check_expected(path, expected)?; }
        fs::rename(&temp, path).map_err(|e| format!("WRITE_ERROR: {}", e))
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn save_note(dir: &Path, filename: &str, content: &str, expected: Option<&str>) -> Result<(), String> {
    document_filename(Some(filename), "")?;
    let path = dir.join(filename);
    check_expected(&path, expected)?;
    atomic_write_checked(&path, content.as_bytes(), Some(expected))
}
use tauri::Manager;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct Document {
    filename: String,
    title: String,
    content: String,
    modified: i64,
}

// Never silently redirect a configured workspace to another directory.
fn get_active_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let path = match fs::read_to_string(docs_dir.join(".silens_workspace")) {
        Ok(custom) if !custom.trim().is_empty() => PathBuf::from(custom.trim()).join("Silens_Notes"),
        Ok(_) => return Err("WORKSPACE_UNAVAILABLE: empty workspace configuration".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => docs_dir.join("Silens_Notes"),
        Err(e) => return Err(format!("WORKSPACE_UNAVAILABLE: {}", e)),
    };
    if !path.is_dir() {
        return Err(format!("WORKSPACE_UNAVAILABLE: {}", path.display()));
    }
    Ok(path)
}

#[tauri::command]
fn get_storage_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = get_active_workspace(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn change_storage_path(app: tauri::AppHandle, new_path: String) -> Result<String, String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let source = get_active_workspace(&app)?;
    let parent = Path::new(new_path.trim());
    if !parent.is_absolute() || !parent.is_dir() {
        return Err("WORKSPACE_UNAVAILABLE: select an existing absolute directory".into());
    }
    let target_dir = parent.join("Silens_Notes");
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_dir = fs::canonicalize(target_dir).map_err(|e| e.to_string())?;
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    if target_dir == source { return Ok(target_dir.to_string_lossy().into_owned()); }
    if target_dir.starts_with(&source) || source.starts_with(&target_dir) {
        return Err("WORKSPACE_CONFLICT: nested workspaces are not supported".into());
    }
    copy_workspace(&source, &target_dir, true)?;
    // Build the target's local index before committing the workspace configuration.
    rebuild_index_for_workspace(&app, &target_dir)?;
    let config_path = app.path().document_dir().map_err(|e| e.to_string())?.join(".silens_workspace");
    atomic_write(&config_path, parent.to_string_lossy().as_bytes())?;
    Ok(target_dir.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
fn save_document(
    app: tauri::AppHandle,
    content: String,
    current_filename: Option<String>,
    expected_content: Option<String>,
) -> Result<String, String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let target_dir = get_active_workspace(&app)?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let filename = document_filename(current_filename.as_deref(), &today)?;
    save_note(&target_dir, &filename, &content, expected_content.as_deref())?;
    if let Ok(conn) = get_db_connection(&app) {
        let _ = index_document(&conn, filename.trim_end_matches(".md"), &content);
    }
    Ok(filename)
}

#[tauri::command]
fn save_file_as(
    app: tauri::AppHandle,
    content: String,
    filename: String,
) -> Result<(), String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let target_dir = get_active_workspace(&app)?;
    let filename = if filename.ends_with(".md") { filename } else { format!("{}.md", filename) };
    save_note(&target_dir, &filename, &content, None)?;
    if let Ok(conn) = get_db_connection(&app) {
        let _ = index_document(&conn, filename.trim_end_matches(".md"), &content);
    }
    Ok(())
}

#[tauri::command]
async fn get_all_documents(app: tauri::AppHandle) -> Result<Vec<Document>, String> {
    let target_dir = get_active_workspace(&app)?;

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut documents = Vec::new();

    for entry in WalkDir::new(&target_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let filename = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => {
                if name.starts_with('.') || !name.ends_with(".md") {
                    continue;
                }
                name.to_string()
            }
            None => continue,
        };

        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64
            })
            .unwrap_or(0);

        let content = fs::read_to_string(path).unwrap_or_default();
        if content.is_empty() {
            continue;
        }
        let title = filename.replace(".md", "");

        documents.push(Document {
            filename,
            title,
            content,
            modified,
        });
    }

    // Sort by modified descending
    documents.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(documents)
}

#[tauri::command]
async fn load_document(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let target_dir = get_active_workspace(&app)?;
    let filename = document_filename(Some(&filename), "")?;
    read_document(&target_dir.join(filename))
}

fn is_tag_boundary(c: char) -> bool {
    c.is_whitespace()
        || "，。！？；：、,.!?;:()（）【】[]{}<>\"'".contains(c)
}

fn tag_prefix_ok(prev: Option<char>) -> bool {
    prev.map_or(true, |c| c.is_whitespace())
}

fn tag_suffix_ok(next: Option<char>) -> bool {
    next.map_or(true, is_tag_boundary)
}

fn replace_tag_in_content(content: &str, from: &str, to: &str) -> String {
    let needle = format!("#{}", from);
    if needle.is_empty() {
        return content.to_string();
    }

    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;

    while let Some(position) = content[cursor..].find(&needle) {
        let abs = cursor + position;
        let prev_char = content[..abs].chars().rev().next();
        let next_char = content[abs + needle.len()..].chars().next();

        if tag_prefix_ok(prev_char) && tag_suffix_ok(next_char) {
            output.push_str(&content[cursor..abs]);
            output.push('#');
            output.push_str(to);
            cursor = abs + needle.len();
        } else {
            let next_pos = abs + 1;
            output.push_str(&content[cursor..next_pos]);
            cursor = next_pos;
        }
    }

    output.push_str(&content[cursor..]);
    output
}

fn remove_tag_from_content(content: &str, tag: &str) -> String {
    let needle = format!("#{}", tag);
    if needle.is_empty() {
        return content.to_string();
    }

    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;

    while let Some(position) = content[cursor..].find(&needle) {
        let abs = cursor + position;
        let prev_char = content[..abs].chars().rev().next();
        let next_char = content[abs + needle.len()..].chars().next();

        if tag_prefix_ok(prev_char) && tag_suffix_ok(next_char) {
            output.push_str(&content[cursor..abs]);
            cursor = abs + needle.len();
        } else {
            let next_pos = abs + 1;
            output.push_str(&content[cursor..next_pos]);
            cursor = next_pos;
        }
    }

    output.push_str(&content[cursor..]);
    let mut cleaned = output.replace("  ", " ");
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }
    cleaned
}

fn update_tag_in_documents(
    app: tauri::AppHandle,
    from: &str,
    to: &str,
) -> Result<Vec<String>, String> {
    let target_dir = get_active_workspace(&app)?;

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut updated_files = Vec::new();

    for entry in WalkDir::new(&target_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let filename = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        if filename.starts_with('.') || !filename.ends_with(".md") {
            continue;
        }

        let content = fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))?;
        let next_content = replace_tag_in_content(&content, from, to);

        if next_content != content {
            atomic_write_checked(path, next_content.as_bytes(), Some(Some(&content)))?;
            updated_files.push(filename);
        }
    }

    Ok(updated_files)
}

fn delete_tag_from_documents(app: tauri::AppHandle, tag: &str) -> Result<Vec<String>, String> {
    let target_dir = get_active_workspace(&app)?;

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut updated_files = Vec::new();

    for entry in WalkDir::new(&target_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let filename = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        if filename.starts_with('.') || !filename.ends_with(".md") {
            continue;
        }

        let content = fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))?;
        let next_content = remove_tag_from_content(&content, tag);

        if next_content != content {
            atomic_write_checked(path, next_content.as_bytes(), Some(Some(&content)))?;
            updated_files.push(filename);
        }
    }

    Ok(updated_files)
}

#[tauri::command]
fn rename_tag(app: tauri::AppHandle, from: String, to: String) -> Result<Vec<String>, String> {
    if from.trim().is_empty() || to.trim().is_empty() {
        return Err("标签不能为空".to_string());
    }
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    update_tag_in_documents(app.clone(), &from, &to)
}

#[tauri::command]
fn delete_tag(app: tauri::AppHandle, tag: String) -> Result<Vec<String>, String> {
    if tag.trim().is_empty() {
        return Err("标签不能为空".to_string());
    }
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    delete_tag_from_documents(app.clone(), &tag)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DayRecord {
    pub date: String,
    pub tags: Vec<TagGroup>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagGroup {
    pub tag: String,
    pub blocks: Vec<String>,
}

#[tauri::command]
async fn get_timeline_data(app: tauri::AppHandle) -> Result<Vec<DayRecord>, String> {
    let conn = get_db_connection(&app)?;

    // 1. 通过 SQL 一次性完成 排序、匹配与提取。按日期倒序，按物理位置(id)正序
    let mut stmt = conn.prepare(
        "SELECT b.date, t.name, b.content 
         FROM blocks b
         JOIN block_tags bt ON b.id = bt.block_id
         JOIN tags t ON bt.tag_id = t.id
         ORDER BY b.date DESC, b.id ASC"
    ).map_err(|e| e.to_string())?;

    let rows_iter = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?, // date
            row.get::<_, String>(1)?, // tag_name
            row.get::<_, String>(2)?, // content
        ))
    }).map_err(|e| e.to_string())?;

    // 2. 将扁平的 SQL 结果行，无缝转换为前端所需的树状 DayRecord 结构
    let mut records: Vec<DayRecord> = Vec::new();

    for row_result in rows_iter {
        if let Ok((date, tag_name, content)) = row_result {
            if records.last().map(|r| r.date == date).unwrap_or(false) {
                let last_record = records.last_mut().unwrap();
                if let Some(tag_group) = last_record.tags.iter_mut().find(|t| t.tag == tag_name) {
                    tag_group.blocks.push(content);
                } else {
                    last_record.tags.push(TagGroup { tag: tag_name, blocks: vec![content] });
                }
            } else {
                records.push(DayRecord { 
                    date, 
                    tags: vec![TagGroup { tag: tag_name, blocks: vec![content] }] 
                });
            }
        }
    }

    Ok(records)
}

fn get_db_connection(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    open_workspace_index(app, &get_active_workspace(app)?)
}

fn open_workspace_index(app: &tauri::AppHandle, workspace: &Path) -> Result<rusqlite::Connection, String> {
    use std::hash::{Hash, Hasher};
    let workspace = fs::canonicalize(workspace).map_err(|e| e.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    workspace.hash(&mut hash);
    let local_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("indexes");
    fs::create_dir_all(&local_dir).map_err(|e| e.to_string())?;
    let db_path = local_dir.join(format!("{:016x}.db", hash.finish()));
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    // 开启外键约束，以支持 block 删除时级联删除关系表
    conn.execute("PRAGMA foreign_keys = ON;", []).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            content TEXT NOT NULL,
            raw_markdown TEXT NOT NULL
        )",
        [],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )",
        [],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS block_tags (
            block_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (block_id, tag_id),
            FOREIGN KEY (block_id) REFERENCES blocks (id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
        )",
        [],
    ).map_err(|e| e.to_string())?;

    Ok(conn)
}

fn index_document(conn: &rusqlite::Connection, date: &str, content: &str) -> Result<(), String> {
    // 先删除该日期的所有旧块（配合 foreign_keys = ON，block_tags 也会自动级联删除）
    conn.execute("DELETE FROM blocks WHERE date = ?1", rusqlite::params![date])
        .map_err(|e| e.to_string())?;

    let mut current_block = String::new();
    let mut blocks = Vec::new();
    let mut empty_line_count = 0;

    // 与 get_timeline_data 完全一致的切分算法
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            empty_line_count += 1;
        } else {
            if empty_line_count >= 3 {
                if !current_block.trim().is_empty() {
                    blocks.push(current_block.trim().to_string());
                    current_block.clear();
                }
            } else if !current_block.is_empty() {
                for _ in 0..empty_line_count {
                    current_block.push('\n');
                }
                current_block.push('\n');
            }
            current_block.push_str(line);
            empty_line_count = 0;
        }
    }
    if !current_block.trim().is_empty() {
        blocks.push(current_block.trim().to_string());
    }

    // 提取标签并存入暗影索引
    for block in blocks {
        let trimmed = block.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut found_tag = "默认".to_string();
        let mut clean_content = trimmed.to_string();

        let mut cursor = 0;
        while let Some(pos) = trimmed[cursor..].find('#') {
            let abs_pos = cursor + pos;
            let prev_char = if abs_pos > 0 { trimmed[..abs_pos].chars().rev().next() } else { None };

            if tag_prefix_ok(prev_char) {
                let tag_body_start = abs_pos + 1;
                let end_offset = trimmed[tag_body_start..]
                    .find(is_tag_boundary)
                    .unwrap_or(trimmed[tag_body_start..].len());

                if end_offset > 0 {
                    found_tag = trimmed[tag_body_start..tag_body_start + end_offset].to_string();
                    let mut new_clean = trimmed[..abs_pos].trim_end().to_string();
                    let tail = trimmed[tag_body_start + end_offset..].trim_start();

                    if !tail.is_empty() {
                        if !new_clean.is_empty() {
                            new_clean.push(' ');
                        }
                        new_clean.push_str(tail);
                    }
                    clean_content = if new_clean.is_empty() { format!("#{}", found_tag) } else { new_clean };
                    break;
                }
            }
            cursor = abs_pos + 1;
        }

        conn.execute(
            "INSERT INTO blocks (date, content, raw_markdown) VALUES (?1, ?2, ?3)",
            rusqlite::params![date, clean_content, block],
        ).map_err(|e| e.to_string())?;

        let block_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
            rusqlite::params![found_tag],
        ).map_err(|e| e.to_string())?;

        let tag_id: i64 = conn.query_row(
            "SELECT id FROM tags WHERE name = ?1",
            rusqlite::params![found_tag],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO block_tags (block_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![block_id, tag_id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ShadowBlock {
    pub id: i64,
    pub date: String,
    pub content: String,
    pub raw_markdown: String,
}

#[tauri::command]
async fn query_blocks_by_tag(app: tauri::AppHandle, tag: String) -> Result<Vec<ShadowBlock>, String> {
    let conn = get_db_connection(&app)?;
    
    // 毫秒级多表联查，按日期倒序
    let mut stmt = conn.prepare(
        "SELECT b.id, b.date, b.content, b.raw_markdown 
         FROM blocks b
         JOIN block_tags bt ON b.id = bt.block_id
         JOIN tags t ON bt.tag_id = t.id
         WHERE t.name = ?1
         ORDER BY b.date DESC"
    ).map_err(|e| e.to_string())?;

    let blocks_iter = stmt.query_map(rusqlite::params![tag], |row| {
        Ok(ShadowBlock {
            id: row.get(0)?,
            date: row.get(1)?,
            content: row.get(2)?,
            raw_markdown: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for block in blocks_iter {
        if let Ok(b) = block {
            result.push(b);
        }
    }

    Ok(result)
}

#[tauri::command]
async fn rebuild_shadow_index(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let count = rebuild_index_for_workspace(&app, &get_active_workspace(&app)?)?;
    Ok(format!("成功重建 {} 篇文档的暗影索引", count))
}

#[tauri::command]
async fn search_docs_by_prefix(app: tauri::AppHandle, prefix: String) -> Result<Vec<String>, String> {
    let target_dir = get_active_workspace(&app)?;
    if !target_dir.exists() {
        return Ok(vec![]);
    }
    let prefix_lower = prefix.to_lowercase();
    let mut results: Vec<String> = Vec::new();
    for entry in WalkDir::new(&target_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !name.ends_with(".md") {
            continue;
        }
        let stem = name.trim_end_matches(".md");
        if stem.to_lowercase().starts_with(&prefix_lower) {
            results.push(stem.to_string());
        }
    }
    results.sort();
    Ok(results)
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub date: String,
    pub snippet: String,
    pub context_preview: String,
}

#[tauri::command]
async fn search_notes(app: tauri::AppHandle, query: String) -> Result<Vec<SearchResult>, String> {
    let query_trim = query.trim();
    if query_trim.is_empty() {
        return Ok(vec![]);
    }

    let conn = get_db_connection(&app)?;
    
    // SQLite LIKE 默认对 ASCII 忽略大小写
    let sql_query = format!("%{}%", query_trim);
    
    // 极速匹配：限制最多返回 15 条结果保证渲染性能
    let mut stmt = conn.prepare(
        "SELECT id, date, content FROM blocks WHERE content LIKE ?1 ORDER BY date DESC LIMIT 15"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![sql_query], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let query_lower = query_trim.to_lowercase();

    for row_result in rows.filter_map(Result::ok) {
        let (id, date, content) = row_result;
        let content_lower = content.to_lowercase();
        
        // 提取摘要 (Snippet)：找到匹配词位置，前后各截取 25 字节
        if let Some(match_idx) = content_lower.find(&query_lower) {
            let start_raw = match_idx.saturating_sub(25);
            let end_raw = (match_idx + query_lower.len() + 25).min(content.len());

            // 边界安全校验：防止截断中文字符导致 Panic
            let mut safe_start = start_raw;
            while safe_start > 0 && !content.is_char_boundary(safe_start) { safe_start -= 1; }
            let mut safe_end = end_raw;
            while safe_end < content.len() && !content.is_char_boundary(safe_end) { safe_end += 1; }

            // 压缩连续换行与空白符
            let compressed = content[safe_start..safe_end].split_whitespace().collect::<Vec<_>>().join(" ");
            let prefix = if safe_start > 0 { "..." } else { "" };
            let suffix = if safe_end < content.len() { "..." } else { "" };

            // 提取富上下文 (Context Preview)：前后各截取约 150 字节，并保留换行以供卡片预览
            let start_preview = match_idx.saturating_sub(150);
            let end_preview = (match_idx + query_lower.len() + 150).min(content.len());
            let mut safe_start_prev = start_preview;
            while safe_start_prev > 0 && !content.is_char_boundary(safe_start_prev) { safe_start_prev -= 1; }
            let mut safe_end_prev = end_preview;
            while safe_end_prev < content.len() && !content.is_char_boundary(safe_end_prev) { safe_end_prev += 1; }

            let context_preview = content[safe_start_prev..safe_end_prev].trim().to_string();
            let prev_prefix = if safe_start_prev > 0 { "..." } else { "" };
            let prev_suffix = if safe_end_prev < content.len() { "..." } else { "" };
            let final_preview = format!("{}{}{}", prev_prefix, context_preview, prev_suffix);

            results.push(SearchResult { id: id.to_string(), date, snippet: format!("{}{}{}", prefix, compressed, suffix), context_preview: final_preview });
        }
    }
    Ok(results)
}

// Refuse links and propagate traversal errors rather than publishing incomplete data.
fn workspace_files(source: &Path, markdown_only: bool) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(source).into_iter().filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        entry.depth() == 0 || !(name.starts_with(".shadow_index") || name.ends_with(".tmp"))
    }) {
        let entry = entry.map_err(|e| format!("COPY_ERROR: {}", e))?;
        if entry.file_type().is_symlink() {
            return Err(format!("COPY_ERROR: symbolic link {}", entry.path().display()));
        }
        if entry.file_type().is_file() && (!markdown_only || entry.path().extension().is_some_and(|e| e == "md")) {
            files.push(entry.path().to_owned());
        }
    }
    files.sort();
    Ok(files)
}

fn copy_workspace(source: &Path, target: &Path, markdown_only: bool) -> Result<(), String> {
    let files = workspace_files(source, markdown_only)?;
    for path in &files {
        let dest = target.join(path.strip_prefix(source).map_err(|e| e.to_string())?);
        let bytes = fs::read(path).map_err(|e| format!("COPY_ERROR: {}", e))?;
        // Check every existing component to prevent writing through target symlinks.
        let relative = dest.strip_prefix(target).map_err(|e| e.to_string())?;
        let mut component_path = target.to_owned();
        for component in relative.components() {
            component_path.push(component);
            match fs::symlink_metadata(&component_path) {
                Ok(meta) if meta.file_type().is_symlink() => return Err("COPY_CONFLICT: target contains a symbolic link".into()),
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("COPY_ERROR: {}", e)),
                _ => {}
            }
        }
        if dest.exists() {
            if fs::read(&dest).map_err(|e| format!("COPY_ERROR: {}", e))? != bytes {
                return Err(format!("COPY_CONFLICT: {}", dest.display()));
            }
        } else {
            fs::create_dir_all(dest.parent().unwrap()).map_err(|e| format!("COPY_ERROR: {}", e))?;
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&dest)
                .map_err(|e| format!("COPY_ERROR: {}", e))?;
            file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| format!("COPY_ERROR: {}", e))?;
        }
        if fs::read(&dest).map_err(|e| e.to_string())? != bytes
            || fs::read(path).map_err(|e| e.to_string())? != bytes {
            return Err("COPY_ERROR: verification failed or source changed".into());
        }
    }
    for path in &files {
        let dest = target.join(path.strip_prefix(source).map_err(|e| e.to_string())?);
        if fs::read(path).map_err(|e| format!("COPY_ERROR: {}", e))?
            != fs::read(dest).map_err(|e| format!("COPY_ERROR: {}", e))? {
            return Err("COPY_ERROR: source changed during copy".into());
        }
    }
    if workspace_files(source, markdown_only)? != files {
        return Err("COPY_ERROR: source file set changed".into());
    }
    Ok(())
}

fn rebuild_index_for_workspace(app: &tauri::AppHandle, workspace: &Path) -> Result<usize, String> {
    let mut conn = open_workspace_index(app, workspace)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM blocks", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tags", []).map_err(|e| e.to_string())?;
    let files = workspace_files(workspace, true)?;
    for path in &files {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let stem = path.file_stem().and_then(|s| s.to_str()).ok_or("INVALID_FILENAME")?;
        index_document(&tx, stem, &content)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(files.len())
}

fn snapshot_workspace(source: &Path, backups: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(backups).map_err(|e| e.to_string())?;
    let name = format!("{}_{}", Local::now().format("%Y-%m-%d_%H-%M-%S"), unique_suffix());
    let stage = backups.join(format!(".incomplete-{}", name));
    let published = backups.join(name);
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    // Leave a failed stage hidden for inspection; never run retention on failure.
    copy_workspace(source, &stage, false)?;
    fs::rename(&stage, &published).map_err(|e| e.to_string())?;
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(backups).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let valid_date = name.get(..19).is_some_and(|s|
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d_%H-%M-%S").is_ok());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() && valid_date
            && (name.len() == 19 || name.as_bytes().get(19) == Some(&b'_')) {
            snapshots.push(entry.path());
        }
    }
    snapshots.sort_by(|a, b| b.cmp(a));
    for old in snapshots.into_iter().skip(10) {
        // A retention failure does not invalidate a successfully published snapshot.
        if let Err(e) = fs::remove_dir_all(&old) { log::warn!("Backup retention failed: {}", e); }
    }
    Ok(published)
}

// Snapshots are local and are published only after a verified copy.
fn perform_backup(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let source = get_active_workspace(app)?;
    let backups = app.path().document_dir().map_err(|e| e.to_string())?.join("Silens_Backups");
    Ok(snapshot_workspace(&source, &backups)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_backups_folder(app: tauri::AppHandle) -> Result<(), String> {
    let docs_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let backups_dir = docs_dir.join("Silens_Backups");
    
    if !backups_dir.exists() {
        return Err("备份文件夹尚未创建".to_string());
    }

    open_folder(&backups_dir)
}

fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "linux")]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(path).spawn()
        .map_err(|e| format!("OPEN_FOLDER_ERROR: {}", e))?;
    Ok(())
}

#[tauri::command]
fn open_storage_folder(app: tauri::AppHandle) -> Result<(), String> {
    open_folder(&get_active_workspace(&app)?)
}

#[tauri::command]
async fn create_backup(app: tauri::AppHandle) -> Result<String, String> {
    perform_backup(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("silens-test-{}", unique_suffix()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn filename_selection_and_validation() {
        assert_eq!(document_filename(None, "2026-10-15").unwrap(), "2026-10-15.md");
        assert_eq!(document_filename(Some("2020-01-01.md"), "2026-10-15").unwrap(), "2020-01-01.md");
        for name in ["", "../escape.md", "/absolute.md", "a/b.md", "a\\b.md", ".hidden.md", "note.txt", "C:note.md", "bad\n.md"] {
            assert!(document_filename(Some(name), "").is_err(), "{}", name);
        }
    }

    #[test]
    fn conflicts_preserve_external_text_and_allow_empty_save() {
        let dir = TempDir::new();
        save_note(&dir.0, "old.md", "original", None).unwrap();
        fs::write(dir.0.join("old.md"), "external").unwrap();
        for expected in [None, Some("original")] {
            assert!(save_note(&dir.0, "old.md", "replacement", expected).unwrap_err().starts_with("DOCUMENT_CONFLICT"));
            assert_eq!(fs::read_to_string(dir.0.join("old.md")).unwrap(), "external");
        }
        save_note(&dir.0, "old.md", "", Some("external")).unwrap();
        assert_eq!(read_document(&dir.0.join("old.md")).unwrap(), "");
        assert_eq!(read_document(&dir.0.join("missing.md")).unwrap_err(), "DOCUMENT_NOT_FOUND");
        assert!(save_note(&dir.0, "missing.md", "text", Some("")).unwrap_err().starts_with("DOCUMENT_CONFLICT"));
    }

    #[test]
    fn failed_copy_preserves_source_and_conflicting_target() {
        let source = TempDir::new();
        let target = TempDir::new();
        fs::write(source.0.join("note.md"), "source").unwrap();
        fs::write(target.0.join("note.md"), "target").unwrap();
        assert!(copy_workspace(&source.0, &target.0, true).is_err());
        assert_eq!(fs::read_to_string(source.0.join("note.md")).unwrap(), "source");
        assert_eq!(fs::read_to_string(target.0.join("note.md")).unwrap(), "target");
        let blocked = target.0.join("blocked");
        fs::write(&blocked, "not a directory").unwrap();
        assert!(copy_workspace(&source.0, &blocked, true).is_err());
        assert_eq!(fs::read_to_string(source.0.join("note.md")).unwrap(), "source");
    }

    #[test]
    fn snapshots_publish_only_on_success_and_omit_cache() {
        let source = TempDir::new();
        let backups = TempDir::new();
        for day in 1..=11 {
            fs::create_dir(backups.0.join(format!("2020-01-{:02}_00-00-00", day))).unwrap();
        }
        assert!(snapshot_workspace(&source.0.join("missing"), &backups.0).is_err());
        for day in 1..=11 {
            assert!(backups.0.join(format!("2020-01-{:02}_00-00-00", day)).is_dir());
        }
        fs::write(source.0.join("note.md"), "note").unwrap();
        fs::write(source.0.join(".shadow_index.db"), "cache").unwrap();
        fs::write(source.0.join("note.md.tmp"), "partial").unwrap();
        let published = snapshot_workspace(&source.0, &backups.0).unwrap();
        assert_eq!(fs::read_to_string(published.join("note.md")).unwrap(), "note");
        assert!(!published.join(".shadow_index.db").exists());
        assert!(!published.join("note.md.tmp").exists());
        assert!(!backups.0.join("2020-01-01_00-00-00").exists());
        assert!(backups.0.join("2020-01-03_00-00-00").exists());
    }

    #[test]
    fn test_document_serialization() {
        let doc = Document {
            filename: "test.md".into(),
            title: "Title".into(),
            content: "Content".into(),
            modified: 123456789,
        };
        let serialized = serde_json::to_string(&doc).unwrap();
        assert!(serialized.contains("\"content\":\"Content\""));
    }
}

fn main() {
    tauri::Builder::default()
        .manage(StorageLock::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            save_document,
            get_all_documents,
            load_document,
            rename_tag,
            delete_tag,
            get_timeline_data,
            query_blocks_by_tag,
            rebuild_shadow_index,
            create_backup,
            search_notes,
            search_docs_by_prefix,
            query_backlinks,
            get_storage_path,
            change_storage_path,
            open_backups_folder,
            open_storage_folder,
            save_file_as
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            
            // Only initialize the default workspace on first launch; later disappearance is an error.
            let local = app.path().app_local_data_dir()?;
            fs::create_dir_all(&local)?;
            let marker = local.join("workspace-initialized");
            let docs = app.path().document_dir()?;
            if !marker.try_exists()? {
                if !docs.join(".silens_workspace").try_exists()? {
                    fs::create_dir_all(docs.join("Silens_Notes"))?;
                }
                fs::write(&marker, b"1")?;
            }
            if let Ok(workspace) = get_active_workspace(app.handle()) {
                if let Err(e) = rebuild_index_for_workspace(app.handle(), &workspace) {
                    log::warn!("Index rebuild failed: {}", e);
                }
            }

            // 静默开启后台定时备份线程（每 6 小时自动备份一次）
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
                    let _ = perform_backup(&app_handle);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
