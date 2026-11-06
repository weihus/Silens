use chrono::{Local, TimeZone, Timelike};
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::{collections::{BTreeMap, BTreeSet}, ops::Range};

#[derive(Debug, PartialEq, Eq)]
pub struct TextFeatures {
    pub clean_text: String,
    pub clean_char_count: usize,
    pub is_untagged: bool,
    pub is_noise: bool,
    pub works_mentions: BTreeMap<String, usize>,
    pub tags: Vec<String>,
    pub wiki_links: Vec<WikiLink>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiLink {
    pub target_filename: String,
    /// Exact half-open byte range in the original UTF-8 source.
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationAnchor {
    pub text: String,
    pub occurrence: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_tags_and_shared_wiki_occurrences() {
        let long = "长".repeat(50);
        let raw = format!("# 标题\n#乙 #甲 #乙 #默认 #{long}\n\\#假 `#代码 [[x]]` [[#隐藏|#显示]]");
        let value = extract(&raw);
        let mut expected = vec!["乙".to_owned(), "甲".into(), "默认".into(), "显示".into(), long];
        expected.sort();
        assert_eq!(value.tags, expected);
        assert!(extract("普通默认文字").tags.is_empty());
        let raw = "前 [[ A ]] [[A.md|别名]] [[A]] \\[[A]] `[[A]]`\n\n```\n[[A]]\n```\n\n    [[A]]\n\n[[[A]]] [[A\nB]]";
        let links = wiki_links(raw);
        assert_eq!(links.len(), 3);
        assert!(links.iter().all(|link| link.target_filename == "A.md"));
        assert_eq!(links.iter().map(|link| &raw[link.start..link.end]).collect::<Vec<_>>(),
                   vec!["[[ A ]]", "[[A.md|别名]]", "[[A]]"]);
        assert_eq!(extract(raw).wiki_links, links);
    }

    #[test]
    fn anchors_follow_rendered_text_and_source_order() {
        let raw = "```\n相同正文\n```\r\n\r\n**相同正文**\r\n\r\n相同正文\r\n\r\n#标签 [[目标|别名]] \\*文字\\*";
        let anchors = block_anchors(raw, &["**相同正文**", "相同正文", "#标签 [[目标|别名]] \\*文字\\*"], false);
        assert_eq!(anchors, vec![
            Some(NavigationAnchor { text: "相同正文".into(), occurrence: 1 }),
            Some(NavigationAnchor { text: "相同正文".into(), occurrence: 2 }),
            Some(NavigationAnchor { text: "#标签 [[目标|别名]] *文字*".into(), occurrence: 0 }),
        ]);
        assert_eq!(block_anchors("重复\n\n重复", &["重复", "重复"], false), vec![
            Some(NavigationAnchor { text: "重复".into(), occurrence: 0 }),
            Some(NavigationAnchor { text: "重复".into(), occurrence: 1 }),
        ]);
        assert_eq!(block_anchors("# 只有标题", &["# 只有标题"], true), vec![None]);
        assert_eq!(block_anchors("# 标题\r\n\r\n正文", &["# 标题\n\n正文"], true)[0].as_ref().unwrap().text, "正文");
        assert_eq!(block_anchors("第一段\n\n第二段", &["第一段\n\n第二段"], false)[0].as_ref().unwrap().text, "第一段");
        let long = "字".repeat(90);
        assert_eq!(block_anchors(&long, &[&long], false)[0].as_ref().unwrap().text.chars().count(), 80);
    }

    #[test]
    fn anchors_count_nonoverlapping_hits_in_each_textblock() {
        let raw = "`哈哈哈`\n\n**哈哈**\n\n哈\n\n哈\n\n哈哈";
        let anchors = block_anchors(raw, &["`哈哈哈`", "**哈哈**", "哈", "哈", "哈哈"], false);
        assert_eq!(anchors[1].as_ref().unwrap().occurrence, 1);
        assert_eq!(anchors[4], Some(NavigationAnchor { text: "哈哈".into(), occurrence: 2 }));
        let raw = "```\n相同\n```\n\n**相同**";
        assert_eq!(block_anchors(raw, &[raw], false), vec![Some(NavigationAnchor {
            text: "相同".into(), occurrence: 1,
        })]);
        let raw = "# 相同\n\n相同";
        assert_eq!(block_anchors(raw, &[raw], true)[0].as_ref().unwrap().occurrence, 0);
        assert_eq!(block_anchors("**粗体** 和 &amp; \\*星号\\*", &["**粗体** 和 &amp; \\*星号\\*"], false)[0]
            .as_ref().unwrap().text, "粗体 和 & *星号*");
        assert_eq!(block_anchors("前行\n后行  \n末行", &["前行\n后行  \n末行"], false)[0]
            .as_ref().unwrap().text, "前行 后行\u{fffc}末行");
    }

    #[test]
    fn html_projections_never_produce_false_anchors() {
        // Mirrored in src/utils/reflectionAnchors.test.ts using the real editor.
        for html in ["<div>**粗体**</div>", "前 <span>**粗体**</span> 后", "<!-- 注释 -->\n**粗体**"] {
            let raw = format!("粗体\n\n{html}\n\n粗体");
            assert_eq!(block_anchors(&raw, &["粗体", html, "粗体"], false), vec![None; 3]);
        }
        // HTML-looking source inside code is safe and still counts occurrences.
        let raw = "`<div>粗体</div>`\n\n**粗体**";
        assert_eq!(block_anchors(raw, &["**粗体**"], false), vec![Some(NavigationAnchor {
            text: "粗体".into(), occurrence: 1,
        })]);
    }

    #[test]
    fn normalized_h1_uses_visible_heading_and_wiki_label() {
        for (raw, expected) in [
            ("# **三体**", "三体"), ("# *活着*", "活着"),
            (r"# A\*B &amp; C", "A*B & C"),
            ("# 《**三体**》", "三体"), ("# 〈*活着*〉", "活着"),
            ("# [[hidden|**三体**]]", "三体"),
            ("# [[三体]]", "三体"), ("# 《 A　 B 》 ###", "A B"),
            ("#", ""), ("# ###\n\n正文", ""),
            ("# 一般文章", "一般文章"),
        ] {
            assert_eq!(normalized_h1(raw).as_deref(), Some(expected), "{raw}");
        }
        for raw in ["正文", "正文\n\n# 三体", "## 三体", "    # 三体", "```\n# 三体\n```"] {
            assert_eq!(normalized_h1(raw), None, "{raw}");
        }
        // Phase 1 clean_text retains formatting.
        assert_eq!(extract("# **三体**").clean_text, "**三体**");
    }

    #[test]
    fn work_source_offsets_survive_formatting_and_whitespace() {
        for (mention, work) in [("《百年  孤独》", "百年 孤独"), ("《百年**孤独**》", "百年孤独")] {
            let prefix = format!("`{mention}`\n\n```\n{mention}\n```\n\n{}", "前".repeat(410));
            let raw = format!("{prefix}{mention}{}", "后".repeat(220));
            let start = work_mention_start(&raw, work).unwrap();
            assert_eq!(start, prefix.len());
            assert!(raw.is_char_boundary(start));
            assert!(raw[start..].starts_with(mention));
            assert!(raw.chars().count() > 600);
            assert_eq!(extract(&raw).works_mentions[work], 1);
        }
        let raw = r"\《百年孤独》 [[《百年孤独》|隐藏]] [[target|《百年**孤独**》]]";
        assert_eq!(work_mention_start(raw, "百年孤独"), raw.find("《百年**孤独**》"));
        for raw in ["`《甲》`", "    《甲》", "[[《甲》|乙]]", "《甲`乙`》", r"\《甲》", "《#甲》"] {
            assert_eq!(work_mention_start(raw, "甲"), None, "{raw}");
        }
        let forty = "字".repeat(40);
        assert_eq!(work_mention_start(&format!("《{forty}》"), &forty), Some(0));
        let too_long = "字".repeat(41);
        assert_eq!(work_mention_start(&format!("《{too_long}》"), &too_long), None);
        assert_eq!(work_mention_start("《跨\n行》", "跨 行"), None);
        assert_eq!(work_mention_start("《甲》", ""), None);
    }

    #[test]
    fn title_works_only_use_actual_first_h1() {
        assert_eq!(title_works("# 《**甲**》与〈乙〉\n\n《正文》"), vec!["乙", "甲"]);
        assert!(title_works("正文\n\n# 《甲》").is_empty());
        assert!(title_works("## 《甲》").is_empty());
    }

    #[test]
    fn mixed_text_has_exact_counts_and_visible_works() {
        let value = extract("# 中A😀 #研究\n[[hidden《隐》|《书》]] 〈书〉 #默认\n[[目标]] e\u{301}");
        assert_eq!(value.clean_text, "中A😀 \n《书》 〈书〉 \n目标 e\u{301}");
        assert_eq!(value.clean_char_count, 19);
        assert!(!value.is_untagged);
        assert_eq!(value.works_mentions, BTreeMap::from([("书".into(), 2)]));
        let value = extract("《甲》 〈乙〉 《甲》");
        assert_eq!(value.clean_char_count, 11);
        assert_eq!(value.works_mentions, BTreeMap::from([("乙".into(), 1), ("甲".into(), 2)]));
    }

    #[test]
    fn normalization_preserves_case_and_collapses_unicode_space() {
        assert_eq!(normalize_work_name("  《 A\t\u{3000}B 》  "), "A B");
        assert_eq!(normalize_work_name("〈AbC〉"), "AbC");
        assert_eq!(normalize_work_name("《  》"), "");
        assert_eq!(normalize_work_name("《A〉"), "《A〉");
        assert_eq!(extract("《A\t B》 〈A\u{3000}B〉").works_mentions["A B"], 2);
    }

    #[test]
    fn only_real_headings_and_tags_are_removed() {
        assert_eq!(extract("  ## 标题 #真 ###\r\n\r\n内  部\t空格  ").clean_text,
                   "标题  \r\n\r\n内  部\t空格");
        assert_eq!(extract("标题\n===\n\n正文").clean_text, "标题\n\n\n正文");
        assert_eq!(extract("# 标题").clean_text, "标题");
        assert!(extract("# 标题").is_untagged);
        assert!(extract(r"\#转义 C# abc#no").is_untagged);
        assert!(!extract("#默认").is_untagged);
        assert_eq!(extract("a #甲，b #乙! c").clean_text, "a ，b ! c");
        assert_eq!(extract("a  b\r\n c\t d").clean_text, "a  b\r\n c\t d");
        assert_eq!(extract("   \r\n").clean_char_count, 0);
        assert!(extract("").is_untagged);
        assert!(!extract("").is_noise);
    }

    #[test]
    fn wiki_is_literal_when_escaped_or_malformed() {
        for raw in [r"\[[note|label]]", "[[note]", "[[note\nnext]]", "[[[note]]]", "[[|label]]"] {
            assert_eq!(extract(raw).clean_text, raw);
        }
        assert_eq!(extract("[[a|b]] [[c]]").clean_text, "b c");
        assert_eq!(extract("x[[a|  b\t ]]y").clean_text, "x  b\t y");
        assert_eq!(extract("x[[  target  ]]y").clean_text, "x  target  y");
        assert_eq!(extract("[[a|label #tag]]").clean_text, "label");
        assert!(!extract("[[a|label #tag]]").is_untagged);
        assert_eq!(extract(r"\\[[a|b]]").clean_text, r"\\b");
        assert_eq!(extract("[[《hidden》|label]]").works_mentions.len(), 0);
        assert_eq!(extract("[[target|《shown》]]").works_mentions["shown"], 1);
    }

    #[test]
    fn code_is_literal_and_never_interpreted() {
        for raw in ["`#tag 《书》 [[x|y]]`", "`` #tag ` 《书》 [[x]] ``",
                    "`multi\n《书》 #tag\nline`", "```md\n#tag 《书》\n\n\n\n[[x]]\n```",
                    "~~~\n#tag 《书》\n~~~", "    #tag 《书》\n\n    [[x]]",
                    "> ```\n> 《书》 #tag\n> ```"] {
            let value = extract(raw);
            assert_eq!(value.clean_text, raw.trim());
            assert!(value.is_untagged, "{raw}");
            assert!(value.works_mentions.is_empty(), "{raw}");
            assert!(!code_ranges(raw).is_empty(), "{raw}");
        }
        assert!(extract("《left`code`right》").works_mentions.is_empty());
        assert!(extract("[[target|《left`code`right》]]").works_mentions.is_empty());
        assert_eq!(extract("`《hidden》` 《real》").works_mentions["real"], 1);
        let raw = "before\n\n```\ncode\n\n\n\nend\n```\n\nafter";
        let ranges = code_ranges(raw);
        assert_eq!(ranges.len(), 1);
        assert!(raw[ranges[0].clone()].contains("code\n\n\n\nend\n```"));
        assert!(ranges[0].end <= raw.find("after").unwrap());
        assert!(code_ranges("``unclosed").is_empty());
    }

    #[test]
    fn work_length_and_malformed_boundaries() {
        assert_eq!(extract("《字》").works_mentions["字"], 1);
        let forty = "字".repeat(40);
        assert_eq!(extract(&format!("《{forty}》")).works_mentions[&forty], 1);
        for raw in ["《》".to_string(), "《   》".into(), "《未完".into(),
                    "《跨\n行》".into(), format!("《{}》", "字".repeat(41))] {
            assert!(extract(&raw).works_mentions.is_empty(), "{raw}");
        }
        assert!(extract(r"\《escaped》").works_mentions.is_empty());
        assert!(extract("plain").works_mentions.is_empty());
    }

    #[test]
    fn formatted_works_and_code_in_wiki_labels_keep_targets_hidden() {
        assert_eq!(extract("《**三体**》 〈*活着*〉").works_mentions,
            BTreeMap::from([("三体".into(), 1), ("活着".into(), 1)]));
        let value = extract("[[《隐藏作品》|`显示文字`]]");
        assert_eq!(value.clean_text, "`显示文字`");
        assert!(value.works_mentions.is_empty());
        let value = extract("[[#隐藏标签|`#示例 《代码》` 《真实》 #阅读]]");
        assert_eq!(value.clean_text, "`#示例 《代码》` 《真实》");
        assert!(!value.is_untagged);
        assert_eq!(value.works_mentions, BTreeMap::from([("真实".into(), 1)]));
        assert!(extract("[[#隐藏标签|`显示文字`]]").is_untagged);
        assert_eq!(extract("[[target|**《加粗》**]]").works_mentions["加粗"], 1);
    }

    #[test]
    fn incomplete_delimiters_do_not_consume_later_valid_mentions() {
        let raw = format!("{} {} 《完整》 [[note|末尾]]", "《".repeat(5000), "[[x ".repeat(5000));
        let value = extract(&raw);
        assert_eq!(value.works_mentions["完整"], 1);
        assert!(value.clean_text.ends_with("《完整》 末尾"));
    }

    #[test]
    fn noise_rules_and_exact_thresholds() {
        for raw in ["```\n```", "~~~\n~~~", "a | b\n--- | ---\nx | y",
                    "- [ ] todo", "- [x] done", "- [X] done", "- a\nprose", "1. a\nprose"] {
            assert!(extract(raw).is_noise, "{raw}");
        }
        for raw in ["---", "a\n---", "--- | ---", "- a\nprose\nmore", "[ ] text", "plain"] {
            assert!(!extract(raw).is_noise, "{raw}");
        }
        // http://a is eight Unicode characters: 8/80 is exactly ten percent.
        assert!(!extract(&format!("http://a {}", "字".repeat(71))).is_noise);
        assert!(extract(&format!("http://a {}", "字".repeat(70))).is_noise);
        for url in ["<http://a>", "[x](http://a)", "http://a。", "(http://a)"] {
            let padding = 80 - url.chars().count() - 1;
            assert!(!extract(&format!("{url} {}", "字".repeat(padding))).is_noise, "{url}");
            assert!(extract(&format!("{url} {}", "字".repeat(padding - 1))).is_noise, "{url}");
        }
        assert_eq!(url_char_count("https://例子.测试， http://a"), 21);
        assert_eq!(url_char_count("[x](https://a/b(c))"), 14);
    }

    #[test]
    fn hours_use_registered_local_time_and_journal_midnight_sentinel() {
        let date = chrono::NaiveDate::from_ymd_opt(2026, 11, 5).unwrap();
        let midnight = Local.from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap()).earliest().unwrap();
        let noon = Local.from_local_datetime(&date.and_hms_opt(12, 34, 0).unwrap()).earliest().unwrap();
        assert_eq!(hour_of_day("2026-11-05.md", midnight.timestamp()), None);
        assert_eq!(hour_of_day("2026-11-05_old.md", midnight.timestamp()), None);
        assert_eq!(hour_of_day("article-1.md", midnight.timestamp()), Some(0));
        assert_eq!(hour_of_day("2026-11-05.md", noon.timestamp()), Some(12));
        assert_eq!(hour_of_day("2026-11-06.md", midnight.timestamp()), Some(0));
        assert_eq!(hour_of_day("article-1.md", i64::MAX), None);
    }
}

#[derive(Default)]
struct RenderedBlock {
    text: String,
    // Source ranges and corresponding byte ranges in this textblock.
    pieces: Vec<(Range<usize>, Range<usize>)>,
    code: bool,
}

impl RenderedBlock {
    fn push(&mut self, text: &str, source: Range<usize>) {
        let start = self.text.len();
        self.text.push_str(text);
        self.pieces.push((source, start..self.text.len()));
    }
}

fn finish_rendered(current: &mut Option<RenderedBlock>, blocks: &mut Vec<RenderedBlock>) {
    if let Some(block) = current.take() {
        if !block.text.is_empty() { blocks.push(block); }
    }
}

// Match MarkdownEditor: marks disappear, Wiki/hashtags remain ordinary text,
// soft breaks collapse to spaces, and hard-break leaves use textBetween's U+FFFC.
fn rendered_blocks(body: &str, body_offset: usize, heading_only: bool) -> Option<Vec<RenderedBlock>> {
    let mut blocks = Vec::new();
    let mut current: Option<RenderedBlock> = None;
    let mut image_depth = 0usize;
    for (event, range) in Parser::new_ext(body, Options::ENABLE_STRIKETHROUGH).into_offset_iter() {
        let source = range.start + body_offset..range.end + body_offset;
        match event {
            Event::Start(Tag::Paragraph | Tag::Heading { .. } | Tag::CodeBlock(_)) => {
                finish_rendered(&mut current, &mut blocks);
                current = Some(RenderedBlock {
                    code: matches!(event, Event::Start(Tag::CodeBlock(_))),
                    ..RenderedBlock::default()
                });
            }
            Event::End(TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::CodeBlock)
            | Event::Start(Tag::List(_)) | Event::End(TagEnd::Item) => {
                finish_rendered(&mut current, &mut blocks);
            }
            Event::Start(Tag::Item) => {
                finish_rendered(&mut current, &mut blocks);
                current = Some(RenderedBlock::default());
            }
            // StarterKit has no image node; the generated img is discarded.
            Event::Start(Tag::Image { .. }) => image_depth += 1,
            Event::End(TagEnd::Image) => image_depth = image_depth.saturating_sub(1),
            Event::Text(text) | Event::Code(text) if image_depth == 0 => {
                current.get_or_insert_with(RenderedBlock::default).push(&text, source);
            }
            Event::SoftBreak if image_depth == 0 => {
                current.get_or_insert_with(RenderedBlock::default).push(" ", source);
            }
            Event::HardBreak if image_depth == 0 => {
                current.get_or_insert_with(RenderedBlock::default).push("\u{fffc}", source);
            }
            // A verified single-line H1 cannot contain an HTML block; inline
            // tags are literal and their surrounding Markdown still gets parsed.
            Event::InlineHtml(text) if heading_only && image_depth == 0 => {
                current.get_or_insert_with(RenderedBlock::default).push(&text, source);
            }
            // html:false also parses Markdown *inside* HTML-looking blocks.
            // Dropping just this block would corrupt later occurrence counts.
            Event::InlineHtml(_) | Event::Html(_) => return None,
            _ => {}
        }
    }
    finish_rendered(&mut current, &mut blocks);
    Some(blocks)
}

/// Project once per document. `blocks` must be in source order, with CRLF/LF
/// and outer whitespace differences allowed. Missing blocks produce None.
/// Anchors stay within one editor textblock and contain at most 80 Unicode scalars.
pub fn block_anchors(document: &str, blocks: &[&str], article: bool) -> Vec<Option<NavigationAnchor>> {
    let document = document.replace("\r\n", "\n");
    let body = if article { super::documents::split(&document).1 } else { &document };
    let Some(rendered) = rendered_blocks(body, document.len() - body.len(), false) else {
        return vec![None; blocks.len()];
    };
    let mut cursor = 0;
    let mut chosen = Vec::with_capacity(blocks.len());
    for block in blocks {
        let normalized = block.replace("\r\n", "\n");
        let needle = normalized.trim();
        if needle.is_empty() { chosen.push(None); continue; }
        let Some(relative) = document[cursor..].find(needle) else { chosen.push(None); continue; };
        let start = cursor + relative;
        let end = start + needle.len();
        cursor = end;
        let first = rendered.partition_point(|textblock| {
            textblock.pieces.last().is_some_and(|(source, _)| source.end <= start)
        });
        let mut fallback = None;
        let mut selected = None;
        for (index, textblock) in rendered.iter().enumerate().skip(first) {
            if textblock.pieces.first().is_some_and(|(source, _)| source.start >= end) { break; }
            let mut run: Option<Range<usize>> = None;
            for (source, visible) in &textblock.pieces {
                // A source chunk crossing the block boundary is not a safe locator.
                let source_end = source.start + document[source.clone()].trim_end().len();
                if source.start >= start && source.start < end && source_end <= end {
                    if let Some(run) = &mut run { run.end = visible.end; }
                    else { run = Some(visible.clone()); }
                } else if run.is_some() { break; }
            }
            let Some(run) = run else { continue; };
            let raw = &textblock.text[run.clone()];
            let trimmed = raw.trim();
            if trimmed.is_empty() { continue; }
            let offset = run.start + raw.len() - raw.trim_start().len();
            let text: String = trimmed.chars().take(80).collect();
            let candidate = (index, offset, text);
            if !textblock.code { selected = Some(candidate); break; }
            if fallback.is_none() { fallback = Some(candidate); }
        }
        chosen.push(selected.or(fallback));
    }

    // Match all distinct anchors in one pass. Bounded 80-scalar prefix lookups
    // avoid rescanning the entire document for every source block.
    struct Matches { count: usize, next: usize, request_cursor: usize, requests: Vec<(usize, usize, usize)> }
    let mut needles: BTreeMap<&str, Matches> = BTreeMap::new();
    let mut lengths = BTreeSet::new();
    for (request, selection) in chosen.iter().enumerate() {
        if let Some((block, offset, text)) = selection {
            lengths.insert(text.chars().count());
            needles.entry(text.as_str()).or_insert_with(|| Matches { count: 0, next: 0, request_cursor: 0, requests: Vec::new() })
                .requests.push((request, *block, *offset));
        }
    }
    for matches in needles.values_mut() {
        matches.requests.sort_by_key(|&(_, block, offset)| (block, offset));
    }
    let mut result = vec![None; blocks.len()];
    let max_length = lengths.last().copied().unwrap_or(0);
    // next is an offset in the concatenated textblocks; the separator ensures
    // non-overlap never carries into the next block (matches cannot cross it).
    let mut base = 0;
    for (index, block) in rendered.iter().enumerate() {
        for (start, _) in block.text.char_indices() {
            for (length, (at, ch)) in block.text[start..].char_indices().take(max_length).enumerate() {
                if !lengths.contains(&(length + 1)) { continue; }
                let end = start + at + ch.len_utf8();
                let Some(matches) = needles.get_mut(&block.text[start..end]) else { continue; };
                if base + start < matches.next { continue; }
                while let Some(&(request, target_block, offset)) = matches.requests.get(matches.request_cursor) {
                    if (target_block, offset) > (index, start) { break; }
                    if (target_block, offset) == (index, start) {
                        result[request] = Some(NavigationAnchor {
                            text: block.text[start..end].to_owned(), occurrence: matches.count,
                        });
                    }
                    matches.request_cursor += 1;
                }
                matches.count += 1;
                matches.next = base + end;
            }
        }
        base += block.text.len() + 1;
    }
    result
}

/// Normalize only a real leading H1. Wiki aliases are entity labels here;
/// navigation projections deliberately keep the literal Wiki syntax instead.
pub fn normalized_h1(raw: &str) -> Option<String> {
    super::documents::split(raw).0?;
    // Parse the original heading, not split's partially unescaped title.
    let heading = raw.lines().next().unwrap_or("");
    let (text, code) = source_masks(heading);
    let mut labeled = String::new();
    let mut cursor = 0;
    for (link, label) in scan_wiki(heading, &text, &code) {
        labeled.push_str(&heading[cursor..link.start]);
        labeled.push_str(&heading[label]);
        cursor = link.end;
    }
    labeled.push_str(&heading[cursor..]);
    let visible = rendered_blocks(&labeled, 0, true)?.into_iter()
        .map(|block| block.text).collect::<Vec<_>>().join(" ");
    Some(normalize_work_name(&visible))
}

fn source_masks(raw: &str) -> (Vec<bool>, Vec<bool>) {
    let mut code = vec![false; raw.len()];
    for range in code_ranges(raw) { mark(&mut code, range); }
    let mut text = vec![false; raw.len()];
    for (event, range) in Parser::new_ext(raw, Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS).into_offset_iter() {
        if matches!(event, Event::Text(_)) { mark(&mut text, range); }
    }
    (text, code)
}

/// Locate a visible, non-code work mention in original UTF-8 source bytes.
/// Uses extract's visible-title rules and at most 40 payload scalars per opening.
/// One document projection is built per call, never one scan per textblock.
pub fn work_mention_start(raw: &str, work: &str) -> Option<usize> {
    let work = normalize_work_name(work);
    if work.is_empty() { return None; }
    let (text, code) = source_masks(raw);
    let mut hidden = vec![false; raw.len()];
    let mut label_starts = BTreeSet::new();
    for (link, label) in scan_wiki(raw, &text, &code) {
        label_starts.insert(label.start);
        mark(&mut hidden, link.start..label.start);
        mark(&mut hidden, label.end..link.end);
    }
    // Preserve source offsets while removing only invisible Markdown marks.
    // Code and other syntax are barriers, exactly as in extract's work view.
    let mut visible = String::new();
    let mut positions = Vec::new();
    let mut tag_end = 0;
    for (at, ch) in raw.char_indices() {
        if hidden[at] || at < tag_end { continue; }
        if ch == '#' && text[at] && !code[at] && !escaped(raw, at)
            && (label_starts.contains(&at) || super::tag_prefix_ok(raw[..at].chars().next_back())) {
            let next = at + 1;
            let tail = &raw[next..];
            let length = tail.char_indices().find_map(|(i, c)| {
                (c == '#' || super::is_tag_boundary(c) || code[next + i] || hidden[next + i] || !text[next + i]).then_some(i)
            }).unwrap_or(tail.len());
            if length > 0 {
                tag_end = next + length;
                visible.push('\n');
                continue;
            }
        }
        let projected = if code[at] { '\n' }
            else if text[at] || ch == '\\' || ch.is_whitespace() { ch }
            else if "*_~".contains(ch) { continue; }
            else { '\n' };
        positions.push((visible.len(), at));
        visible.push(projected);
    }
    let mut consumed = 0;
    for (start, source) in positions {
        if start < consumed { continue; }
        let ch = visible[start..].chars().next().unwrap();
        let close = match ch { '《' => '》', '〈' => '〉', _ => continue };
        if escaped(raw, source) { continue; }
        let payload = start + ch.len_utf8();
        let Some((length, _)) = visible[payload..].char_indices().take(41)
            .take_while(|(_, c)| *c != '\r' && *c != '\n')
            .find(|(_, c)| *c == close) else { continue; };
        let name = normalize_work_name(&visible[payload..payload + length]);
        if name == work { return Some(source); }
        if !name.is_empty() { consumed = payload + length + close.len_utf8(); }
    }
    None
}

pub fn normalize_work_name(raw: &str) -> String {
    let trimmed = raw.trim();
    let inner = trimmed.strip_prefix('《').and_then(|s| s.strip_suffix('》'))
        .or_else(|| trimmed.strip_prefix('〈').and_then(|s| s.strip_suffix('〉')))
        .unwrap_or(trimmed);
    inner.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn hour_of_day(filename: &str, created: i64) -> Option<u8> {
    let time = Local.timestamp_opt(created, 0).single()?;
    if let Some(date) = super::note_times::journal_date(filename) {
        let midnight = Local.from_local_datetime(&date.and_hms_opt(0, 0, 0)?).earliest();
        if midnight.is_some_and(|value| value.timestamp() == created) {
            return None;
        }
    }
    Some(time.hour() as u8)
}

pub fn code_ranges(raw: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut block: Option<Range<usize>> = None;
    for (event, range) in Parser::new(raw).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => {
                let start = raw[..range.start].rfind('\n').map_or(0, |i| i + 1);
                block = Some(start..range.end);
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some(mut full) = block.take() {
                    full.end = full.end.max(range.end);
                    ranges.push(full);
                }
            }
            Event::Code(_) if block.is_none() => ranges.push(range),
            _ => {}
        }
    }
    if let Some(range) = block { ranges.push(range); }
    ranges.sort_by_key(|range| range.start);
    ranges
}

