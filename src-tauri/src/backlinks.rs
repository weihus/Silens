use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Serialize)]
pub struct Backlink {
    filename: String,
    snippet: String,
    search_text: String,
    occurrence: usize,
}

fn first_reference(line: &str, filename: &str) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut pos = 0;
    while pos < bytes.len() {
        if bytes[pos] == b'\\' {
            pos += 2;
        } else if bytes[pos..].starts_with(b"[[") {
            let start = pos;
            pos += 2;
            let end = line[pos..].find(']').map(|offset| pos + offset)?;
            let target = line[pos..end].trim();
            if !target.is_empty() && !target.contains('[') && bytes[end..].starts_with(b"]]") {
                let normalized = if target.ends_with(".md") { target.to_string() } else { format!("{}.md", target) };
                if normalized == filename { return Some((start, end + 2)); }
            }
            pos = end + 1;
        } else {
            pos += 1;
        }
    }
    None
}

fn reference(content: &str, filename: &str) -> Option<(String, String, usize)> {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut code_block = false;
    let mut text_start = None;
    let mut text_end = 0;
    let mut candidates = Vec::new();
    for (event, range) in Parser::new(content).into_offset_iter() {
        if matches!(event, Event::Text(_)) && !code_block {
            let start = if range.start > 0 && content.as_bytes()[range.start - 1] == b'\\' {
                range.start - 1
            } else { range.start };
            if text_start.is_some() && start > text_end {
                candidates.push((text_start.take().unwrap(), text_end));
            }
            text_start.get_or_insert(start);
            text_end = range.end;
        } else {
            if let Some(start) = text_start.take() { candidates.push((start, text_end)); }
            if matches!(event, Event::Start(Tag::CodeBlock(_))) { code_block = true; }
            if matches!(event, Event::End(TagEnd::CodeBlock)) { code_block = false; }
        }
    }
    if let Some(start) = text_start { candidates.push((start, text_end)); }
    for (offset, limit) in candidates {
        if let Some((start, end)) = first_reference(&content[offset..limit], filename) {
            let start = offset + start;
            let end = offset + end;
            let line_start = content[..start].rfind('\n').map_or(0, |n| n + 1);
            let line_end = content[end..].find('\n').map_or(content.len(), |n| end + n);
            let line = &content[line_start..line_end];
            let chars: Vec<char> = line.chars().collect();
            let link_start = content[line_start..start].chars().count();
            let link_end = content[line_start..end].chars().count();
            let from = link_start.saturating_sub(60);
            let to = (link_end + 80).min(chars.len()).min(from + 180);
            let mut snippet = String::new();
            if from > 0 { snippet.push('…'); }
            snippet.extend(chars[from..to].iter());
            if to < chars.len() { snippet.push('…'); }
            let search_text = content[start..end].to_string();
            // Count earlier literal occurrences so navigation skips examples in code.
            let occurrence = content[..start].matches(search_text.as_str()).count();
            return Some((snippet.trim().to_string(), search_text, occurrence));
        }
    }
    None
}

fn find_backlinks(workspace: &Path, filename: &str) -> Result<Vec<Backlink>, String> {
    super::document_filename(Some(filename), "")?;
    let mut result = Vec::new();
    for entry in fs::read_dir(workspace).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == filename || name.starts_with('.') || !name.ends_with(".md")
            || !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
        let content = match fs::read_to_string(entry.path()) {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        };
        if let Some((snippet, search_text, occurrence)) = reference(&content, filename) {
            result.push(Backlink { filename: name, snippet, search_text, occurrence });
        }
    }
    result.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(result)
}

#[tauri::command]
pub async fn query_backlinks(app: tauri::AppHandle, filename: String) -> Result<Vec<Backlink>, String> {
    super::document_filename(Some(&filename), "")?;
    let workspace = super::get_active_workspace(&app)?;
    tauri::async_runtime::spawn_blocking(move || find_backlinks(&workspace, &filename))
        .await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("silens-backlinks-{}", crate::unique_suffix()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn matches_exact_targets_and_suffixes_with_unicode_context() {
        let (snippet, locator, _) = reference("想法 [[ 灵感.md ]] 继续生长", "灵感.md").unwrap();
        assert_eq!(locator, "[[ 灵感.md ]]");
        assert_eq!(snippet, "想法 [[ 灵感.md ]] 继续生长");
        assert!(reference("[[灵感]]", "灵感.md").is_some());
        for text in ["[[灵感集]]", "[[灵感#标题]]", "[[灵感|别名]]", "[[ ]]", "[[[灵感]]]", "[灵感]", "[[灵感]"] {
            assert!(reference(text, "灵感.md").is_none(), "{}", text);
        }
        assert!(reference("[[Case]]", "case.md").is_none());
        let long = format!("{} [[灵感]] {}", "前".repeat(300), "后".repeat(300));
        let (snippet, _, _) = reference(&long, "灵感.md").unwrap();
        assert!(snippet.contains("[[灵感]]"));
        assert!(snippet.chars().count() <= 182);
    }

    #[test]
    fn ignores_code_and_escaped_openings() {
        for text in ["`[[note]]`", "`` [[note]] ` ``", "\\[[note]]", "```md\n[[note]]\n```", "~~~\n[[note]]\n~~~", "    [[note]]", "\t[[note]]"] {
            assert!(reference(text, "note.md").is_none(), "{}", text);
        }
        assert!(reference("`example` and [[note]]", "note.md").is_some());
        assert!(reference("```\n[[note]]\n```\nReal [[note.md]]", "note.md").is_some());
        assert!(reference("``unclosed and [[note]]", "note.md").is_some());
        assert!(reference("`multi\n[[note]]\nline`", "note.md").is_none());
        assert!(reference("> ```\n> [[note]]\n> ```", "note.md").is_none());
        assert!(reference("- item\n\n    real [[note]]", "note.md").is_some());
        assert_eq!(reference("`[[note]]` then [[note]]", "note.md").unwrap().2, 1);
        assert_eq!(reference("\\[[note]] then [[note]]", "note.md").unwrap().2, 1);
    }

    #[test]
    fn counts_sources_and_tracks_edits_deletions_and_workspace() {
        let dir = TempDir::new();
        fs::write(dir.0.join("target.md"), "[[target]]").unwrap();
        fs::write(dir.0.join("b.md"), "first [[target]]\nagain [[target.md]]").unwrap();
        fs::write(dir.0.join("a.md"), "[[target.md]]").unwrap();
        fs::write(dir.0.join(".hidden.md"), "[[target]]").unwrap();
        fs::create_dir(dir.0.join("nested")).unwrap();
        fs::write(dir.0.join("nested/ignored.md"), "[[target]]").unwrap();
        let found = find_backlinks(&dir.0, "target.md").unwrap();
        assert_eq!(found.iter().map(|b| b.filename.as_str()).collect::<Vec<_>>(), vec!["b.md", "a.md"]);
        assert_eq!(found[0].search_text, "[[target]]");
        fs::write(dir.0.join("b.md"), "no link").unwrap();
        fs::remove_file(dir.0.join("a.md")).unwrap();
        assert!(find_backlinks(&dir.0, "target.md").unwrap().is_empty());
        let other = TempDir::new();
        assert!(find_backlinks(&other.0, "target.md").unwrap().is_empty());
        assert!(find_backlinks(&dir.0, "../target.md").is_err());
        assert!(find_backlinks(&dir.0.join("missing"), "target.md").is_err());
    }
}
