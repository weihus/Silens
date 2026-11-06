use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Serialize)]
pub struct Backlink {
    filename: String,
    title: String,
    snippet: String,
    search_text: String,
    occurrence: usize,
}

fn reference(content: &str, filename: &str) -> Option<(String, String, usize)> {
    let link = super::text_features::wiki_links(content).into_iter()
        .find(|link| link.target_filename == filename)?;
    let (start, end) = (link.start, link.end);
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
    // Preserve the existing backlink DTO and raw-prefix occurrence semantics.
    let occurrence = content[..start].matches(search_text.as_str()).count();
    Some((snippet.trim().to_string(), search_text, occurrence))
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
            result.push(Backlink { title: super::documents::title(&name, &content), filename: name, snippet, search_text, occurrence });
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
        assert!(reference("[[灵感|别名]]", "灵感.md").is_some());
        for text in ["[[灵感集]]", "[[灵感#标题]]", "[[ ]]", "[[[灵感]]]", "[灵感]", "[[灵感]"] {
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
    fn shared_scanner_preserves_raw_alias_locator_and_prefix_count() {
        let raw = "`[[目标.md|**别名**]]`\n\n前 [[目标.md|**别名**]] 后 [[目标]]";
        let (snippet, search_text, occurrence) = reference(raw, "目标.md").unwrap();
        assert_eq!(snippet, "前 [[目标.md|**别名**]] 后 [[目标]]");
        assert_eq!(search_text, "[[目标.md|**别名**]]");
        assert_eq!(occurrence, 1);
        assert_eq!(super::super::text_features::wiki_links(raw).len(), 2);
        for raw in ["[[目标\n续行]]", "[[[目标]]]", "[[目标]]]", "[[|目标]]"] {
            assert!(reference(raw, "目标.md").is_none());
        }
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
