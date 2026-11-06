//! Pure, bounded reflection context. No source lookup, persistence, or transport.
use crate::reflection::{PeriodReflectionResult, ReflectionPerspective};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const SYSTEM_PROMPT: &str = r#"你是一位隐于市的独立书店店主，也是写作者一位安静、温和、懂得保持分寸的老友。你正在阅读他这段时间的文字碎片摘要（包括书写节律、反复提及的作品、慢火打磨的文章标题，以及几段吉光片羽般的原文独白）。

请严格遵守以下写作准则：
1. 极度克制：正文严格控制在 140～220 字之间。像信笺末尾的几行手写钢笔字，温润、松弛、不煽情。
2. 绝对禁止「爹味」与说教：严禁评价用户的生产力（不要说“你真高产”、“写了这么多字很棒”），严禁给出人生指导或成功学建议，严禁使用“复盘”、“赋能”、“输出”、“坚持”、“加油”、“未来可期”等职场或励志词汇。
3. 如镜子般映照：不要机械罗列统计数字，而是把散落的深夜独白、某本牵挂的书、或那些没有贴上标签的松弛瞬间，用散文般的语调轻轻串联起来，映照出他这段时间思绪的呼吸与流向。
4. 严格返回 JSON 格式：{"poetic_title": "8～14字的诗意卷首题跋（不含书名号或引号）", "epilogue": "140～220字的卷尾按语正文"}，不要输出任何 Markdown 代码块包裹或额外解释。"#;

const BUDGET: usize = 1500;
const INVALID_PAYLOAD: &str = "摘要内容不符合要求，请重新生成预览。";
const INVALID_OUTPUT: &str = "按语格式不符合要求，请重试。";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RhythmSummary {
    pub active_days: usize,
    pub daily_blocks: usize,
    pub titled_articles: usize,
    pub untagged_blocks: usize,
    pub favorite_time: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopWork {
    pub name: String,
    pub days_span: usize,
    pub effective_chars: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrewedArticleSummary {
    pub title: String,
    pub span_days: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SanitizedReflectionPayload {
    pub period_label: String,
    pub perspective_label: String,
    pub rhythm_summary: RhythmSummary,
    pub top_works: Vec<TopWork>,
    pub brewed_articles: Vec<BrewedArticleSummary>,
    pub sampled_snippets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReflectionPayloadPreview {
    pub payload: SanitizedReflectionPayload,
    pub preview_json: String,
    pub char_count: usize,
    pub snippet_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReflectionEpilogue {
    pub poetic_title: String,
    pub epilogue: String,
}

fn wiki_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\[\]]*)\]\]").expect("static wiki regex"))
}

fn private_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| [
        // Deliberately conservative: slash-containing tokens may be paths even
        // without an extension. URI destinations and UNC shares are private too.
        r#"(?i)(?:file:|[a-z]:[\\/]|\\\\|/|~/|\.\.?/)[^\s<>\"'，。；！？、）】]*"#,
        r#"[^\s<>\"'，。；！？、（ ）【】]*[\\/][^\s<>\"'，。；！？、）】]*"#,
        r#"(?i)[^\s<>\"'，。；！？、（ ）【】]*(?:\.|%2e)md[^\s<>\"'，。；！？、）】]*"#,
        r#"(?i)[^\s<>\"'，。；！？、（ ）【】]*(?:\.|%2e)(?:[a-z][a-z0-9]{0,11}|[0-9]{1,3}[a-z][a-z0-9]{0,8})[^\s<>\"'，。；！？、）】]*"#,
        r#"(?i)[^\s<>\"'，。；！？、（ ）【】]*%(?:2f|5c)[^\s<>\"'，。；！？、）】]*"#,
        r"(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}[Tt\s]+)?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?",
        r"(?i)(?:sk-|sk_|AIza)[a-z0-9_-]{8,}",
        r"(?i)\bBearer\s+[a-z0-9._~+/-]{8,}=*",
        r"\d{1,2}时\d{1,2}分\d{1,2}秒",
        r"\d{9,16}(?:\.\d+)?",
        r"(?i)(?:unix|epoch|timestamp|created_at|modified_at|时间戳)\s*[:=：]?\s*-?\d+(?:\.\d+)?",
        r"(?i)article-[a-z0-9][a-z0-9-]{3,}(?:\.md)?",
        r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    ].iter().map(|pattern| Regex::new(pattern).expect("static privacy regex")).collect())
}