fn escaped(raw: &str, at: usize) -> bool {
    raw.as_bytes()[..at].iter().rev().take_while(|&&b| b == b'\\').count() % 2 == 1
}

fn mark(mask: &mut [bool], range: Range<usize>) {
    mask[range].fill(true);
}

fn heading_syntax(raw: &str, range: Range<usize>, removed: &mut [bool]) {
    let source = &raw[range.clone()];
    let first_end = source.find('\n').unwrap_or(source.len());
    let first = source[..first_end].trim_end_matches('\r');
    let indent = first.len() - first.trim_start_matches([' ', '\t']).len();
    let line = &first[indent..];
    let hashes = line.bytes().take_while(|&b| b == b'#').count();
    if (1..=6).contains(&hashes) && (hashes == line.len() || line[hashes..].starts_with([' ', '\t'])) {
        let rest = &line[hashes..];
        let spacing = rest.len() - rest.trim_start_matches([' ', '\t']).len();
        mark(removed, range.start..range.start + indent + hashes + spacing);
        let trimmed = first.trim_end_matches([' ', '\t']);
        let close = trimmed.len() - trimmed.trim_end_matches('#').len();
        let at = trimmed.len() - close;
        if close > 0 && at >= indent + hashes + spacing
            && at > 0 && matches!(first.as_bytes()[at - 1], b' ' | b'\t')
            && !escaped(raw, range.start + at) {
            // The whitespace preceding closing hashes belongs to the content.
            mark(removed, range.start + at..range.start + first.len());
        }
    } else {
        let trimmed = source.trim_end_matches(['\r', '\n']);
        if let Some(start) = trimmed.rfind('\n') {
            let underline = trimmed[start + 1..].trim();
            if !underline.is_empty() && (underline.chars().all(|c| c == '=') || underline.chars().all(|c| c == '-')) {
                mark(removed, range.start + start + 1..range.start + trimmed.len());
            }
        }
    }
}

