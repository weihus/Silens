//! Owned index snapshots and deterministic, filesystem-free period reflection.
use chrono::NaiveDate;
use rusqlite::{named_params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReflectionPerspective {
    #[default]
    All,
    Tag { tag: String },
    Untagged,
    ArticlesOnly,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default)]
    pub perspective: ReflectionPerspective,
    #[serde(default)]
    pub page_seed: u32,
}

fn canonical_date(value: &str) -> Option<NaiveDate> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || &bytes[..4] == b"0000" || bytes[4] != b'-' || bytes[7] != b'-'
        || !bytes.iter().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit()) {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
        .filter(|date| date.format("%Y-%m-%d").to_string() == value)
}

impl ReflectionQuery {
    pub fn validate(&self) -> Result<(), String> {
        for (field, value) in [("startDate", &self.start_date), ("endDate", &self.end_date)] {
            if value.as_deref().is_some_and(|s| canonical_date(s).is_none()) {
                return Err(format!("{field} must be an actual canonical YYYY-MM-DD date"));
            }
        }
        if let (Some(start), Some(end)) = (&self.start_date, &self.end_date) {
            if start > end { return Err("startDate must not exceed endDate".into()); }
        }
        if let ReflectionPerspective::Tag { tag } = &self.perspective {
            if tag.trim().is_empty() { return Err("tag must not be empty".into()); }
        }
        Ok(())
    }