fn redact(value: &str) -> String {
    let mut text = value.to_owned();
    // Remove whole filenames and relative path tokens before their absolute
    // path suffixes, so a private basename cannot survive as a leftover prefix.
    for re in private_patterns().iter().rev() {
        text = re.replace_all(&text, " ").into_owned();
    }
    text
}

fn sanitize(value: &str, limit: usize) -> String {
    // Replace targets before parsing, including wiki syntax inside code. Unlike
    // text_features::extract, this projection must never retain target filenames.
    let wiki = wiki_regex().replace_all(value, |caps: &regex::Captures<'_>| {
        caps[1].split_once('|').map(|(_, label)| label.to_owned())
            .unwrap_or_else(|| "某篇笔记".to_owned())
    });
    let mut plain = String::new();
    let mut in_code = false;
    for event in Parser::new_ext(&wiki, Options::empty()) {
        match event {
            Event::Start(Tag::CodeBlock(_)) => { in_code = true; plain.push(' '); }
            Event::End(TagEnd::CodeBlock) => { in_code = false; plain.push(' '); }
            Event::Text(text) if !in_code => plain.push_str(&text),
            Event::SoftBreak | Event::HardBreak | Event::Rule | Event::End(_) => plain.push(' '),
            // Inline code, HTML, link destinations, and fenced code are omitted.
            _ => {}
        }
    }
    let text = redact(&plain);
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(limit).collect()
}

fn strings(payload: &SanitizedReflectionPayload) -> Vec<&str> {
    let mut values = vec![payload.period_label.as_str(), payload.perspective_label.as_str()];
    values.extend(payload.rhythm_summary.favorite_time.as_deref());
    values.extend(payload.top_works.iter().map(|work| work.name.as_str()));
    values.extend(payload.brewed_articles.iter().map(|article| article.title.as_str()));
    values.extend(payload.sampled_snippets.iter().map(String::as_str));
    values
}

fn unsafe_text(value: &str) -> bool {
    value.contains("[[") || value.contains("]]")
        || value.chars().any(|c| c.is_control())
        || private_patterns().iter().any(|re| re.is_match(value))
}

fn pretty(payload: &SanitizedReflectionPayload) -> Result<String, String> {
    serde_json::to_string_pretty(payload).map_err(|_| INVALID_PAYLOAD.to_owned())
}

/// Validate the approved object without rewriting even one character.
pub fn serialize_payload(payload: &SanitizedReflectionPayload) -> Result<String, String> {
    if payload.top_works.len() > 3 || payload.brewed_articles.len() > 2
        || payload.sampled_snippets.len() > 4
        || payload.sampled_snippets.iter().any(|s| s.chars().count() > 280)
        || payload.top_works.iter().any(|w| !w.effective_chars.is_finite() || w.effective_chars.is_sign_negative())
        || strings(payload).into_iter().any(unsafe_text)
    {
        return Err(INVALID_PAYLOAD.into());
    }
    let json = pretty(payload)?;
    if json.chars().count() > BUDGET { return Err(INVALID_PAYLOAD.into()); }
    Ok(json)
}