fn wiki_label(raw: &str, start: usize, text: &[bool], code: &[bool]) -> Option<(usize, Range<usize>)> {
    if !raw[start..].starts_with("[[") || escaped(raw, start) || !text[start]
        || code[start] || (start > 0 && raw.as_bytes()[start - 1] == b'[') { return None; }
    let inside = start + 2;
    let mut divider = None;
    for (offset, ch) in raw[inside..].char_indices() {
        let at = inside + offset;
        if ch == '\n' || ch == '\r' { return None; }
        if code[at] { continue; }
        if ch == '[' { return None; }
        if ch == '|' && divider.is_none() { divider = Some(at); }
        if ch == ']' {
            if !raw[at..].starts_with("]]") || raw[at + 2..].starts_with(']') || escaped(raw, at) {
                return None;
            }
            let target_end = divider.unwrap_or(at);
            if raw[inside..target_end].trim().is_empty() || code[inside..target_end].iter().any(|&value| value) {
                return None;
            }
            return Some((at + 2, divider.map_or(inside, |position| position + 1)..at));
        }
    }
    None
}

fn scan_wiki(raw: &str, text: &[bool], code: &[bool]) -> Vec<(WikiLink, Range<usize>)> {
    let mut links = Vec::new();
    let mut cursor = 0;
    while cursor < raw.len() {
        if let Some((end, label)) = wiki_label(raw, cursor, text, code) {
            let target = raw[cursor + 2..end - 2].split('|').next().unwrap().trim();
            let target_filename = if target.ends_with(".md") { target.to_owned() } else { format!("{target}.md") };
            links.push((WikiLink { target_filename, start: cursor, end }, label));
            cursor = end;
        } else {
            cursor += raw[cursor..].chars().next().unwrap().len_utf8();
        }
    }
    links
}

