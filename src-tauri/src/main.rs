// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct Document {
    filename: String,
    title: String,
    content: String,
    modified: i64,
}

// 获取当前激活的存储路径（支持异常检测与优雅降级）
fn get_active_workspace(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let docs_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let default_dir = docs_dir.join("Silens_Notes");
    let config_path = docs_dir.join(".silens_workspace");

    if let Ok(custom_path) = fs::read_to_string(&config_path) {
        let path = std::path::PathBuf::from(custom_path.trim()).join("Silens_Notes");
        // 异常检测：如果自定义路径挂了或被云盘释放，优雅降级回默认路径
        if path.is_dir() {
            return Ok(path);
        }
    }
    Ok(default_dir)
}

#[tauri::command]
fn get_storage_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = get_active_workspace(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn change_storage_path(app: tauri::AppHandle, new_path: String) -> Result<String, String> {
    let docs_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let config_path = docs_dir.join(".silens_workspace");
    
    let target_dir = std::path::PathBuf::from(&new_path).join("Silens_Notes");
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    
    fs::write(&config_path, new_path.trim()).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(target_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_document(
    app: tauri::AppHandle,
    content: String,
    _current_filename: Option<String>,
) -> Result<String, String> {
    // 1. Get storage directory (Cloud or Local)
    let target_dir = get_active_workspace(&app)?;

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| format!("无法创建目录: {}", e))?;
    }

    // 2. Determine filename: strictly YYYY-MM-DD.md
    let date = Local::now().format("%Y-%m-%d").to_string();
    let filename = format!("{}.md", date);

    let file_path = target_dir.join(&filename);
    let tmp_path = target_dir.join(format!("{}.tmp", filename));

    // 3. Write logic: UTF-8 no BOM
    fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("临时文件写入失败: {}", e))?;

    fs::rename(&tmp_path, &file_path).map_err(|e| format!("保存失败 (重命名异常): {}", e))?;

    // 4. 静默更新暗影索引 (Shadow Index)
    if let Ok(conn) = get_db_connection(&app) {
        let _ = index_document(&conn, &date, &content);
    }

    Ok(filename)
}

#[tauri::command]
fn save_file_as(
    app: tauri::AppHandle,
    content: String,
    filename: String,
) -> Result<(), String> {
    let target_dir = get_active_workspace(&app)?;

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| format!("无法创建目录: {}", e))?;
    }

    let clean_filename = filename
        .trim_end_matches(".md")
        .to_string();
    let file_path = target_dir.join(format!("{}.md", clean_filename));
    let tmp_path = target_dir.join(format!("{}.tmp", clean_filename));

    fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("文件写入失败: {}", e))?;

    fs::rename(&tmp_path, &file_path)
        .map_err(|e| format!("保存失败: {}", e))?;

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
    let file_path = target_dir.join(filename);

    if !file_path.exists() {
        return Err("文档不存在".to_string());
    }

    fs::read_to_string(file_path).map_err(|e| format!("无法读取文档: {}", e))
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
            fs::write(path, next_content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
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
            fs::write(path, next_content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
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
    update_tag_in_documents(app, &from, &to)
}

#[tauri::command]
fn delete_tag(app: tauri::AppHandle, tag: String) -> Result<Vec<String>, String> {
    if tag.trim().is_empty() {
        return Err("标签不能为空".to_string());
    }
    delete_tag_from_documents(app, &tag)
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
    let target_dir = get_active_workspace(app)?;

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    let db_path = target_dir.join(".shadow_index.db");
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
    let conn = get_db_connection(&app)?;
    
    // 重建前先清空索引数据
    conn.execute("DELETE FROM blocks", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags", []).map_err(|e| e.to_string())?;

    let documents = get_all_documents(app.clone()).await?;
    let mut count = 0;

    for doc in documents {
        let date = doc.filename.replace(".md", "");
        if index_document(&conn, &date, &doc.content).is_ok() {
            count += 1;
        }
    }

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

// 核心备份逻辑：静默克隆整个工作区到 Silens_Backups 目录
fn perform_backup(app: &tauri::AppHandle) -> Result<String, String> {
    let source_dir = get_active_workspace(app)?;
    // 双保险机制：备份快照永远写死在本地 Documents 目录，不随工作区前往云盘
    let docs_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let backups_base_dir = docs_dir.join("Silens_Backups");

    if !source_dir.exists() {
        return Err("源目录不存在".into());
    }

    // 将备份统一放在 Documents/Silens_Backups/YYYY-MM-DD_HH-MM-SS
    let date_str = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest_dir = backups_base_dir.join(date_str);

    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    // 递归复制所有文件（含 .md 和 SQLite .db 索引）
    for entry in WalkDir::new(&source_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if let Ok(relative) = path.strip_prefix(&source_dir) {
            let target_path = dest_dir.join(relative);
            if path.is_dir() {
                let _ = fs::create_dir_all(&target_path);
            } else if path.is_file() {
                let _ = fs::copy(path, &target_path);
            }
        }
    }
    
    // --- 新增：清理历史快照，仅保留最近 10 份 ---
    let max_keep = 10;
    if let Ok(entries) = fs::read_dir(&backups_base_dir) {
        let mut backup_dirs = Vec::new();
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                // 简单的目录名校验，判断是否是我们生成的 YYYY-MM-DD_HH-MM-SS
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.len() == 19 && name.contains('_') && name.contains('-') {
                        backup_dirs.push(path);
                    }
                }
            }
        }
        // 倒序排列，日期最新的排在最前
        backup_dirs.sort_by(|a, b| b.cmp(a));
        
        // 删除超出数量的历史旧快照
        if backup_dirs.len() > max_keep {
            for old_dir in backup_dirs.into_iter().skip(max_keep) {
                let _ = fs::remove_dir_all(old_dir);
            }
        }
    }

    Ok(dest_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_backups_folder(app: tauri::AppHandle) -> Result<(), String> {
    let docs_dir = app.path().document_dir().map_err(|e| e.to_string())?;
    let backups_dir = docs_dir.join("Silens_Backups");
    
    if !backups_dir.exists() {
        return Err("备份文件夹尚未创建".to_string());
    }

    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&backups_dir).spawn();
    
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&backups_dir).spawn();
    
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&backups_dir).spawn();
    
    Ok(())
}

#[tauri::command]
async fn create_backup(app: tauri::AppHandle) -> Result<String, String> {
    perform_backup(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            get_storage_path,
            change_storage_path,
            open_backups_folder,
            save_file_as
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            
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
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                // 拦截窗口关闭请求，执行最后一次静默安全备份后再退出
                let _ = perform_backup(window.app_handle());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
