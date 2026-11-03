// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backlinks;
mod documents;
mod note_times;
use note_times::NoteTimes;
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
    let mut registry = note_times::load(dir)?;
    note_times::ensure(dir, filename, &mut registry)?;
    atomic_write_checked(&path, content.as_bytes(), Some(expected))
}
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct Document {
    filename: String,
    kind: String,
    journal_date: Option<String>,
    tags: Vec<String>,
    title: String,
    content: String,
    created: i64,
    created_date: String,
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
    refresh_saved_index(&app, &filename, &content);
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
    refresh_saved_index(&app, &filename, &content);
    Ok(())
}

fn refresh_saved_index(app: &tauri::AppHandle, filename: &str, content: &str) {
    let result = (|| {
        let workspace = get_active_workspace(app)?;
        let registry = note_times::load(&workspace)?;
        let times = note_times::get(&workspace, filename, &registry)?;
        let conn = get_db_connection(app)?;
        index_document(&conn, documents::stem(filename), content, &times)
    })();
    if let Err(error) = result {
        log::warn!("Document saved but index update failed: {}", error);
        let _ = app.emit("silens-index-warning", "文字已保存，搜索索引暂未更新，可稍后重新打开应用重建。");
    }
}

#[tauri::command]
async fn get_all_documents(app: tauri::AppHandle) -> Result<Vec<Document>, String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let target_dir = get_active_workspace(&app)?;
    let registry = note_times::ensure_workspace(&target_dir)?;

    if !target_dir.exists() {
        return Ok(vec![]);
    }

    let mut documents = Vec::new();

    for entry in WalkDir::new(&target_dir).max_depth(1)
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

        let times = note_times::get(&target_dir, &filename, &registry)?;

        let content = fs::read_to_string(path).unwrap_or_default();
        if content.is_empty() {
            continue;
        }
        let title = documents::title(&filename, &content);
        let kind = documents::kind(&filename).to_owned();
        let journal_date = (kind == "journal").then(|| filename[..10].to_owned());

        documents.push(Document {
            filename,
            kind,
            journal_date,
            tags: documents::tags(documents::split(&content).1),
            title,
            content,
            created: times.created,
            created_date: times.created_date,
            modified: times.modified,
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

    for entry in WalkDir::new(&target_dir).max_depth(1)
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
            save_note(&target_dir, &filename, &next_content, Some(&content))?;
            refresh_saved_index(&app, &filename, &next_content);
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

    for entry in WalkDir::new(&target_dir).max_depth(1)
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
            save_note(&target_dir, &filename, &next_content, Some(&content))?;
            refresh_saved_index(&app, &filename, &next_content);
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
    pub articles: Vec<RecallArticle>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagGroup {
    pub tag: String,
    pub filename: String,
    pub blocks: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecallArticle {
    pub filename: String,
    pub title: String,
    pub content: String,
    pub created: i64,
    pub modified: i64,
    pub created_date: String,
    pub tags: Vec<String>,
}

#[tauri::command]
async fn get_timeline_data(app: tauri::AppHandle) -> Result<Vec<DayRecord>, String> {
    query_timeline(&get_db_connection(&app)?)
}

fn query_timeline(conn: &rusqlite::Connection) -> Result<Vec<DayRecord>, String> {
    let mut stmt = conn.prepare(
        "SELECT d.created_date, d.stem, d.kind, d.title, d.created, d.modified,
                b.content, t.name
         FROM documents d JOIN blocks b ON b.date = d.stem
         LEFT JOIN block_tags bt ON bt.block_id = b.id
         LEFT JOIN tags t ON t.id = bt.tag_id
         ORDER BY d.created_date DESC, d.created DESC, b.id ASC, t.name ASC"
    ).map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut records: Vec<DayRecord> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let date: String = row.get(0).map_err(|e| e.to_string())?;
        let filename = format!("{}.md", row.get::<_, String>(1).map_err(|e| e.to_string())?);
        let kind: String = row.get(2).map_err(|e| e.to_string())?;
        let content: String = row.get(6).map_err(|e| e.to_string())?;
        let tag: Option<String> = row.get(7).map_err(|e| e.to_string())?;
        if records.last().is_none_or(|day| day.date != date) {
            records.push(DayRecord { date: date.clone(), tags: vec![], articles: vec![] });
        }
        let day = records.last_mut().unwrap();
        if kind == "article" {
            if !day.articles.iter().any(|article| article.filename == filename) {
                day.articles.push(RecallArticle {
                    filename: filename.clone(), title: row.get(3).map_err(|e| e.to_string())?,
                    content, created: row.get(4).map_err(|e| e.to_string())?,
                    modified: row.get(5).map_err(|e| e.to_string())?,
                    created_date: date, tags: vec![],
                });
            }
            let article = day.articles.iter_mut().find(|article| article.filename == filename).unwrap();
            if let Some(tag) = tag {
                if !article.tags.contains(&tag) { article.tags.push(tag); }
            }
        } else if let Some(tag) = tag {
            if let Some(group) = day.tags.iter_mut().find(|group| group.tag == tag && group.filename == filename) {
                group.blocks.push(content);
            } else {
                day.tags.push(TagGroup { tag, filename, blocks: vec![content] });
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
    initialize_index(&conn)?;
    Ok(conn)
}

fn initialize_index(conn: &rusqlite::Connection) -> Result<(), String> {
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

    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            stem TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT NOT NULL
        )", [],
    ).map_err(|e| e.to_string())?;

    let columns: Vec<String> = conn.prepare("PRAGMA table_info(documents)").map_err(|e| e.to_string())?
        .query_map([], |row| row.get(1)).map_err(|e| e.to_string())?
        .collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    for (name, definition) in [("created", "INTEGER NOT NULL DEFAULT 0"),
        ("modified", "INTEGER NOT NULL DEFAULT 0"), ("created_date", "TEXT NOT NULL DEFAULT ''")] {
        if !columns.iter().any(|column| column == name) {
            conn.execute(&format!("ALTER TABLE documents ADD COLUMN {} {}", name, definition), [])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn index_document(conn: &rusqlite::Connection, date: &str, content: &str, times: &NoteTimes) -> Result<(), String> {
    conn.execute_batch("SAVEPOINT document_index").map_err(|e| e.to_string())?;
    match index_document_content(conn, date, content, times) {
        Ok(()) => conn.execute_batch("RELEASE document_index").map_err(|e| e.to_string()),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK TO document_index; RELEASE document_index");
            Err(error)
        }
    }
}

fn index_document_content(conn: &rusqlite::Connection, date: &str, content: &str, times: &NoteTimes) -> Result<(), String> {
    let filename = format!("{}.md", date);
    let kind = documents::kind(&filename);
    conn.execute("INSERT OR REPLACE INTO documents (stem, kind, title, created, modified, created_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![date, kind, documents::title(&filename, content), times.created, times.modified, times.created_date]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM blocks WHERE date = ?1", rusqlite::params![date])
        .map_err(|e| e.to_string())?;
    if kind == "article" {
        let body = documents::split(content).1;
        let mut tags = documents::tags(body);
        if tags.is_empty() { tags.push("默认".into()); }
        return insert_index_block(conn, date, body, content, &tags);
    }

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

                if end_offset > 0 && !trimmed[tag_body_start..].starts_with('#') {
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

        insert_index_block(conn, date, &clean_content, &block, &[found_tag])?;
    }

    Ok(())
}

fn insert_index_block(conn: &rusqlite::Connection, date: &str, content: &str, raw: &str, tags: &[String]) -> Result<(), String> {
    conn.execute("INSERT INTO blocks (date, content, raw_markdown) VALUES (?1, ?2, ?3)",
        rusqlite::params![date, content, raw]).map_err(|e| e.to_string())?;
    let block_id = conn.last_insert_rowid();
    for tag in tags {
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag]).map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO block_tags (block_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2",
            rusqlite::params![block_id, tag]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ShadowBlock {
    pub id: i64,
    pub date: String,
    pub filename: String,
    pub title: String,
    pub kind: String,
    pub content: String,
    pub raw_markdown: String,
    pub created: i64,
    pub modified: i64,
}

#[tauri::command(rename_all = "camelCase")]
async fn query_blocks_by_tag(app: tauri::AppHandle, tag: String, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<ShadowBlock>, String> {
    query_tag_blocks(&get_db_connection(&app)?, &tag, start_date.as_deref(), end_date.as_deref())
}

fn query_tag_blocks(conn: &rusqlite::Connection, tag: &str, start_date: Option<&str>, end_date: Option<&str>) -> Result<Vec<ShadowBlock>, String> {
    let mut stmt = conn.prepare(
        "SELECT b.id, d.created_date, b.content, b.raw_markdown, d.title, d.kind, d.stem, d.created, d.modified
         FROM blocks b
         JOIN documents d ON d.stem = b.date
         JOIN block_tags bt ON b.id = bt.block_id
         JOIN tags t ON bt.tag_id = t.id
         WHERE t.name = ?1 AND (?2 IS NULL OR d.created_date >= ?2) AND (?3 IS NULL OR d.created_date <= ?3)
         ORDER BY d.created_date DESC, d.created DESC, b.id ASC"
    ).map_err(|e| e.to_string())?;

    let blocks_iter = stmt.query_map(rusqlite::params![tag, start_date, end_date], |row| {
        Ok(ShadowBlock {
            id: row.get(0)?,
            date: row.get(1)?,
            content: row.get(2)?,
            raw_markdown: row.get(3)?,
            filename: format!("{}.md", row.get::<_, String>(6)?),
            title: row.get(4)?,
            kind: row.get(5)?,
            created: row.get(7)?,
            modified: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    blocks_iter.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
    for entry in WalkDir::new(&target_dir).max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !name.ends_with(".md") {
            continue;
        }
        let stem = documents::stem(&name);
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
    pub filename: String,
    pub title: String,
    pub kind: String,
    pub snippet: String,
    pub context_preview: String,
    pub created: i64,
    pub modified: i64,
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
        "SELECT b.id, d.created_date, b.content, d.title, d.kind, d.stem, d.created, d.modified FROM blocks b JOIN documents d ON d.stem = b.date
         WHERE b.content LIKE ?1 OR d.title LIKE ?1 ORDER BY d.created_date DESC, d.created DESC, b.id ASC LIMIT 15"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![sql_query], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, i64>(6)?, row.get::<_, i64>(7)?))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let query_lower = query_trim.to_lowercase();

    for row_result in rows.filter_map(Result::ok) {
        let (id, date, body, title, kind, stem, created, modified) = row_result;
        let content = if kind == "article" { format!("{}\n\n{}", title, body) } else { body };
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

            results.push(SearchResult { id: id.to_string(), filename: format!("{}.md", stem), date, title, kind, created, modified, snippet: format!("{}{}{}", prefix, compressed, suffix), context_preview: final_preview });
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
        if entry.file_type().is_file() && (!markdown_only || entry.path().extension().is_some_and(|e| e == "md") || entry.file_name() == note_times::REGISTRY) {
            files.push(entry.path().to_owned());
        }
    }
    files.sort();
    Ok(files)
}

fn copy_workspace(source: &Path, target: &Path, markdown_only: bool) -> Result<(), String> {
    copy_files(source, target, markdown_only, false)
}

// Restoring overwrites files that differ. Migration keeps the safer refusal.
fn copy_files(source: &Path, target: &Path, markdown_only: bool, overwrite: bool) -> Result<(), String> {
    let source_registry = note_times::ensure_workspace(source)?;
    let registry_path = source.join(note_times::REGISTRY);
    let files = workspace_files(source, markdown_only)?;
    let registry_bytes = if files.contains(&registry_path) {
        Some(fs::read(&registry_path).map_err(|e| format!("COPY_ERROR: {}", e))?)
    } else { None };
    for path in &files {
        let relative = path.strip_prefix(source).map_err(|e| e.to_string())?;
        let dest = target.join(relative);
        let mut component_path = target.to_owned();
        for component in relative.components() {
            component_path.push(component);
            match fs::symlink_metadata(&component_path) {
                Ok(meta) if meta.file_type().is_symlink() => return Err("COPY_CONFLICT: target contains a symbolic link".into()),
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("COPY_ERROR: {}", e)),
                _ => {}
            }
        }
        if path != &registry_path && dest.exists() && !overwrite
            && fs::read(&dest).map_err(|e| format!("COPY_ERROR: {}", e))?
                != fs::read(path).map_err(|e| format!("COPY_ERROR: {}", e))? {
            return Err(format!("COPY_CONFLICT: {}", dest.display()));
        }
    }
    fs::create_dir_all(target).map_err(|e| format!("COPY_ERROR: {}", e))?;
    let mut target_registry = if overwrite { std::collections::BTreeMap::new() } else { note_times::ensure_workspace(target)? };
    for path in files.iter().filter(|path| *path != &registry_path) {
        let dest = target.join(path.strip_prefix(source).map_err(|e| e.to_string())?);
        let bytes = fs::read(path).map_err(|e| format!("COPY_ERROR: {}", e))?;
        let mut write_times = overwrite;
        if dest.exists() {
            let current = fs::read(&dest).map_err(|e| format!("COPY_ERROR: {}", e))?;
            if current != bytes {
                if !overwrite { return Err(format!("COPY_CONFLICT: {}", dest.display())); }
                atomic_write(&dest, &bytes)?;
                write_times = true;
            }
        } else {
            fs::create_dir_all(dest.parent().unwrap()).map_err(|e| format!("COPY_ERROR: {}", e))?;
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&dest)
                .map_err(|e| format!("COPY_ERROR: {}", e))?;
            file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| format!("COPY_ERROR: {}", e))?;
            write_times = true;
        }
        if write_times {
            let source_modified = fs::metadata(path).and_then(|meta| meta.modified()).map_err(|e| format!("COPY_ERROR: {}", e))?;
            fs::OpenOptions::new().write(true).open(&dest)
                .and_then(|file| file.set_times(fs::FileTimes::new().set_modified(source_modified)))
                .map_err(|e| format!("COPY_ERROR: {}", e))?;
        }
        if fs::read(&dest).map_err(|e| e.to_string())? != bytes
            || fs::read(path).map_err(|e| e.to_string())? != bytes {
            return Err("COPY_ERROR: verification failed or source changed".into());
        }
    }
    for path in files.iter().filter(|path| *path != &registry_path) {
        let dest = target.join(path.strip_prefix(source).map_err(|e| e.to_string())?);
        if fs::read(path).map_err(|e| format!("COPY_ERROR: {}", e))?
            != fs::read(dest).map_err(|e| format!("COPY_ERROR: {}", e))? {
            return Err("COPY_ERROR: source changed during copy".into());
        }
    }
    if workspace_files(source, markdown_only)? != files {
        return Err("COPY_ERROR: source file set changed".into());
    }
    if let Some(bytes) = registry_bytes {
        if fs::read(&registry_path).map_err(|e| format!("COPY_ERROR: {}", e))? != bytes {
            return Err("COPY_ERROR: source creation times changed during copy".into());
        }
        if overwrite { target_registry = source_registry; }
        else {
            for (name, entry) in source_registry {
                if source.join(&name).is_file() { target_registry.entry(name).or_insert(entry); }
            }
        }
        let bytes = serde_json::to_vec_pretty(&target_registry).map_err(|e| e.to_string())?;
        atomic_write(&target.join(note_times::REGISTRY), &bytes)?;
    }
    Ok(())
}

fn rebuild_index_for_workspace(app: &tauri::AppHandle, workspace: &Path) -> Result<usize, String> {
    let mut conn = open_workspace_index(app, workspace)?;
    rebuild_workspace_index(&mut conn, workspace)
}

fn rebuild_workspace_index(conn: &mut rusqlite::Connection, workspace: &Path) -> Result<usize, String> {
    let registry = note_times::ensure_workspace(workspace)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM blocks", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tags", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM documents", []).map_err(|e| e.to_string())?;
    let files: Vec<_> = workspace_files(workspace, true)?.into_iter()
        .filter(|path| path.parent() == Some(workspace) && path.extension().is_some_and(|ext| ext == "md")
            && !path.file_name().unwrap().to_string_lossy().starts_with('.')).collect();
    for path in &files {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let filename = path.file_name().and_then(|s| s.to_str()).ok_or("INVALID_FILENAME")?;
        let times = note_times::get(workspace, filename, &registry)?;
        index_document(&tx, documents::stem(filename), &content, &times)?;
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
    for old in snapshot_dirs(backups)?.into_iter().skip(10) {
        // A retention failure does not invalidate a successfully published snapshot.
        if let Err(e) = fs::remove_dir_all(&old) { log::warn!("Backup retention failed: {}", e); }
    }
    Ok(published)
}

#[derive(Serialize)]
struct BackupSnapshot {
    id: String,
    created: String,
    files: usize,
}

// Only directories named like a published snapshot are restorable.
fn snapshot_dirs(backups: &Path) -> Result<Vec<PathBuf>, String> {
    let mut snapshots = Vec::new();
    if !backups.exists() { return Ok(snapshots); }
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
    Ok(snapshots)
}

fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(|e| e.to_string())?.join("Silens_Backups"))
}

// Newest first. Unfinished stages and anything not named like a snapshot are skipped.
fn list_snapshots(backups: &Path) -> Result<Vec<BackupSnapshot>, String> {
    snapshot_dirs(backups)?.into_iter().map(|path| {
        let id = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
        let created = id.get(..19).unwrap_or("").replace('_', " ");
        let files = workspace_files(&path, true)?.iter()
            .filter(|file| file.extension().is_some_and(|ext| ext == "md")).count();
        Ok(BackupSnapshot { id, created, files })
    }).collect()
}

// The current workspace is snapshotted first, so a restore can itself be undone.
// Files absent from the snapshot are removed; the pre-restore snapshot keeps them.
fn restore_snapshot(workspace: &Path, backups: &Path, id: &str) -> Result<(), String> {
    let snapshot = backups.join(id);
    if snapshot_dirs(backups)?.iter().all(|path| path != &snapshot) {
        return Err("BACKUP_NOT_FOUND: 未找到这份备份".into());
    }
    snapshot_workspace(workspace, backups)?;
    note_times::ensure_workspace(&snapshot)?;
    let incoming = workspace_files(&snapshot, false)?;
    copy_files(&snapshot, workspace, false, true)?;
    for path in workspace_files(workspace, false)? {
        let relative = path.strip_prefix(workspace).map_err(|e| e.to_string())?;
        if !incoming.iter().any(|kept| kept.strip_prefix(&snapshot).ok() == Some(relative)) {
            fs::remove_file(&path).map_err(|e| format!("RESTORE_ERROR: {}", e))?;
        }
    }
    Ok(())
}

// Snapshots are local and are published only after a verified copy.
fn perform_backup(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let source = get_active_workspace(app)?;
    Ok(snapshot_workspace(&source, &backups_dir(app)?)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupSnapshot>, String> {
    list_snapshots(&backups_dir(&app)?)
}

#[tauri::command]
fn restore_backup(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<StorageLock>();
    let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
    let workspace = get_active_workspace(&app)?;
    let backups = backups_dir(&app)?;
    restore_snapshot(&workspace, &backups, &id)?;
    if let Err(e) = rebuild_index_for_workspace(&app, &workspace) {
        log::warn!("Index rebuild after restore failed: {}", e);
    }
    Ok(())
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

    fn test_times() -> NoteTimes {
        NoteTimes { created: 100, modified: 200, created_date: "2026-11-02".into() }
    }

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
    fn document_stems_remain_unique_for_double_extensions() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        initialize_index(&conn).unwrap();
        for filename in ["笔记.md", "笔记.md.md"] {
            index_document(&conn, documents::stem(filename), "# 同名内容\n\n正文", &test_times()).unwrap();
        }
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM documents", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(documents::title("笔记.md.md", "正文"), "笔记.md");
    }

    #[test]
    fn articles_index_as_one_document_and_roll_back_failed_reindex() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        initialize_index(&conn).unwrap();
        index_document(&conn, "article-123", "# 原题\n\n#研究 第一段\n\n\n\n#论文 第二段\n\n`#代码`", &test_times()).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM blocks", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
        let tags: Vec<String> = conn.prepare("SELECT name FROM tags ORDER BY name").unwrap()
            .query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(tags, vec!["研究", "论文"]);
        index_document(&conn, "2026-11-02_旧记录", "#随记 第一段\n\n\n\n第二段", &test_times()).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM blocks WHERE date = '2026-11-02_旧记录'", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
        conn.execute_batch("CREATE TRIGGER fail_index BEFORE INSERT ON blocks BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        assert!(index_document(&conn, "article-123", "# 新题\n\n新内容", &test_times()).is_err());
        assert_eq!(conn.query_row("SELECT title FROM documents WHERE stem = 'article-123'", [], |row| row.get::<_, String>(0)).unwrap(), "原题");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM block_tags bt JOIN blocks b ON b.id = bt.block_id WHERE b.date = 'article-123'", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
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
    fn restore_replaces_workspace_and_keeps_a_snapshot_of_it() {
        let workspace = TempDir::new();
        let backups = TempDir::new();
        fs::write(workspace.0.join("kept.md"), "current").unwrap();
        fs::write(workspace.0.join("gone.md"), "removed by restore").unwrap();
        let snapshot = backups.0.join("2020-01-02_00-00-00");
        fs::create_dir(&snapshot).unwrap();
        fs::write(snapshot.join("kept.md"), "restored").unwrap();
        fs::write(snapshot.join("added.md"), "from snapshot").unwrap();
        fs::create_dir(backups.0.join(".incomplete-2020-01-01_00-00-00")).unwrap();

        let listed = list_snapshots(&backups.0).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].files, 2);

        assert!(restore_snapshot(&workspace.0, &backups.0, "../escape").is_err());
        assert_eq!(fs::read_to_string(workspace.0.join("kept.md")).unwrap(), "current");

        restore_snapshot(&workspace.0, &backups.0, "2020-01-02_00-00-00").unwrap();
        assert_eq!(fs::read_to_string(workspace.0.join("kept.md")).unwrap(), "restored");
        assert_eq!(fs::read_to_string(workspace.0.join("added.md")).unwrap(), "from snapshot");
        assert!(!workspace.0.join("gone.md").exists());
        let safety = list_snapshots(&backups.0).unwrap().into_iter()
            .find(|item| item.id != "2020-01-02_00-00-00").unwrap();
        let safety_dir = backups.0.join(&safety.id);
        assert_eq!(fs::read_to_string(safety_dir.join("gone.md")).unwrap(), "removed by restore");
        assert_eq!(fs::read_to_string(safety_dir.join("kept.md")).unwrap(), "current");
    }

    fn set_mtime(path: &Path, seconds: u64) {
        fs::OpenOptions::new().write(true).open(path).unwrap()
            .set_times(fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))).unwrap();
    }

    fn times_for(dir: &Path, filename: &str) -> NoteTimes {
        note_times::get(dir, filename, &note_times::load(dir).unwrap()).unwrap()
    }

    #[test]
    fn old_article_creation_survives_atomic_saves_and_rebuilds() {
        let dir = TempDir::new();
        let path = dir.0.join("old.md");
        fs::write(&path, "original").unwrap();
        set_mtime(&path, 1000);
        save_note(&dir.0, "old.md", "first", Some("original")).unwrap();
        let first = times_for(&dir.0, "old.md");
        assert_eq!(first.created, 1000);
        assert!(first.modified > 1000);
        set_mtime(&path, 2000);
        save_note(&dir.0, "old.md", "second", Some("first")).unwrap();
        let second = times_for(&dir.0, "old.md");
        assert_eq!(second.created, first.created);
        assert!(second.modified > 2000);
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        initialize_index(&conn).unwrap();
        for _ in 0..2 {
            assert_eq!(rebuild_workspace_index(&mut conn, &dir.0).unwrap(), 1);
            let indexed: (i64, i64, String) = conn.query_row("SELECT created, modified, created_date FROM documents", [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
            assert_eq!(indexed, (second.created, second.modified, second.created_date.clone()));
        }
    }

    #[test]
    fn journals_use_filename_day_and_bad_registry_preserves_text() {
        use chrono::TimeZone;
        let dir = TempDir::new();
        save_note(&dir.0, "2020-01-02_old.md", "original", None).unwrap();
        let times = times_for(&dir.0, "2020-01-02_old.md");
        assert_eq!(times.created_date, "2020-01-02");
        assert_eq!(times.created, Local.with_ymd_and_hms(2020, 1, 2, 0, 0, 0).earliest().unwrap().timestamp());
        fs::write(dir.0.join(note_times::REGISTRY), "{broken").unwrap();
        assert!(save_note(&dir.0, "2020-01-02_old.md", "replacement", Some("original")).is_err());
        assert_eq!(read_document(&dir.0.join("2020-01-02_old.md")).unwrap(), "original");
        assert_eq!(fs::read_to_string(dir.0.join(note_times::REGISTRY)).unwrap(), "{broken");
        assert_eq!(documents::kind("2020-02-30.md"), "article");
    }

    #[test]
    fn merging_workspaces_combines_creation_records_without_touching_existing_times() {
        let source = TempDir::new();
        let target = TempDir::new();
        fs::write(source.0.join("source.md"), "source note").unwrap();
        fs::write(target.0.join("target.md"), "target note").unwrap();
        fs::write(source.0.join("same.md"), "same content").unwrap();
        fs::write(target.0.join("same.md"), "same content").unwrap();
        set_mtime(&source.0.join("same.md"), 300);
        set_mtime(&target.0.join("same.md"), 400);
        atomic_write(&source.0.join(note_times::REGISTRY), br#"{"source.md":{"created":1000},"same.md":{"created":3000}}"#).unwrap();
        atomic_write(&target.0.join(note_times::REGISTRY), br#"{"target.md":{"created":2000},"same.md":{"created":4000}}"#).unwrap();
        copy_workspace(&source.0, &target.0, true).unwrap();
        let registry = note_times::load(&target.0).unwrap();
        assert_eq!(registry.len(), 3);
        assert_eq!(registry["source.md"].created, 1000);
        assert_eq!(registry["target.md"].created, 2000);
        assert_eq!(registry["same.md"].created, 4000);
        assert_eq!(note_times::get(&target.0, "same.md", &registry).unwrap().modified, 400);
    }

    #[test]
    fn conflicting_migration_does_not_seed_target_with_source_creation_time() {
        let source = TempDir::new();
        let target = TempDir::new();
        fs::write(source.0.join("old.md"), "source content").unwrap();
        fs::write(target.0.join("old.md"), "target content").unwrap();
        atomic_write(&source.0.join(note_times::REGISTRY), br#"{"old.md":{"created":1000}}"#).unwrap();
        assert!(copy_workspace(&source.0, &target.0, true).unwrap_err().starts_with("COPY_CONFLICT"));
        assert!(!target.0.join(note_times::REGISTRY).exists());
        assert_eq!(fs::read_to_string(target.0.join("old.md")).unwrap(), "target content");
        let registry = note_times::ensure_workspace(&target.0).unwrap();
        assert_ne!(registry["old.md"].created, 1000);
    }

    #[test]
    fn migration_backup_restore_preserve_times_and_note_counts() {
        let source = TempDir::new();
        let target = TempDir::new();
        let backups = TempDir::new();
        fs::write(source.0.join("old.md"), "old text").unwrap();
        set_mtime(&source.0.join("old.md"), 123456);
        copy_workspace(&source.0, &target.0, true).unwrap();
        let original = times_for(&source.0, "old.md");
        let copied = times_for(&target.0, "old.md");
        assert_eq!((copied.created, copied.modified), (original.created, original.modified));
        assert!(target.0.join(note_times::REGISTRY).is_file());
        let snapshot = snapshot_workspace(&target.0, &backups.0).unwrap();
        assert_eq!(list_snapshots(&backups.0).unwrap()[0].files, 1);
        // Identical bytes must still regain the snapshot's mtime.
        set_mtime(&target.0.join("old.md"), 654321);
        restore_snapshot(&target.0, &backups.0, snapshot.file_name().unwrap().to_str().unwrap()).unwrap();
        let restored = times_for(&target.0, "old.md");
        assert_eq!((restored.created, restored.modified), (original.created, original.modified));
        assert_eq!(fs::metadata(target.0.join("old.md")).unwrap().modified().unwrap(),
            fs::metadata(source.0.join("old.md")).unwrap().modified().unwrap());
    }

    #[test]
    fn timeline_includes_article_days_and_deduplicates_tags_and_sources() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        initialize_index(&conn).unwrap();
        let old = NoteTimes { created: 100, modified: 900, created_date: "2020-01-01".into() };
        let newer = NoteTimes { created: 200, modified: 800, created_date: "2020-01-02".into() };
        index_document(&conn, "only.md", "# Title\n\n#研究 #论文 Body", &newer).unwrap();
        index_document(&conn, "mixed", "# Mixed\n\n#研究 Body", &old).unwrap();
        index_document(&conn, "2020-01-01", "#研究 journal #其他", &old).unwrap();
        index_document(&conn, "2020-01-01_extra", "#研究 another", &old).unwrap();
        let days = query_timeline(&conn).unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].date, "2020-01-02");
        assert!(days[0].tags.is_empty());
        assert_eq!(days[0].articles.len(), 1);
        assert_eq!(days[0].articles[0].filename, "only.md.md");
        assert_eq!(days[0].articles[0].content, "#研究 #论文 Body");
        assert_eq!(days[0].articles[0].tags, vec!["研究", "论文"]);
        assert_eq!(days[1].articles.len(), 1);
        assert_eq!(days[1].tags.len(), 2);
        assert_ne!(days[1].tags[0].filename, days[1].tags[1].filename);
        assert!(days[1].tags.iter().all(|group| group.tag == "研究"));
        let all = query_tag_blocks(&conn, "研究", None, None).unwrap();
        assert_eq!(all.len(), 4);
        assert_eq!(all[0].filename, "only.md.md");
        assert_eq!(all[0].date, "2020-01-02");
        assert_eq!((all[0].created, all[0].modified), (200, 800));
        let filtered = query_tag_blocks(&conn, "研究", Some("2020-01-01"), Some("2020-01-01")).unwrap();
        assert_eq!(filtered.len(), 3);
        assert_eq!(filtered[0].kind, "article");
    }

    #[test]
    fn existing_index_schema_is_upgraded() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE documents (stem TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL);").unwrap();
        initialize_index(&conn).unwrap();
        initialize_index(&conn).unwrap();
        index_document(&conn, "old", "body", &test_times()).unwrap();
        assert_eq!(conn.query_row("SELECT created FROM documents", [], |row| row.get::<_, i64>(0)).unwrap(), 100);
    }

    #[test]
    fn test_document_serialization() {
        let doc = Document {
            filename: "test.md".into(),
            kind: "article".into(),
            journal_date: None,
            tags: vec![],
            title: "Title".into(),
            content: "Content".into(),
            created: 123456000,
            created_date: "1973-11-29".into(),
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
            list_backups,
            restore_backup,
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
            let state = app.state::<StorageLock>();
            let _guard = state.0.lock().map_err(|_| "STORAGE_LOCK_ERROR")?;
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