/// All selection is restricted to the currently visible result, in its order.
pub fn prepare_payload(result: &PeriodReflectionResult) -> Result<ReflectionPayloadPreview, String> {
    let month = |value: &str| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
        .map(|date| date.format("%Y年%-m月").to_string());
    let start = result.query.start_date.as_deref().filter(|value| *value != "0001-01-01").and_then(month);
    let end = result.query.end_date.as_deref().and_then(month);
    let period = match (start, end) {
        (Some(start), Some(end)) if start == end => start,
        (Some(start), Some(end)) => format!("{start}至{end}"),
        (Some(start), None) => format!("{start}以来"),
        (None, Some(end)) => format!("截至{end}"),
        (None, None) => "全部时光".into(),
    };
    let perspective = match &result.query.perspective {
        ReflectionPerspective::All => "全部文字".into(),
        ReflectionPerspective::Tag { tag } => format!("标签：{tag}"),
        ReflectionPerspective::Untagged => "无标签片段".into(),
        ReflectionPerspective::ArticlesOnly => "有题文章".into(),
    };
    let mut payload = SanitizedReflectionPayload {
        period_label: sanitize(&period, 96),
        perspective_label: sanitize(&perspective, 96),
        rhythm_summary: RhythmSummary {
            active_days: result.overview.active_days_count,
            daily_blocks: result.overview.daily_blocks_count,
            titled_articles: result.overview.titled_articles_count,
            untagged_blocks: result.themes.untagged_blocks_count,
            favorite_time: result.overview.favorite_time_bucket.as_ref()
                .map(|bucket| sanitize(&bucket.name, 48)).filter(|s| !s.is_empty()),
        },
        top_works: result.themes.deep_works.iter().take(3).map(|work| TopWork {
            name: sanitize(&work.work_name, 96),
            days_span: work.distinct_days_count,
            effective_chars: if work.effective_chars == 0.0 { 0.0 } else { work.effective_chars },
        }).collect(),
        brewed_articles: result.articles.longest_brewed.iter().take(2).map(|article| BrewedArticleSummary {
            title: sanitize(&article.title, 96), span_days: article.span_days,
        }).collect(),
        sampled_snippets: result.sampled_quotes.iter().take(4)
            .map(|quote| sanitize(&quote.content, 280)).filter(|s| !s.is_empty()).collect(),
    };
    payload.top_works.retain(|w| !w.name.is_empty());
    payload.brewed_articles.retain(|a| !a.title.is_empty());
    // Water filling: each round trims every longest string by one Unicode scalar.
    // Equal-length snippets lose equal space; serialized keys and escapes count.
    while pretty(&payload)?.chars().count() > BUDGET {
        let mut fields = vec![&mut payload.period_label, &mut payload.perspective_label];
        fields.extend(payload.rhythm_summary.favorite_time.iter_mut());
        fields.extend(payload.top_works.iter_mut().map(|w| &mut w.name));
        fields.extend(payload.brewed_articles.iter_mut().map(|a| &mut a.title));
        fields.extend(payload.sampled_snippets.iter_mut());
        let longest = fields.iter().map(|s| s.chars().count()).max().unwrap_or(0);
        if longest == 0 { return Err(INVALID_PAYLOAD.into()); }
        for field in fields {
            if field.chars().count() == longest { field.pop(); }
        }
        payload.sampled_snippets.retain(|s| !s.is_empty());
        payload.top_works.retain(|w| !w.name.is_empty());
        payload.brewed_articles.retain(|a| !a.title.is_empty());
        if payload.rhythm_summary.favorite_time.as_deref() == Some("") {
            payload.rhythm_summary.favorite_time = None;
        }
    }
    let preview_json = serialize_payload(&payload)?;
    Ok(ReflectionPayloadPreview {
        char_count: preview_json.chars().count(),
        snippet_count: payload.sampled_snippets.len(),
        payload, preview_json,
    })
}