    fn contains(&self, date: &str) -> bool {
        self.start_date.as_deref().is_none_or(|start| date >= start)
            && self.end_date.as_deref().is_none_or(|end| date <= end)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextAnchor { pub text: String, pub occurrence: usize }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnippet {
    pub block_id: i64,
    pub filename: String,
    pub date: String,
    pub content: String,
    pub context_anchor: Option<ContextAnchor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuoteSlot { NightMonologue, UntaggedMoment, ConnectedThought, DistantEcho, GeneralHighlight }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampledQuote {
    pub block_id: i64,
    pub filename: String,
    pub date: String,
    pub content: String,
    pub context_anchor: Option<ContextAnchor>,
    pub slot: QuoteSlot,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteTimeBucket {
    pub name: String,
    pub peak_hour: u8,
    pub sample_count: usize,
    pub share: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleIdentity { pub filename: String, pub title: String }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichestDay {
    pub date: String,
    pub tags: Vec<String>,
    pub untagged_blocks_count: usize,
    pub articles: Vec<ArticleIdentity>,
    pub preview: String,
    pub preview_source: Option<SourceSnippet>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionOverview {
    pub active_days_count: usize,
    pub daily_blocks_count: usize,
    pub titled_articles_count: usize,
    pub favorite_time_bucket: Option<FavoriteTimeBucket>,
    pub richest_day: Option<RichestDay>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagFrequency { pub tag: String, pub count: usize }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepWork {
    pub work_name: String,
    pub mention_count: usize,
    pub distinct_days_count: usize,
    pub effective_chars: f64,
    pub filenames: Vec<String>,
    pub representative_quote: SourceSnippet,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionThemes {
    pub top_tags: Vec<TagFrequency>,
    pub untagged_blocks_count: usize,
    pub total_distinct_works_count: usize,
    pub deep_works: Vec<DeepWork>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewedArticle {
    pub title: String,
    pub filename: String,
    pub created_date: String,
    pub modified_date: String,
    pub span_days: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSource {
    pub filename: String,
    pub title: String,
    pub reference_count: usize,
    pub preview: String,
    pub context_anchor: Option<ContextAnchor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencedArticle {
    pub title: String,
    pub filename: String,
    pub reference_count: usize,
    pub source_count: usize,
    pub sources: Vec<ReferenceSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionArticles {
    pub longest_brewed: Vec<BrewedArticle>,
    pub most_referenced: Vec<ReferencedArticle>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodReflectionResult {
    pub query: ReflectionQuery,
    pub overview: ReflectionOverview,
    pub themes: ReflectionThemes,
    pub articles: ReflectionArticles,
    pub sampled_quotes: Vec<SampledQuote>,
}

// Snapshot types deliberately expose owned data for pure-engine tests. They are
// not IPC DTOs: no scores or index implementation details cross the IPC boundary.
#[derive(Debug, Clone, Default)]
pub struct ReflectionSnapshot {
    pub documents: Vec<SnapshotDocument>,
    pub blocks: Vec<SnapshotBlock>,
    pub known_work_names: BTreeSet<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SnapshotDocument {
    pub stem: String,
    pub kind: String,
    pub title: String,
    pub created: i64,
    pub modified: i64,
    pub created_date: String,
    pub modified_date: String,
    pub normalized_h1: Option<String>,
    pub title_works: BTreeSet<String>,
    pub clean_char_count: usize,
    pub matches_perspective: bool,
}

#[derive(Debug, Clone, Default)]
pub struct SnapshotMention {
    pub mention_count: usize,
    pub effective_chars: f64,
}

#[derive(Debug, Clone, Default)]
pub struct SnapshotBlock {
    pub id: i64,
    pub document_stem: String,
    pub content: String,
    pub raw_markdown: String,
    pub clean_text: String,
    pub clean_char_count: usize,
    pub is_untagged: bool,
    pub hour_of_day: Option<u8>,
    pub is_noise: bool,
    pub source_ordinal: i64,
    pub context_anchor: Option<ContextAnchor>,
    pub tags: BTreeSet<String>,
    /// One entry per valid syntactic occurrence, including unresolved targets.
    pub wiki_targets: Vec<String>,
    pub mentions: BTreeMap<String, SnapshotMention>,
}

const SCOPE: &str = "WITH selected AS (
    SELECT b.id FROM blocks b JOIN documents d ON d.stem=b.date
    WHERE (:start IS NULL OR d.created_date>=:start)
      AND (:end IS NULL OR d.created_date<=:end)
      AND (:perspective='all' OR (:perspective='articlesOnly' AND d.kind='article')
        OR (:perspective='untagged' AND b.is_untagged=1)
        OR (:perspective='tag' AND EXISTS (
          SELECT 1 FROM reflection_block_tags t WHERE t.block_id=b.id AND t.tag=:tag)))
) ";

const DOCUMENT_SCOPE: &str = ", selected_documents AS (
    SELECT d.stem FROM documents d WHERE
      EXISTS(SELECT 1 FROM blocks b JOIN selected s ON s.id=b.id WHERE b.date=d.stem)
      OR (d.kind='article' AND (
        (((:start IS NULL OR d.created_date>=:start) AND (:end IS NULL OR d.created_date<=:end))
          OR ((:start IS NULL OR d.modified_date>=:start) AND (:end IS NULL OR d.modified_date<=:end)))
        AND (:perspective='all' OR :perspective='articlesOnly'
          OR (:perspective='untagged' AND EXISTS(SELECT 1 FROM blocks b WHERE b.date=d.stem AND b.is_untagged=1))
          OR (:perspective='tag' AND EXISTS(SELECT 1 FROM blocks b JOIN reflection_block_tags t ON t.block_id=b.id WHERE b.date=d.stem AND t.tag=:tag)))
        OR EXISTS(SELECT 1 FROM reflection_wiki_links w JOIN selected s ON s.id=w.block_id WHERE w.target_filename=d.stem || '.md')
      ))
) ";

pub fn load_snapshot(conn: &mut Connection, query: &ReflectionQuery) -> Result<ReflectionSnapshot, String> {
    query.validate()?;
    let (perspective, tag) = match &query.perspective {
        ReflectionPerspective::All => ("all", ""),
        ReflectionPerspective::ArticlesOnly => ("articlesOnly", ""),
        ReflectionPerspective::Untagged => ("untagged", ""),
        ReflectionPerspective::Tag { tag } => ("tag", tag.trim()),
    };
    let params = named_params! {
        ":start": query.start_date.as_deref(), ":end": query.end_date.as_deref(),
        ":perspective": perspective, ":tag": tag,
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut snapshot = ReflectionSnapshot::default();
    let mut document_positions = BTreeMap::new();
    {
        let sql = format!("{SCOPE}{DOCUMENT_SCOPE} SELECT d.stem,d.kind,d.title,d.created,d.modified,
            d.created_date,d.modified_date,d.normalized_h1,
            COALESCE((SELECT SUM(b.clean_char_count) FROM blocks b WHERE b.date=d.stem),0),
            (:perspective='all' OR :perspective='articlesOnly'
             OR (:perspective='untagged' AND EXISTS(SELECT 1 FROM blocks b WHERE b.date=d.stem AND b.is_untagged=1))
             OR (:perspective='tag' AND EXISTS(SELECT 1 FROM blocks b JOIN reflection_block_tags t ON t.block_id=b.id WHERE b.date=d.stem AND t.tag=:tag)))
            FROM documents d JOIN selected_documents sd ON sd.stem=d.stem
            ORDER BY d.stem");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| Ok(SnapshotDocument {
            stem: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, created: r.get(3)?, modified: r.get(4)?,
            created_date: r.get(5)?, modified_date: r.get(6)?, normalized_h1: r.get(7)?,
            clean_char_count: r.get::<_, i64>(8)?.max(0) as usize,
            matches_perspective: r.get(9)?, title_works: BTreeSet::new(),
        })).map_err(|e| e.to_string())?;
        for row in rows {
            let doc = row.map_err(|e| e.to_string())?;
            document_positions.insert(doc.stem.clone(), snapshot.documents.len());
            snapshot.documents.push(doc);
        }
    }
    {
        let sql = format!("{SCOPE}{DOCUMENT_SCOPE} SELECT w.document_stem,w.work_name
            FROM article_title_works w JOIN selected_documents sd ON sd.stem=w.document_stem
            ORDER BY w.document_stem,w.work_name");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (stem, work) = row.map_err(|e| e.to_string())?;
            snapshot.known_work_names.insert(work.clone());
            if let Some(&i) = document_positions.get(&stem) { snapshot.documents[i].title_works.insert(work); }
        }
        let sql = format!("{SCOPE} SELECT DISTINCT d.normalized_h1
            FROM documents d JOIN blocks b ON b.date=d.stem JOIN selected s ON s.id=b.id
            WHERE d.kind='article' AND d.normalized_h1 IS NOT NULL AND (
                EXISTS(SELECT 1 FROM note_work_mentions m WHERE m.work_name=d.normalized_h1)
                OR EXISTS(SELECT 1 FROM article_title_works w WHERE w.work_name=d.normalized_h1))
            ORDER BY d.normalized_h1");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        for row in rows { snapshot.known_work_names.insert(row.map_err(|e| e.to_string())?); }
    }
    let mut positions = BTreeMap::new();
    {
        let sql = format!("{SCOPE} SELECT b.id,b.date,b.content,b.raw_markdown,b.clean_text,
            b.clean_char_count,b.is_untagged,b.hour_of_day,b.is_noise,b.source_ordinal,b.anchor_text,b.anchor_occurrence
            FROM blocks b JOIN selected s ON s.id=b.id ORDER BY b.date,b.source_ordinal,b.raw_markdown,b.id");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| {
            let text: Option<String> = r.get(10)?;
            let occurrence: Option<i64> = r.get(11)?;
            Ok(SnapshotBlock {
                id: r.get(0)?, document_stem: r.get(1)?, content: r.get(2)?, raw_markdown: r.get(3)?, clean_text: r.get(4)?,
                clean_char_count: r.get::<_, i64>(5)?.max(0) as usize, is_untagged: r.get(6)?,
                hour_of_day: r.get::<_, Option<i64>>(7)?.filter(|h| (0..24).contains(h)).map(|h| h as u8),
                is_noise: r.get(8)?, source_ordinal: r.get(9)?,
                context_anchor: text.zip(occurrence).filter(|(t, n)| !t.is_empty() && *n >= 0)
                    .map(|(text, n)| ContextAnchor { text, occurrence: n as usize }),
                ..Default::default()
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            let block = row.map_err(|e| e.to_string())?;
            positions.insert(block.id, snapshot.blocks.len());
            snapshot.blocks.push(block);
        }
    }
    {
        let sql = format!("{SCOPE} SELECT t.block_id,t.tag FROM reflection_block_tags t JOIN selected s ON s.id=t.block_id ORDER BY t.block_id,t.tag");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (id, tag) = row.map_err(|e| e.to_string())?;
            if let Some(&i) = positions.get(&id) { snapshot.blocks[i].tags.insert(tag); }
        }
    }
    {
        let sql = format!("{SCOPE} SELECT w.block_id,w.target_filename FROM reflection_wiki_links w JOIN selected s ON s.id=w.block_id ORDER BY w.block_id,w.occurrence_index");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (id, target) = row.map_err(|e| e.to_string())?;
            if let Some(&i) = positions.get(&id) { snapshot.blocks[i].wiki_targets.push(target); }
        }
    }
    {
        let sql = format!("{SCOPE} SELECT m.block_id,m.work_name,m.mention_count,m.effective_chars FROM note_work_mentions m JOIN selected s ON s.id=m.block_id ORDER BY m.block_id,m.work_name");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, SnapshotMention {
            mention_count: r.get::<_, i64>(2)?.max(0) as usize,
            effective_chars: r.get(3)?,
        }))).map_err(|e| e.to_string())?;
        for row in rows {
            let (id, work, mention) = row.map_err(|e| e.to_string())?;
            if let Some(&i) = positions.get(&id) { snapshot.blocks[i].mentions.insert(work, mention); }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

fn filename(doc: &SnapshotDocument) -> String { format!("{}.md", doc.stem) }
fn matches_block(block: &SnapshotBlock, doc: &SnapshotDocument, query: &ReflectionQuery) -> bool {
    query.contains(&doc.created_date) && match &query.perspective {
        ReflectionPerspective::All => true,
        ReflectionPerspective::Tag { tag } => block.tags.contains(tag.trim()),
        ReflectionPerspective::Untagged => block.is_untagged,
        ReflectionPerspective::ArticlesOnly => doc.kind == "article",
    }
}

fn raw(block: &SnapshotBlock) -> &str {
    if block.raw_markdown.is_empty() { &block.content } else { &block.raw_markdown }
}

fn terminal(c: char) -> bool { "。！？…”」.!?".contains(c) }

/// Shared with representative-source ranking; eligibility is applied separately.
fn base_score(block: &SnapshotBlock) -> f64 {
    let n = block.clean_char_count as f64;
    let length = if n < 35.0 { 0.0 } else if n < 60.0 { (n - 35.0) * 40.0 / 25.0 }
        else if n <= 160.0 { 40.0 } else { ((280.0 - n) * 40.0 / 120.0).max(0.0) };
    let text = block.clean_text.trim_end();
    length + if text.chars().next_back().is_some_and(terminal) { 15.0 } else { 0.0 }
        + if text.contains("——") || text.contains("……") || text.contains("...") || text.contains('？') { 10.0 } else { 0.0 }
        + if !block.wiki_targets.is_empty() { 20.0 } else { 0.0 }
        + if block.is_untagged && block.clean_char_count >= 70 { 10.0 } else { 0.0 }
}

/// A bounded original-source window, without fabricated ellipses or prose.
fn excerpt(block: &SnapshotBlock, work: Option<&str>) -> String {
    let source = raw(block).trim();
    let chars: Vec<char> = source.chars().collect();
    if chars.len() <= 280 { return source.to_owned(); }
    let location = work.and_then(|w| super::text_features::work_mention_start(source, w).or_else(|| source.find(w)))
        .map(|byte| source[..byte].chars().count());
    let mut start = location.unwrap_or(0).saturating_sub(90);
    if start > 0 {
        if let Some(offset) = chars[start..location.unwrap_or(start)].iter().rposition(|c| terminal(*c) || *c == '\n') {
            start += offset + 1;
        }
    }
    let mut end = (start + 280).min(chars.len());
    let minimum = location.map_or(start + 35, |p| p + work.unwrap_or("").chars().count());
    if minimum < end {
        if let Some(offset) = chars[minimum..end].iter().rposition(|c| terminal(*c)) { end = minimum + offset + 1; }
    }
    chars[start..end].iter().collect::<String>().trim().to_owned()
}

fn snippet(block: &SnapshotBlock, doc: &SnapshotDocument, work: Option<&str>) -> SourceSnippet {
    SourceSnippet { block_id: block.id, filename: filename(doc), date: doc.created_date.clone(),
        content: excerpt(block, work), context_anchor: block.context_anchor.clone() }
}

type Source<'a> = (&'a SnapshotBlock, &'a SnapshotDocument);

fn favorite_time(sources: &[Source<'_>]) -> Option<FavoriteTimeBucket> {
    // Fixed, exhaustive boundaries; midnight is included only when indexed as known.
    const NAMES: [&str; 5] = ["清晨", "白昼", "傍晚", "深夜", "凌晨"];
    let mut counts = [0usize; 5];
    let mut hours = [0usize; 24];
    let bucket = |h: u8| match h { 5..=8 => 0, 9..=17 => 1, 18..=21 => 2, 22..=23 | 0..=1 => 3, _ => 4 };
    for (b, _) in sources {
        if let Some(h) = b.hour_of_day.filter(|h| *h < 24) { counts[bucket(h)] += 1; hours[h as usize] += 1; }
    }
    let winner = (0..5).min_by_key(|&i| (std::cmp::Reverse(counts[i]), i))?;
    if counts[winner] < 3 { return None; }
    let peak = (0..24u8).filter(|&h| bucket(h) == winner)
        .min_by_key(|&h| (std::cmp::Reverse(hours[h as usize]), h))?;
    Some(FavoriteTimeBucket { name: NAMES[winner].into(), peak_hour: peak,
        sample_count: counts[winner], share: counts[winner] as f64 / counts.iter().sum::<usize>() as f64 })
}

#[derive(Default)]
struct Day<'a> {
    tags: BTreeSet<String>, untagged: usize, substantial_daily: bool, chars: usize,
    articles: BTreeMap<String, String>, preview_source: Option<Source<'a>>,
}
fn richest_day(sources: &[Source<'_>], documents: &[SnapshotDocument], query: &ReflectionQuery) -> Option<RichestDay> {
    let mut days: BTreeMap<String, Day<'_>> = BTreeMap::new();
    for &(b, d) in sources {
        let day = days.entry(d.created_date.clone()).or_default();
        day.tags.extend(b.tags.iter().cloned());
        day.untagged += usize::from(b.is_untagged);
        day.substantial_daily |= d.kind == "journal" && b.is_untagged && b.clean_char_count >= 40;
        day.chars = day.chars.saturating_add(b.clean_char_count);
        if day.preview_source.is_none_or(|(old, _)| representative_better(b, old)) { day.preview_source = Some((b, d)); }
    }
    for d in documents.iter().filter(|d| d.kind == "article" && d.matches_perspective) {
        for date in BTreeSet::from([&d.created_date, &d.modified_date]) {
            if query.contains(date) {
                days.entry(date.clone()).or_default().articles.insert(filename(d), d.title.clone());
            }
        }
    }
    let score = |d: &Day<'_>| 25.0 * d.tags.len() as f64 + if d.substantial_daily { 20.0 } else { 0.0 }
        + if !d.articles.is_empty() { 25.0 } else { 0.0 } + 0.03 * d.chars.min(1000) as f64;
    let (date, day) = days.into_iter().min_by(|(ad, a), (bd, b)| score(b).total_cmp(&score(a)).then(ad.cmp(bd)))?;
    let preview = day.preview_source.map(|(b, _)| excerpt(b, None))
        .unwrap_or_else(|| day.articles.values().next().cloned().unwrap_or_default());
    let preview_source = day.preview_source.map(|(block, document)| snippet(block, document, None));
    Some(RichestDay { date, tags: day.tags.into_iter().collect(), untagged_blocks_count: day.untagged,
        articles: day.articles.into_iter().map(|(filename, title)| ArticleIdentity { filename, title }).collect(), preview, preview_source })
}

fn representative_better(candidate: &SnapshotBlock, current: &SnapshotBlock) -> bool {
    // Natural prose wins over a noisy list, but a sole noisy/long source remains usable.
    (!candidate.is_noise, candidate.context_anchor.is_some()) > (!current.is_noise, current.context_anchor.is_some())
        || ((!candidate.is_noise, candidate.context_anchor.is_some()) == (!current.is_noise, current.context_anchor.is_some())
            && base_score(candidate).total_cmp(&base_score(current)).is_gt())
}

fn smooth(x: f64) -> f64 { if x <= 500.0 { x } else { 500.0 + (x - 500.0).ln() * 20.0 } }
fn depth_score(w: f64, days: usize, bonus: bool) -> f64 {
    w * (1.0 + 0.6 * (days.max(1) as f64).ln()) + if bonus { 300.0 } else { 0.0 }
}
#[derive(Default)]
struct Work<'a> {
    mentions: usize, weight: f64, days: BTreeSet<String>, filenames: BTreeSet<String>,
    dedicated: bool, linked: bool, representative: Option<Source<'a>>,
}

fn deep_works(sources: &[Source<'_>], known: &BTreeSet<String>, article_names: &BTreeSet<String>) -> (usize, Vec<DeepWork>) {
    let mut works: BTreeMap<String, Work<'_>> = BTreeMap::new();
    // A title is a document entity; add its synthetic mention only to the first
    // selected block, and never count a title already present in indexed mentions twice.
    let mut first_blocks = BTreeMap::new();
    let mut document_entities: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    for &(b, d) in sources {
        first_blocks.entry(d.stem.as_str()).or_insert(b.id);
        document_entities.entry(&d.stem).or_default().extend(b.mentions.keys().cloned());
    }
    for &(b, d) in sources {
        let mut titles = d.title_works.clone();
        if d.kind == "article" {
            if let Some(h1) = &d.normalized_h1 { if known.contains(h1) { titles.insert(h1.clone()); } }
        } else { titles.clear(); }
        let mut mentions: BTreeMap<String, usize> = b.mentions.iter().map(|(name, m)| (name.clone(), m.mention_count)).collect();
        if first_blocks.get(d.stem.as_str()) == Some(&b.id) {
            for title in &titles {
                if !document_entities[d.stem.as_str()].contains(title) { mentions.entry(title.clone()).or_insert(1); }
            }
        }
        if mentions.is_empty() { continue; }
        let expanded = mentions.len() != b.mentions.len();
        let shared = b.clean_char_count as f64 / mentions.len() as f64;
            let linked = b.wiki_targets.iter().any(|target| article_names.contains(target));
        for (name, count) in mentions {
            let w = works.entry(name.clone()).or_default();
            // Index values already encode per-block division; an introduced bare H1
            // changes N, so recompute every entity's allocation for that block.
            let x = if expanded { shared } else { b.mentions.get(&name).map_or(shared, |m| m.effective_chars) };
            let x = if x.is_finite() { x.max(0.0) } else { 0.0 };
            w.weight += smooth(x);
            w.mentions = w.mentions.saturating_add(count);
            w.days.insert(d.created_date.clone()); w.filenames.insert(filename(d));
            w.dedicated |= titles.contains(&name); w.linked |= linked;
            if w.representative.is_none_or(|(old, _)| representative_better(b, old)) { w.representative = Some((b, d)); }
        }
    }
    let total = works.len();
    let mut ranked: Vec<_> = works.into_iter().filter(|(_, w)| w.weight >= 35.0 || w.dedicated).collect();
    ranked.sort_by(|(an, a), (bn, b)| depth_score(b.weight, b.days.len(), b.dedicated || b.linked)
        .total_cmp(&depth_score(a.weight, a.days.len(), a.dedicated || a.linked)).then(an.cmp(bn)));
    let result = ranked.into_iter().take(5).filter_map(|(name, w)| {
        let (b, d) = w.representative?;
        Some(DeepWork { representative_quote: snippet(b, d, Some(&name)), work_name: name,
            mention_count: w.mentions, distinct_days_count: w.days.len(), effective_chars: w.weight,
            filenames: w.filenames.into_iter().collect() })
    }).collect();
    (total, result)
}

fn article_results(sources: &[Source<'_>], documents: &[SnapshotDocument], query: &ReflectionQuery) -> ReflectionArticles {
    let mut brewed = Vec::new();
    let articles: BTreeMap<String, &SnapshotDocument> = documents.iter().filter(|d| d.kind == "article").map(|d| (filename(d), d)).collect();
    for (name, d) in &articles {
        if !d.matches_perspective || !(query.contains(&d.created_date) || query.contains(&d.modified_date)) || d.clean_char_count < 100 { continue; }
        let span = ((i128::from(d.modified) - i128::from(d.created)).max(0) / 86400) as u64;
        if span >= 1 { brewed.push(BrewedArticle { title: d.title.clone(), filename: name.clone(), created_date: d.created_date.clone(), modified_date: d.modified_date.clone(), span_days: span }); }
    }
    brewed.sort_by(|a, b| b.span_days.cmp(&a.span_days).then(a.filename.cmp(&b.filename))); brewed.truncate(2);
    let mut references: BTreeMap<String, BTreeMap<String, (usize, Source<'_>)>> = BTreeMap::new();
    for &(b, d) in sources {
        let source = filename(d);
        for target in &b.wiki_targets {
            if target == &source || !articles.contains_key(target) { continue; }
            let entry = references.entry(target.clone()).or_default().entry(source.clone()).or_insert((0, (b, d)));
            entry.0 += 1;
        }
    }
    let mut referenced = Vec::new();
    for (target, by_source) in references {
        let reference_count = by_source.values().map(|(n, _)| n).sum();
        let source_count = by_source.len();
        let mut summaries: Vec<_> = by_source.into_iter().map(|(filename, (reference_count, (b, d)))| ReferenceSource {
            filename, title: d.title.clone(), reference_count, preview: excerpt(b, None), context_anchor: b.context_anchor.clone(),
        }).collect();
        summaries.sort_by(|a, b| b.reference_count.cmp(&a.reference_count).then(a.filename.cmp(&b.filename))); summaries.truncate(3);
        referenced.push(ReferencedArticle { title: articles[&target].title.clone(), filename: target, reference_count, source_count, sources: summaries });
    }
    referenced.sort_by(|a, b| b.reference_count.cmp(&a.reference_count).then(a.filename.cmp(&b.filename))); referenced.truncate(2);
    ReflectionArticles { longest_brewed: brewed, most_referenced: referenced }
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3))
}
fn stable_hash(b: &SnapshotBlock, d: &SnapshotDocument, query: &ReflectionQuery) -> u64 {
    // Length-prefixed UTF-8 fields and fixed little-endian integers avoid ambiguous
    // concatenation and platform-dependent hashing. Seed is applied as band rotation.
    let mut bytes = Vec::new();
    for text in [filename(d).as_str(), query.start_date.as_deref().unwrap_or(""), query.end_date.as_deref().unwrap_or(""), d.created_date.as_str()] {
        bytes.extend_from_slice(&(text.len() as u64).to_le_bytes()); bytes.extend_from_slice(text.as_bytes());
    }
    bytes.extend_from_slice(&b.source_ordinal.to_le_bytes());
    bytes.extend_from_slice(&fnv1a(raw(b).as_bytes()).to_le_bytes());
    fnv1a(&bytes)
}
fn day_number(date: &str) -> i64 {
    canonical_date(date).map(|date| date.signed_duration_since(NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()).num_days()).unwrap_or(0)
}

fn sampled_quotes(sources: &[Source<'_>], query: &ReflectionQuery) -> Vec<SampledQuote> {
    struct Candidate<'a> {
        block: &'a SnapshotBlock,
        document: &'a SnapshotDocument,
        score: f64,
        hash: u64,
        day: i64,
    }
    let mut candidates: Vec<_> = sources.iter().copied()
        .filter(|(b, d)| d.kind == "journal" && !b.is_noise && (35..=280).contains(&b.clean_char_count))
        .map(|(block, document)| Candidate { score: base_score(block), hash: stable_hash(block, document, query),
            day: day_number(&document.created_date), block, document }).collect();
    if candidates.is_empty() { return Vec::new(); }
    let earliest = candidates.iter().map(|c| c.day).min().unwrap();
    let latest = candidates.iter().map(|c| c.day).max().unwrap();
    let start = query.start_date.as_deref().map(day_number).unwrap_or(earliest);
    let end = query.end_date.as_deref().map(day_number).unwrap_or(latest);
    let first_third_end = start + (end - start).max(0) / 3;
    let pool_size = candidates.len().min(30).min(4.max((candidates.len() * 2).div_ceil(5)));
    let stable_order = |a: &Candidate<'_>, b: &Candidate<'_>| a.hash.cmp(&b.hash)
        .then(a.document.stem.cmp(&b.document.stem))
        .then(a.block.source_ordinal.cmp(&b.block.source_ordinal)).then(raw(a.block).cmp(raw(b.block)));
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| stable_order(a, b)));
    let mut i = 0;
    while i < candidates.len() {
        let band = (candidates[i].score / 5.0).floor() as i64;
        let mut j = i + 1;
        while j < candidates.len() && (candidates[j].score / 5.0).floor() as i64 == band { j += 1; }
        candidates[i..j].sort_by(stable_order);
        candidates[i..j].rotate_left(query.page_seed as usize % (j - i));
        i = j;
    }
    candidates.truncate(pool_size);
    let pool_start = candidates.iter().map(|c| c.day).min().unwrap_or(earliest);
    let pool_end = candidates.iter().map(|c| c.day).max().unwrap_or(latest);
    let spacing = pool_end - pool_start > 14;
    let mut chosen: Vec<(usize, QuoteSlot)> = Vec::new();
    for slot in [QuoteSlot::NightMonologue, QuoteSlot::UntaggedMoment, QuoteSlot::ConnectedThought, QuoteSlot::DistantEcho,
                 QuoteSlot::GeneralHighlight, QuoteSlot::GeneralHighlight, QuoteSlot::GeneralHighlight, QuoteSlot::GeneralHighlight] {
        if chosen.len() == 4 { break; }
        let eligible = |c: &Candidate<'_>| match slot {
            QuoteSlot::NightMonologue => c.block.hour_of_day.is_some_and(|h| h >= 22 || h <= 4),
            QuoteSlot::UntaggedMoment => c.block.is_untagged,
            QuoteSlot::ConnectedThought => !c.block.tags.is_empty() || !c.block.wiki_targets.is_empty(),
            QuoteSlot::DistantEcho => c.day <= first_third_end,
            QuoteSlot::GeneralHighlight => true,
        };
        let select = |require_spacing: bool| candidates.iter().enumerate().find_map(|(i, c)| {
            if chosen.iter().any(|(selected, _)| *selected == i) || !eligible(c) { return None; }
            if require_spacing && chosen.iter().any(|(selected, _)| (c.day - candidates[*selected].day).abs() < 3) { return None; }
            Some(i)
        });
        if let Some(index) = select(spacing).or_else(|| select(false)) { chosen.push((index, slot)); }
    }
    chosen.into_iter().map(|(i, slot)| {
        let c = &candidates[i];
        SampledQuote { block_id: c.block.id, filename: filename(c.document), date: c.document.created_date.clone(),
            content: raw(c.block).trim().to_owned(), context_anchor: c.block.context_anchor.clone(),
            slot, tags: c.block.tags.iter().cloned().collect() }
    }).collect()
}

/// Pure computation: neither a database handle, a storage lock nor a clock is used.
pub fn compute(mut snapshot: ReflectionSnapshot, mut query: ReflectionQuery) -> PeriodReflectionResult {
    if let ReflectionPerspective::Tag { tag } = &mut query.perspective { *tag = tag.trim().to_owned(); }
    snapshot.documents.sort_by(|a, b| a.stem.cmp(&b.stem));
    snapshot.blocks.sort_by(|a, b| a.document_stem.cmp(&b.document_stem).then(a.source_ordinal.cmp(&b.source_ordinal))
        .then(raw(a).cmp(raw(b))).then(a.id.cmp(&b.id)));
    let docs: BTreeMap<_, _> = snapshot.documents.iter().map(|d| (d.stem.as_str(), d)).collect();
    let sources: Vec<Source<'_>> = snapshot.blocks.iter().filter_map(|b| docs.get(b.document_stem.as_str()).map(|&d| (b, d)))
        .filter(|(b, d)| matches_block(b, d, &query)).collect();
    let mut tags = BTreeMap::<String, usize>::new();
    for (b, _) in &sources { for tag in &b.tags { *tags.entry(tag.clone()).or_default() += 1; } }
    let mut top_tags: Vec<_> = tags.into_iter().map(|(tag, count)| TagFrequency { tag, count }).collect();
    top_tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag))); top_tags.truncate(10);
    let article_names = snapshot.documents.iter().filter(|d| d.kind == "article").map(filename).collect();
    let mut known = snapshot.known_work_names.clone();
    for b in &snapshot.blocks { known.extend(b.mentions.keys().cloned()); }
    for d in &snapshot.documents { known.extend(d.title_works.iter().cloned()); }
    let (total_distinct_works_count, deep_works) = deep_works(&sources, &known, &article_names);
    let overview = ReflectionOverview {
        active_days_count: sources.iter().map(|(_, d)| &d.created_date).collect::<BTreeSet<_>>().len(),
        daily_blocks_count: sources.iter().filter(|(_, d)| d.kind == "journal").count(),
        titled_articles_count: sources.iter().filter(|(_, d)| d.kind == "article").map(|(_, d)| &d.stem).collect::<BTreeSet<_>>().len(),
        favorite_time_bucket: favorite_time(&sources), richest_day: richest_day(&sources, &snapshot.documents, &query),
    };
    let themes = ReflectionThemes { top_tags, untagged_blocks_count: sources.iter().filter(|(b, _)| b.is_untagged).count(), total_distinct_works_count, deep_works };
    let articles = article_results(&sources, &snapshot.documents, &query);
    let sampled_quotes = sampled_quotes(&sources, &query);
    PeriodReflectionResult { query, overview, themes, articles, sampled_quotes }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(stem: &str, date: &str, kind: &str) -> SnapshotDocument {
        SnapshotDocument { stem: stem.into(), kind: kind.into(), title: stem.into(), created_date: date.into(), modified_date: date.into(),
            matches_perspective: true, ..Default::default() }
    }
    fn block(id: i64, stem: &str, chars: usize, names: &[&str]) -> SnapshotBlock {
        let text = format!("{}{}。", names.iter().map(|n| format!("《{n}》")).collect::<String>(), "文".repeat(chars));
        SnapshotBlock { id, document_stem: stem.into(), clean_char_count: chars, content: text.clone(), raw_markdown: text.clone(), clean_text: text,
            is_untagged: true, source_ordinal: id, context_anchor: Some(ContextAnchor { text: "文".into(), occurrence: 0 }),
            mentions: names.iter().map(|name| ((*name).into(), SnapshotMention { mention_count: 1, effective_chars: chars as f64 / names.len() as f64 })).collect(),
            ..Default::default() }
    }
    fn fixture() -> ReflectionSnapshot {
        ReflectionSnapshot { documents: vec![document("a", "2026-01-01", "journal"), document("b", "2026-01-02", "journal"), document("c", "2026-01-03", "journal")],
            blocks: vec![block(1, "a", 50, &["一", "二", "三", "四", "五"]), block(2, "a", 100, &["深"]), block(3, "b", 150, &["深"]), block(4, "c", 150, &["深"])], ..Default::default() }
    }
    #[test]
    fn booklist_is_diluted_and_depth_is_per_block() {
        let result = compute(fixture(), ReflectionQuery::default());
        assert_eq!(result.themes.total_distinct_works_count, 6);
        assert_eq!(result.themes.deep_works.len(), 1);
        let work = &result.themes.deep_works[0];
        assert_eq!((work.mention_count, work.distinct_days_count, work.effective_chars), (3, 3, 400.0));
        assert!((depth_score(work.effective_chars, work.distinct_days_count, false) - 663.6669492803463).abs() < 1e-9);
        assert!(work.representative_quote.content.contains('深'));
        assert_eq!(smooth(500.0), 500.0);
        assert_eq!(smooth(501.0), 500.0);
        assert!(smooth(500.5) < 500.0);
        assert!((smooth(600.0) - (500.0 + 100f64.ln() * 20.0)).abs() < 1e-10);
        let mut s = fixture(); s.blocks = vec![block(1, "a", 400, &["深"]), block(2, "b", 400, &["深"])];
        assert_eq!(compute(s, ReflectionQuery::default()).themes.deep_works[0].effective_chars, 800.0);
    }
    #[test]
    fn gate_title_union_and_single_bonus() {
        let mut d = document("article", "2026-01-01", "article"); d.normalized_h1 = Some("新".into());
        let mut s = ReflectionSnapshot { documents: vec![d, document("target", "2020-01-01", "article")],
            blocks: vec![block(1, "article", 100, &["旧"])], known_work_names: BTreeSet::from(["新".into()]) };
        s.blocks[0].wiki_targets = vec!["target.md".into(), "target.md".into()];
        let r = compute(s.clone(), ReflectionQuery::default());
        assert_eq!(r.themes.deep_works.len(), 2);
        assert!(r.themes.deep_works.iter().all(|w| w.effective_chars == 50.0 && w.mention_count == 1));
        assert_eq!(depth_score(50.0, 1, true), 350.0);
        s.blocks[0] = block(1, "article", 34, &["旧"]); s.blocks[0].wiki_targets.push("target.md".into());
        let r = compute(s.clone(), ReflectionQuery::default());
        assert_eq!(r.themes.total_distinct_works_count, 2); assert_eq!(r.themes.deep_works.len(), 1);
        assert_eq!(r.themes.deep_works[0].work_name, "新");
        s.documents[0].normalized_h1 = None;
        s.documents[0].title_works.insert("旧".into());
        let r = compute(s, ReflectionQuery::default());
        assert_eq!(r.themes.deep_works[0].mention_count, 1);
        assert_eq!(r.themes.deep_works[0].effective_chars, 34.0);
        let mut s = fixture(); s.blocks = vec![block(1, "a", 35, &["门槛"])];
        assert_eq!(compute(s, ReflectionQuery::default()).themes.deep_works.len(), 1);
    }
    #[test]
    fn long_noisy_and_title_only_sources_still_have_representatives() {
        let mut s = fixture(); s.blocks = vec![block(1, "a", 2000, &["深"])]; s.blocks[0].is_noise = true;
        let r = compute(s, ReflectionQuery::default());
        assert!(r.sampled_quotes.is_empty());
        let quote = &r.themes.deep_works[0].representative_quote;
        assert!(quote.content.chars().count() <= 280 && quote.content.contains("《深》"));
        let mut d = document("only-title", "2026-01-01", "article"); d.title_works.insert("短".into());
        let mut b = block(1, "only-title", 3, &["短"]); b.context_anchor = None; b.raw_markdown = "# 《短》".into();
        let r = compute(ReflectionSnapshot { documents: vec![d], blocks: vec![b], ..Default::default() }, ReflectionQuery::default());
        assert_eq!(r.themes.deep_works[0].representative_quote.content, "# 《短》");
        assert!(r.themes.deep_works[0].representative_quote.context_anchor.is_none());
        for mention in ["《百年  孤独》", "《百年**孤独**》"] {
            let name = if mention.contains("**") { "百年孤独" } else { "百年 孤独" };
            let mut b = block(1, "a", 700, &[name]);
            b.raw_markdown = format!("{}。{mention}{}。", "前".repeat(420), "后".repeat(300));
            let s = ReflectionSnapshot { documents: vec![document("a", "2026-01-01", "journal")], blocks: vec![b], ..Default::default() };
            let result = compute(s, ReflectionQuery::default());
            let content = &result.themes.deep_works[0].representative_quote.content;
            assert!(content.contains(mention));
            assert!(content.chars().count() <= 280);
        }
    }
    #[test]
    fn richest_day_retains_exact_source_filename_and_anchor() {
        let doc = document("2026-01-01_旧记录", "2026-01-01", "journal");
        let mut source = block(9, &doc.stem, 90, &[]);
        source.context_anchor = Some(ContextAnchor { text: "重复文字".into(), occurrence: 2 });
        let result = compute(ReflectionSnapshot { documents: vec![doc], blocks: vec![source], ..Default::default() }, ReflectionQuery::default());
        let day = result.overview.richest_day.unwrap();
        let preview = day.preview_source.unwrap();
        assert_eq!(preview.filename, "2026-01-01_旧记录.md");
        assert_eq!(preview.context_anchor.unwrap().occurrence, 2);
        let mut article = document("old", "2020-01-01", "article");
        article.modified_date = "2026-01-01".into();
        let result = compute(ReflectionSnapshot { documents: vec![article], ..Default::default() },
            ReflectionQuery { start_date: Some("2026-01-01".into()), ..Default::default() });
        let json = serde_json::to_value(result).unwrap();
        assert!(json["overview"]["richestDay"]["previewSource"].is_null());
        assert_eq!(json["overview"]["richestDay"]["articles"][0]["filename"], "old.md");
    }

    #[test]
    fn modified_article_event_does_not_recount_old_text() {
        let mut d = document("imported", "2020-01-01", "article"); d.modified_date = "2026-01-02".into(); d.clean_char_count = 900;
        let mut s = fixture(); s.documents.push(d); s.blocks.push(block(99, "imported", 900, &["旧"]));
        let q = ReflectionQuery { start_date: Some("2026-01-01".into()), end_date: Some("2026-01-03".into()), ..Default::default() };
        let r = compute(s, q);
        assert_eq!(r.overview.active_days_count, 3); assert_eq!(r.overview.daily_blocks_count, 4);
        assert_eq!(r.overview.titled_articles_count, 0);
        let day = r.overview.richest_day.unwrap(); assert_eq!(day.date, "2026-01-02");
        assert_eq!(day.articles[0].filename, "imported.md");
        assert!(!r.themes.deep_works.iter().any(|w| w.work_name == "旧"));
    }
    #[test]
    fn hours_boundaries_unknown_and_stable_ties() {
        let mut s = fixture();
        for (i, b) in s.blocks.iter_mut().enumerate() { b.hour_of_day = Some([22, 0, 1, 5][i]); }
        let r = compute(s.clone(), ReflectionQuery::default()); let favorite = r.overview.favorite_time_bucket.unwrap();
        assert_eq!((favorite.name.as_str(), favorite.peak_hour, favorite.sample_count, favorite.share), ("深夜", 0, 3, 0.75));
        s.blocks[0].hour_of_day = None;
        assert!(compute(s, ReflectionQuery::default()).overview.favorite_time_bucket.is_none());
        for (name, hours) in [("清晨", [5, 8, 8]), ("白昼", [9, 12, 17]), ("傍晚", [18, 21, 21]),
            ("深夜", [22, 23, 1]), ("凌晨", [2, 3, 4])] {
            let mut s = fixture();
            s.blocks.truncate(3);
            for (block, hour) in s.blocks.iter_mut().zip(hours) { block.hour_of_day = Some(hour); }
            let result = compute(s, ReflectionQuery::default());
            let bucket = result.overview.favorite_time_bucket.unwrap();
            assert_eq!(bucket.name, name);
            assert_eq!(bucket.sample_count, 3);
            assert_eq!(bucket.share, 1.0);
        }
    }
    #[test]
    fn brewed_uses_elapsed_seconds_and_reference_occurrences() {
        let mut target = document("custom import", "2020-01-01", "article"); target.modified_date = "2026-01-02".into(); target.clean_char_count = 100;
        target.created = 100; target.modified = 100 + 86400;
        let mut s = fixture(); s.documents.push(target);
        s.blocks[0].wiki_targets = vec!["custom import.md".into(), "custom import.md".into(), "missing.md".into()];
        s.blocks[1].wiki_targets = vec!["custom import.md".into()]; s.blocks[2].wiki_targets = vec!["custom import.md".into()];
        let q = ReflectionQuery { start_date: Some("2026-01-01".into()), ..Default::default() };
        let r = compute(s.clone(), q.clone());
        assert_eq!(r.articles.longest_brewed[0].span_days, 1);
        let refs = &r.articles.most_referenced[0]; assert_eq!((refs.reference_count, refs.source_count), (4, 2));
        assert_eq!(refs.sources[0].reference_count, 3);
        s.documents[3].modified = 100 + 86399;
        assert!(compute(s.clone(), q.clone()).articles.longest_brewed.is_empty());
        s.documents[3].modified = i64::MIN; s.documents[3].created = i64::MAX;
        assert!(compute(s.clone(), q.clone()).articles.longest_brewed.is_empty());
        s.documents[3].created = i64::MIN; s.documents[3].modified = i64::MAX;
        assert!(!compute(s, q).articles.longest_brewed.is_empty());
    }
    #[test]
    fn serde_validation_case_and_empty_windows() {
        let q: ReflectionQuery = serde_json::from_str("{}").unwrap(); assert_eq!(q, ReflectionQuery::default());
        assert_eq!(serde_json::to_value(&q).unwrap()["perspective"]["kind"], "all");
        for date in ["2026-2-01", "2026-02-29", "2026-13-01", "2026-01-01 ", "２０２６-01-01"] {
            assert!(ReflectionQuery { start_date: Some(date.into()), ..q.clone() }.validate().is_err());
        }
        assert!(ReflectionQuery { start_date: Some("2024-02-29".into()), ..q.clone() }.validate().is_ok());
        assert!(ReflectionQuery { start_date: Some("2026-02-01".into()), end_date: Some("2026-01-01".into()), ..q.clone() }.validate().is_err());
        assert!(ReflectionQuery { perspective: ReflectionPerspective::Tag { tag: " \t".into() }, ..q.clone() }.validate().is_err());
        assert!(serde_json::from_str::<ReflectionQuery>("{\"pageSeed\":-1}").is_err());
        assert!(serde_json::from_str::<ReflectionQuery>("{\"pageSeed\":4294967296}").is_err());
        let r = compute(ReflectionSnapshot::default(), q.clone());
        assert_eq!(r.overview.active_days_count, 0); assert!(r.overview.richest_day.is_none());
        assert!(r.themes.deep_works.is_empty() && r.sampled_quotes.is_empty());
        let r = compute(fixture(), ReflectionQuery { end_date: Some("1900-01-01".into()), ..q });
        assert_eq!(r.overview.daily_blocks_count, 0);
    }
    #[test]
    fn perspectives_use_real_complete_tags_and_article_kind() {
        let mut s = fixture(); s.blocks[0].tags = BTreeSet::from(["默认".into(), "AbC".into()]); s.blocks[0].is_untagged = false;
        let q = |p| ReflectionQuery { perspective: p, ..Default::default() };
        let r = compute(s.clone(), q(ReflectionPerspective::Tag { tag: " AbC ".into() }));
        assert_eq!(r.overview.daily_blocks_count, 1); assert_eq!(r.themes.top_tags.len(), 2);
        assert_eq!(compute(s.clone(), q(ReflectionPerspective::Tag { tag: "abc".into() })).overview.daily_blocks_count, 0);
        assert_eq!(compute(s.clone(), q(ReflectionPerspective::Untagged)).overview.daily_blocks_count, 3);
        let r = compute(s, q(ReflectionPerspective::ArticlesOnly)); assert!(r.sampled_quotes.is_empty()); assert_eq!(r.overview.active_days_count, 0);
    }
    #[test]
    fn slots_spacing_noise_seed_and_general_fallback() {
        let mut s = ReflectionSnapshot::default();
        for i in 0..12 {
            let stem = format!("day{i:02}"); let date = format!("2026-01-{:02}", 1 + i * 2);
            s.documents.push(document(&stem, &date, "journal"));
            let mut b = block(i, &stem, 100, &[]); b.hour_of_day = Some(23);
            if i % 3 == 0 { b.tags.insert("tag".into()); b.is_untagged = false; b.wiki_targets.push("unresolved.md".into()); }
            s.blocks.push(b);
        }
        s.blocks[11].is_noise = true;
        let q = ReflectionQuery::default();
        let a = compute(s.clone(), q.clone()); let b = compute(s.clone(), ReflectionQuery { page_seed: 1, ..q.clone() });
        assert_eq!(a.sampled_quotes.len(), 4);
        assert_eq!(a.sampled_quotes.iter().map(|q| q.block_id).collect::<BTreeSet<_>>().len(), 4);
        assert!(!a.sampled_quotes.iter().any(|q| q.block_id == 11));
        assert_eq!(a.overview, b.overview); assert_eq!(a.themes, b.themes); assert_eq!(a.articles, b.articles);
        assert_ne!(a.sampled_quotes, b.sampled_quotes);
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&compute(s.clone(), q.clone())).unwrap());
        s.blocks.reverse(); s.documents.reverse();
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&compute(s, q)).unwrap());
        let mut s = fixture();
        for b in &mut s.blocks { b.is_untagged = false; b.hour_of_day = Some(12); b.mentions.clear(); }
        let r = compute(s, ReflectionQuery::default()); assert_eq!(r.sampled_quotes.len(), 4);
        assert!(!r.sampled_quotes.iter().any(|q| q.slot == QuoteSlot::NightMonologue));
        assert!(r.sampled_quotes.iter().any(|q| q.slot == QuoteSlot::GeneralHighlight));
    }
    #[test]
    fn calendar_spacing_prefers_distant_then_relaxes_and_rebuild_ids_do_not_rank() {
        let mut s = ReflectionSnapshot::default();
        for (i, day) in [1, 2, 10, 20].into_iter().enumerate() {
            let stem = format!("s{i}");
            s.documents.push(document(&stem, &format!("2026-01-{day:02}"), "journal"));
            let mut b = block(i as i64, &stem, 100, &[]);
            b.hour_of_day = Some(if i == 0 { 23 } else { 12 });
            if i == 0 || i == 3 { b.tags.insert("标签".into()); b.is_untagged = false; }
            s.blocks.push(b);
        }
        let result = compute(s.clone(), ReflectionQuery::default());
        assert_eq!(result.sampled_quotes.len(), 4);
        assert_eq!(result.sampled_quotes[0].filename, "s0.md");
        assert_eq!(result.sampled_quotes[1].filename, "s2.md");
        assert_eq!(result.sampled_quotes[2].filename, "s3.md");
        assert_eq!(result.sampled_quotes[3].filename, "s1.md");
        for b in &mut s.blocks { b.id += 5000; }
        let rebuilt = compute(s.clone(), ReflectionQuery::default());
        assert_eq!(result.sampled_quotes.iter().map(|q| (&q.filename, &q.content, &q.slot)).collect::<Vec<_>>(),
            rebuilt.sampled_quotes.iter().map(|q| (&q.filename, &q.content, &q.slot)).collect::<Vec<_>>());
        for b in &mut s.blocks { b.is_noise = true; }
        assert!(compute(s, ReflectionQuery::default()).sampled_quotes.is_empty());
    }

    #[test]
    fn references_exclude_self_and_bonus_never_bypasses_gate() {
        let a = document("a", "2026-01-01", "article");
        let b = document("b", "2020-01-01", "article");
        let mut source = block(1, "a", 34, &["浅"]);
        source.wiki_targets = vec!["a.md".into(), "b.md".into(), "b.md".into(), "missing.md".into()];
        let snapshot = ReflectionSnapshot { documents: vec![a, b], blocks: vec![source], ..Default::default() };
        let result = compute(snapshot, ReflectionQuery { start_date: Some("2026-01-01".into()), ..Default::default() });
        assert_eq!(result.themes.total_distinct_works_count, 1);
        assert!(result.themes.deep_works.is_empty());
        assert_eq!(result.articles.most_referenced.len(), 1);
        assert_eq!(result.articles.most_referenced[0].filename, "b.md");
        assert_eq!(result.articles.most_referenced[0].reference_count, 2);
    }

    #[test]
    fn exact_base_score_boundaries_and_syntactic_wiki() {
        let mut b = block(1, "a", 35, &[]); b.is_untagged = false; b.clean_text = "x".into();
        assert_eq!(base_score(&b), 0.0);
        b.clean_char_count = 60; assert_eq!(base_score(&b), 40.0);
        b.clean_char_count = 160; assert_eq!(base_score(&b), 40.0);
        b.clean_char_count = 280; assert_eq!(base_score(&b), 0.0);
        b.clean_text = "为何？".into(); b.wiki_targets = vec!["missing.md".into()]; b.is_untagged = true;
        assert_eq!(base_score(&b), 55.0);
        b.clean_char_count = 100;
        b.is_untagged = false;
        b.wiki_targets.clear();
        for text in ["完整。", "完整！", "完整？", "完整…", "完整”", "完整」", "done.", "done!", "done?"] {
            b.clean_text = text.into();
            assert_eq!(base_score(&b), 55.0 + if text.contains('？') { 10.0 } else { 0.0 }, "{text}");
        }
        for text in ["单破折号—中", "单省略号…中", "没有收尾;", "没有收尾；"] {
            b.clean_text = text.into();
            assert_eq!(base_score(&b), 40.0, "{text}");
        }
        for text in ["双破折号——中", "双省略号……中", "three...middle"] {
            b.clean_text = text.into();
            assert_eq!(base_score(&b), 50.0, "{text}");
        }
    }
    #[test]
    #[ignore = "manual 10,000-block pure aggregation benchmark; database warm-query coverage belongs to integration tests"]
    fn ten_thousand_block_compute() {
        let mut s = ReflectionSnapshot::default();
        for i in 0..10_000 {
            let stem = format!("doc{i:05}"); s.documents.push(document(&stem, "2026-01-01", "journal"));
            s.blocks.push(block(i, &stem, 100, &["作品"]));
        }
        let start = std::time::Instant::now(); let result = compute(s, ReflectionQuery::default());
        eprintln!("10k block compute: {:?}, {} JSON bytes", start.elapsed(), serde_json::to_vec(&result).unwrap().len());
        assert_eq!(result.overview.daily_blocks_count, 10_000);
    }
}