/// Valid Wiki occurrences, including repeated targets, in source order.
pub fn wiki_links(raw: &str) -> Vec<WikiLink> {
    let mut code = vec![false; raw.len()];
    for range in code_ranges(raw) { mark(&mut code, range); }
    let mut text = vec![false; raw.len()];
    for (event, range) in Parser::new_ext(raw, Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS).into_offset_iter() {
        if matches!(event, Event::Text(_)) { mark(&mut text, range); }
    }
    scan_wiki(raw, &text, &code).into_iter().map(|(link, _)| link).collect()
}

/// Book-name entities from the actual first-line H1, never from the body or filename.
pub fn title_works(raw: &str) -> Vec<String> {
    if super::documents::split(raw).0.is_none() { return Vec::new(); }
    extract(raw.lines().next().unwrap_or("")).works_mentions.into_keys().collect()
}

fn collect_works(visible: &str, works: &mut BTreeMap<String, usize>) {
    let mut cursor = 0;
    while cursor < visible.len() {
        let ch = visible[cursor..].chars().next().unwrap();
        let start = cursor;
        cursor += ch.len_utf8();
        let close = match ch { '《' => '》', '〈' => '〉', _ => continue };
        if escaped(visible, start) { continue; }
        let Some((length, _)) = visible[cursor..].char_indices().take(41)
            .take_while(|(_, c)| *c != '\r' && *c != '\n').find(|(_, c)| *c == close) else { continue; };
        let inner = &visible[cursor..cursor + length];
        if inner.is_empty() { continue; }
        let name = normalize_work_name(inner);
        if !name.is_empty() { *works.entry(name).or_insert(0) += 1; }
        cursor += length + close.len_utf8();
    }
}