pub fn parse_epilogue(input: &str) -> Result<ReflectionEpilogue, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Output { poetic_title: String, epilogue: String }
    let output: Output = serde_json::from_str(input).map_err(|_| INVALID_OUTPUT.to_owned())?;
    let title = &output.poetic_title;
    let body = &output.epilogue;
    let flattened_body = body.replace(['\r', '\n', '\t'], " ");
    let compact_body: String = body.chars().filter(|ch| !ch.is_whitespace()).collect();
    let banned = ["复盘", "赋能", "输出", "坚持", "加油", "未来可期", "你真高产", "写了这么多字很棒"];
    if !(8..=14).contains(&title.chars().count())
        || !(140..=220).contains(&body.chars().count())
        || title.trim() != title || body.trim() != body
        || title.chars().any(|c| "\"'“”‘’「」『』《》〈〉‹›«»＂＇".contains(c))
        || banned.iter().any(|word| title.contains(word) || compact_body.contains(word))
        || unsafe_text(title) || unsafe_text(&flattened_body)
    { return Err(INVALID_OUTPUT.into()); }
    Ok(ReflectionEpilogue { poetic_title: output.poetic_title, epilogue: output.epilogue })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn result() -> PeriodReflectionResult {
        serde_json::from_value(json!({
            "query": {"startDate": null, "endDate": null, "perspective": {"kind":"all"}, "pageSeed":0},
            "overview": {"activeDaysCount":4,"dailyBlocksCount":8,"titledArticlesCount":2,
                "favoriteTimeBucket":null,"richestDay":null},
            "themes": {"topTags":[],"untaggedBlocksCount":3,"totalDistinctWorksCount":0,"deepWorks":[]},
            "articles": {"longestBrewed":[],"mostReferenced":[]}, "sampledQuotes":[]
        })).unwrap()
    }

    #[test]
    fn fixed_system_prompt_is_unchanged() {
        let hash = SYSTEM_PROMPT.as_bytes().iter().fold(0xcbf29ce484222325u64,
            |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3));
        assert_eq!(hash, 0xdaedd061e4b5a71c);
    }

    #[test]
    fn metadata_only_and_casing() {
        let preview = prepare_payload(&result()).unwrap();
        assert_eq!(preview.snippet_count, 0);
        assert_eq!(preview.payload.rhythm_summary.active_days, 4);
        assert_eq!(serialize_payload(&preview.payload).unwrap(), preview.preview_json);
        let value = serde_json::to_value(preview).unwrap();
        assert!(value.get("previewJson").is_some());
        assert!(value["payload"].get("period_label").is_some());
    }

    #[test]
    fn wiki_markdown_code_and_private_tokens() {
        let raw = "**夜色** [[secret.md|灯火]] [[hidden]] `private.md`\n\n```\n秘密代码 /home/me\n```\n\n[雨声](file:///secret.md)";
        assert_eq!(sanitize(raw, 280), "夜色 灯火 某篇笔记 雨声");
        for raw in ["secret.md", "SECRET.MD", "/Users/alice/private.txt", r"C:\Users\alice\note.txt",
            r"\\server\share\note", "file:///tmp/secret", "notes/draft.txt", "2026-11-05T23:45:12Z",
            "23:45:12.123+08:00", "23时45分12秒", "&#47;Users/alice/note.md"] {
            assert!(sanitize(raw, 280).is_empty(), "privacy case failed");
        }
        assert_eq!(sanitize("[[secret.md|**留下的书名**]]", 280), "留下的书名");
    }

    #[test]
    fn coarse_period_and_embedded_timestamps_cannot_leak() {
        let mut source = result();
        source.query.start_date = Some("2026-10-03".into());
        source.query.end_date = Some("2026-10-29".into());
        assert_eq!(prepare_payload(&source).unwrap().payload.period_label, "2026年10月");
        for raw in ["记于1700000000之后", "记于4102444800之后", "1700000000000", "article-private-id", "a1234567-1234-1234-1234-123456789abc"] {
            let clean = sanitize(raw, 280);
            assert!(!unsafe_text(&clean));
            assert!(!clean.contains("1700000000") && !clean.contains("4102444800") && !clean.contains("article-private"));
            let mut payload = prepare_payload(&source).unwrap().payload;
            payload.sampled_snippets = vec![raw.into()];
            assert!(serialize_payload(&payload).is_err());
        }
    }

    #[test]
    fn attachments_and_historical_epochs_are_removed_and_rejected() {
        let base = prepare_payload(&result()).unwrap().payload;
        for value in ["private.txt", "工资明细.xlsx", "诊断报告.pdf", "archive.7z", "private%2Epdf", "946684800", "timestamp:31536000"] {
            assert!(sanitize(value, 280).is_empty(), "privacy token survived sanitization");
            let mut approved = base.clone();
            approved.sampled_snippets = vec![value.into()];
            assert!(serialize_payload(&approved).is_err());
        }
        assert_eq!(sanitize("1984", 40), "1984");
    }

    #[test]
    fn budget_unicode_fairness_selection_and_no_mutation() {
        let mut source = result();
        for id in 0..6 {
            source.sampled_quotes.push(serde_json::from_value(json!({
                "blockId":id,"filename":"NEVER_SEND.md","date":"PRIVATE_DATE",
                "content":"春😀\"".repeat(200),"contextAnchor":{"text":"PRIVATE_ANCHOR","occurrence":0},
                "slot":"generalHighlight","tags":["PRIVATE_TAG"]
            })).unwrap());
        }
        let before = source.clone();
        let preview = prepare_payload(&source).unwrap();
        assert_eq!(source, before);
        assert_eq!(preview.snippet_count, 4);
        assert!(preview.char_count <= 1500);
        assert_eq!(preview.char_count, preview.preview_json.chars().count());
        assert!(preview.preview_json.len() > preview.char_count);
        let sizes: Vec<_> = preview.payload.sampled_snippets.iter().map(|s| s.chars().count()).collect();
        assert!(sizes.iter().all(|n| *n <= 280 && *n == sizes[0]));
        assert!(!preview.preview_json.contains("PRIVATE"));
        assert!(!preview.preview_json.contains("NEVER_SEND"));
        assert_eq!(prepare_payload(&source).unwrap(), preview);
        let approved = preview.payload.clone();
        serialize_payload(&approved).unwrap();
        assert_eq!(approved, preview.payload);
    }

    #[test]
    fn validator_rejects_every_string_location_and_oversize() {
        let base = prepare_payload(&result()).unwrap().payload;
        let mut variants = Vec::new();
        let mut p = base.clone(); p.period_label = "/secret/name".into(); variants.push(p);
        let mut p = base.clone(); p.perspective_label = "note.md".into(); variants.push(p);
        let mut p = base.clone(); p.rhythm_summary.favorite_time = Some("01:02:03".into()); variants.push(p);
        let mut p = base.clone(); p.top_works.push(TopWork {name:r"C:\private".into(),days_span:1,effective_chars:2.0}); variants.push(p);
        let mut p = base.clone(); p.brewed_articles.push(BrewedArticleSummary {title:"[[secret]]".into(),span_days:1}); variants.push(p);
        let mut p = base.clone(); p.sampled_snippets.push("file:///secret".into()); variants.push(p);
        let mut p = base.clone(); p.period_label = "长".repeat(1500); variants.push(p);
        let mut p = base; p.sampled_snippets.push("😀".repeat(281)); variants.push(p);
        for p in variants {
            let before = p.clone();
            assert_eq!(serialize_payload(&p).unwrap_err(), INVALID_PAYLOAD);
            assert_eq!(p, before);
        }
    }

    #[test]
    fn unknown_fields_are_rejected_recursively() {
        let base = serde_json::to_value(prepare_payload(&result()).unwrap().payload).unwrap();
        let mut p = base.clone(); p["filename"] = json!("secret.md");
        assert!(serde_json::from_value::<SanitizedReflectionPayload>(p).is_err());
        let mut p = base.clone(); p["rhythm_summary"]["secret"] = json!(true);
        assert!(serde_json::from_value::<SanitizedReflectionPayload>(p).is_err());
        let mut p = base.clone(); p["top_works"] = json!([{"name":"书","days_span":1,"effective_chars":2,"filename":"secret"}]);
        assert!(serde_json::from_value::<SanitizedReflectionPayload>(p).is_err());
        let mut p = base; p["brewed_articles"] = json!([{"title":"书","span_days":1,"filename":"secret"}]);
        assert!(serde_json::from_value::<SanitizedReflectionPayload>(p).is_err());
    }

    #[test]
    fn strict_output_and_unicode_boundaries() {
        for size in [140, 220] {
            let valid = json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(size)}).to_string();
            let parsed = parse_epilogue(&valid).unwrap();
            assert!(serde_json::to_value(parsed).unwrap().get("poeticTitle").is_some());
        }
        let paragraphs = format!("{}\n\n{}", "夜".repeat(80), "纸".repeat(80));
        let valid_paragraphs = json!({"poetic_title":"灯下缓缓翻过一页","epilogue":paragraphs}).to_string();
        assert!(parse_epilogue(&valid_paragraphs).is_ok());
        let split_banned = json!({"poetic_title":"灯下缓缓翻过一页","epilogue":format!("{}加\n油", "夜".repeat(140))}).to_string();
        assert!(parse_epilogue(&split_banned).is_err());
        let valid = json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(140)}).to_string();
        for invalid in [format!("```json\n{valid}\n```"), format!("{valid} trailing"),
            valid.replace("poetic_title", "poeticTitle"),
            json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(139)}).to_string(),
            json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(221)}).to_string(),
            json!({"poetic_title":"《灯下缓缓翻过一页》","epilogue":"夜".repeat(140)}).to_string(),
            json!({"poetic_title":"灯下缓缓翻过一页","epilogue":"夜".repeat(140),"extra":"PRIVATE"}).to_string(),
            format!("{{\"poetic_title\":\"灯下缓缓翻过一页\",\"poetic_title\":\"灯下缓缓翻过一页\",\"epilogue\":\"{}\"}}", "夜".repeat(140))] {
            assert_eq!(parse_epilogue(&invalid).unwrap_err(), INVALID_OUTPUT);
        }
        for word in ["复盘", "赋能", "输出", "坚持", "加油", "未来可期", "你真高产", "写了这么多字很棒"] {
            let invalid = json!({"poetic_title":"灯下缓缓翻过一页","epilogue":format!("{}{word}", "夜".repeat(140))}).to_string();
            assert_eq!(parse_epilogue(&invalid).unwrap_err(), INVALID_OUTPUT);
        }
    }
}
