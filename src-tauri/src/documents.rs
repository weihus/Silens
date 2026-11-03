use pulldown_cmark::{Event, Parser, Tag, TagEnd};

pub fn stem(filename: &str) -> &str {
    filename.strip_suffix(".md").unwrap_or(filename)
}

pub fn kind(filename: &str) -> &'static str {
    let bytes = filename.as_bytes();
    let dated = bytes.len() >= 13 && bytes.get(4) == Some(&b'-') && bytes.get(7) == Some(&b'-')
        && bytes[..10].iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (filename.get(10..) == Some(".md") || bytes.get(10) == Some(&b'_'))
        && chrono::NaiveDate::parse_from_str(&filename[..10], "%Y-%m-%d").is_ok();
    if dated { "journal" } else { "article" }
}

pub fn split(content: &str) -> (Option<String>, &str) {
    let end = content.find('\n').unwrap_or(content.len());
    let raw = content[..end].trim_end_matches('\r');
    let line = raw.trim_start_matches(' ');
    if raw.len() - line.len() > 3 { return (None, content); }
    let Some(rest) = line.strip_prefix('#') else { return (None, content); };
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) { return (None, content); }
    let mut title = rest.trim();
    let without_close = title.trim_end_matches('#');
    if without_close.ends_with([' ', '\t']) { title = without_close.trim_end(); }
    if title.chars().all(|c| c == '#') { title = ""; }
    let mut decoded = String::new();
    let mut chars = title.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek().is_some_and(|next| *next == '\\' || *next == '#') {
            decoded.push(chars.next().unwrap());
        } else { decoded.push(c); }
    }
    let mut body = &content[(end + usize::from(end < content.len()))..];
    if let Some(next) = body.strip_prefix("\r\n").or_else(|| body.strip_prefix('\n')) { body = next; }
    (Some(decoded), body)
}

pub fn title(filename: &str, content: &str) -> String {
    if kind(filename) == "article" {
        if let Some(title) = split(content).0.filter(|title| !title.is_empty()) { return title; }
        if filename.starts_with("article-") { return "未命名笔记".into(); }
    }
    stem(filename).to_owned()
}

pub fn tags(content: &str) -> Vec<String> {
    let mut tags = std::collections::BTreeSet::new();
    let mut code = false;
    for event in Parser::new(content) {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code = true,
            Event::End(TagEnd::CodeBlock) => code = false,
            Event::Text(text) if !code => {
                let mut cursor = 0;
                while let Some(pos) = text[cursor..].find('#') {
                    let start = cursor + pos;
                    let prev = text[..start].chars().next_back();
                    let tail = &text[start + 1..];
                    let len = tail.find(|c: char| c == '#' || super::is_tag_boundary(c)).unwrap_or(tail.len());
                    if super::tag_prefix_ok(prev) && len > 0 { tags.insert(tail[..len].chars().take(40).collect()); }
                    cursor = start + 1;
                }
            }
            _ => {}
        }
    }
    tags.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_journals_and_extracts_article_titles() {
        assert_eq!(kind("2026-11-02_old.md"), "journal");
        assert_eq!(title("2026-11-02.md", "# 标题"), "2026-11-02");
        assert_eq!(kind("article-123.md"), "article");
        assert_eq!(split("# 问题 ###\r\n\r\n## 分析"), (Some("问题".into()), "## 分析"));
        assert_eq!(split("# \n\n正文"), (Some("".into()), "正文"));
        assert_eq!(split("## 分析").0, None);
        assert_eq!(split("# ###").0, Some("".into()));
        assert_eq!(split(r"# 关于 C\# \#").0, Some("关于 C# #".into()));
        assert_eq!(title("article-123.md", "正文"), "未命名笔记");
    }
    #[test]
    fn article_tags_exclude_code_and_heading_syntax() {
        assert_eq!(tags("# 标题\n\n#研究 #论文\n\n`#示例`\n\n```\n#代码\n```\n\n## 分析"), vec!["研究", "论文"]);
    }
}