pub fn extract(raw: &str) -> TextFeatures {
    let mut code = vec![false; raw.len()];
    for range in code_ranges(raw) { mark(&mut code, range); }
    let mut text = vec![false; raw.len()];
    let mut removed = vec![false; raw.len()];
    let mut structural_noise = false;
    let mut list_lines = BTreeSet::new();
    let options = Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS;
    for (event, range) in Parser::new_ext(raw, options).into_offset_iter() {
        match event {
            Event::Text(_) => mark(&mut text, range),
            Event::Start(Tag::Heading { .. }) => heading_syntax(raw, range, &mut removed),
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(_)))
            | Event::Start(Tag::Table(_)) | Event::TaskListMarker(_) => structural_noise = true,
            Event::Start(Tag::Item) => {
                list_lines.insert(raw[..range.start].rfind('\n').map_or(0, |i| i + 1));
            }
            _ => {}
        }
    }
    let mut label_starts = BTreeSet::new();
    let mut wiki_links = Vec::new();
    for (link, label) in scan_wiki(raw, &text, &code) {
        mark(&mut removed, link.start..label.start);
        mark(&mut removed, label.end..link.end);
        label_starts.insert(label.start);
        wiki_links.push(link);
    }
    let mut output = String::with_capacity(raw.len());
    let mut visible = String::new();
    let mut works = BTreeMap::new();
    let mut tags = BTreeSet::new();
    let mut cursor = 0;
    while cursor < raw.len() {
        let ch = raw[cursor..].chars().next().unwrap();
        let next = cursor + ch.len_utf8();
        if removed[cursor] {
            cursor = next;
            continue;
        }
        if code[cursor] {
            output.push(ch);
            visible.push('\n'); // Never join a work title across excluded code.
        } else if ch == '#' && text[cursor] && !escaped(raw, cursor)
            && (label_starts.contains(&cursor) || super::tag_prefix_ok(raw[..cursor].chars().next_back())) {
            let tail = &raw[next..];
            let length = tail.char_indices().find_map(|(i, c)| {
                (c == '#' || super::is_tag_boundary(c) || code[next + i] || removed[next + i] || !text[next + i]).then_some(i)
            }).unwrap_or(tail.len());
            if length > 0 {
                tags.insert(tail[..length].to_owned());
                visible.push('\n');
                cursor = next + length;
                continue;
            }
            output.push(ch);
            visible.push(ch);
        } else {
            output.push(ch);
            if text[cursor] || ch == '\\' || ch.is_whitespace() {
                visible.push(ch);
            } else if !"*_~".contains(ch) {
                visible.push('\n');
            }
        }
        cursor = next;
    }
    collect_works(&visible, &mut works);
    let clean_text = output.trim().to_owned();
    let nonempty_lines = raw.lines().filter(|line| !line.trim().is_empty()).count();
    let total = raw.chars().count();
    let is_noise = structural_noise
        || (nonempty_lines > 0 && list_lines.len() >= nonempty_lines.div_ceil(2))
        || url_char_count(raw) > total / 10;
    TextFeatures {
        clean_char_count: clean_text.chars().count(), clean_text,
        is_untagged: tags.is_empty(), is_noise, works_mentions: works,
        tags: tags.into_iter().collect(), wiki_links,
    }
}

fn url_char_count(raw: &str) -> usize {
    let mut count = 0;
    let mut cursor = 0;
    while cursor < raw.len() {
        let tail = &raw[cursor..];
        let scheme = if tail.starts_with("https://") { 8 } else if tail.starts_with("http://") { 7 } else {
            cursor += tail.chars().next().unwrap().len_utf8();
            continue;
        };
        let mut end = cursor + scheme;
        let mut parentheses = 0usize;
        for (offset, ch) in raw[end..].char_indices() {
            if ch.is_whitespace() || "<>\"'`[]{}，。！？；：、".contains(ch) { break; }
            if ch == '(' { parentheses += 1; }
            if ch == ')' {
                if parentheses == 0 { break; }
                parentheses -= 1;
            }
            end = cursor + scheme + offset + ch.len_utf8();
        }
        let url = raw[cursor..end].trim_end_matches(['.', ',', '!', '?', ';', ':']);
        if url.len() > scheme { count += url.chars().count(); }
        cursor = end;
    }
    count
}
