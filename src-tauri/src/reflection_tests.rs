use super::*;
use chrono::TimeZone;

fn memory_index() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    initialize_index(&conn).unwrap();
    conn
}

fn version(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap()
}

fn local_time(hour: u32) -> i64 {
    Local.with_ymd_and_hms(2026, 11, 2, hour, 0, 0).earliest().unwrap().timestamp()
}

fn fixture_workspace() -> tests::TempDir {
    let dir = tests::TempDir::new();
    fs::write(dir.0.join("article-1.md"), "# 《标题作品》\n\n#阅读 重读《三体》，又读〈三体〉，翻开《百年  孤独》。 [[file|别名]]").unwrap();
    fs::write(dir.0.join("2026-11-02.md"), "#随记 看《三体》。\n\n\n\n独白。\n\n\n\n```md\n《代码作品》\n\n\n\n#代码 《仍是代码》\n```\n\n\n\n最后看〈活着〉。").unwrap();
    let registry = serde_json::json!({
        "article-1.md": { "created": local_time(23) },
        "2026-11-02.md": { "created": local_time(0) }
    });
    fs::write(dir.0.join(note_times::REGISTRY), serde_json::to_vec_pretty(&registry).unwrap()).unwrap();
    dir
}

fn logical_blocks(conn: &rusqlite::Connection) -> Vec<(String, String, String, i64, bool, Option<u8>, bool)> {
    conn.prepare("SELECT date, raw_markdown, clean_text, clean_char_count, is_untagged, hour_of_day, is_noise FROM blocks ORDER BY date, id").unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)))
        .unwrap().map(Result::unwrap).collect()
}

fn logical_works(conn: &rusqlite::Connection) -> Vec<(String, String, String, i64, i64, f64)> {
    conn.prepare("SELECT b.date, b.raw_markdown, w.work_name, w.mention_count, w.co_occurrence_count, w.effective_chars FROM note_work_mentions w JOIN blocks b ON b.id = w.block_id ORDER BY b.date, b.id, w.work_name").unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))
        .unwrap().map(Result::unwrap).collect()
}

#[test]
fn reflection_rebuild_indexes_articles_and_journal_blocks_without_touching_sources() {
    let dir = fixture_workspace();
    let files = workspace_files(&dir.0, true).unwrap();
    let originals: Vec<_> = files.iter().map(|path| (fs::read(path).unwrap(), fs::metadata(path).unwrap().modified().unwrap())).collect();
    let mut conn = memory_index();
    assert_eq!(rebuild_workspace_index(&mut conn, &dir.0).unwrap(), 2);
    assert_eq!(version(&conn), REFLECTION_INDEX_VERSION);
    let blocks = logical_blocks(&conn);
    assert_eq!(blocks.len(), 5);
    let journal: Vec<_> = blocks.iter().filter(|block| block.0 == "2026-11-02").collect();
    assert_eq!(journal.len(), 4);
    assert!(journal.iter().all(|block| block.5.is_none()));
    assert!(journal[1].4);
    assert_eq!(journal[1].2, "独白。");
    assert!(journal[2].6);
    let works = logical_works(&conn);
    assert!(!works.iter().any(|work| work.2.contains("代码")));
    let article = blocks.iter().find(|block| block.0 == "article-1").unwrap();
    assert_eq!(article.5, Some(23));
    assert!(!article.4);
    assert!(article.2.starts_with("《标题作品》"));
    let article_works: Vec<_> = works.iter().filter(|work| work.0 == "article-1").collect();
    assert_eq!(article_works.len(), 3);
    assert!(article_works.iter().all(|work| work.4 == 3 && (work.5 - article.3 as f64 / 3.0).abs() < 1e-10));
    assert_eq!(article_works.iter().find(|work| work.2 == "三体").unwrap().3, 2);
    assert!(article_works.iter().any(|work| work.2 == "百年 孤独"));
    let joined: (String, String, String) = conn.query_row(
        "SELECT d.stem || '.md', d.created_date, t.name FROM note_work_mentions w JOIN blocks b ON b.id = w.block_id JOIN documents d ON d.stem = b.date JOIN block_tags bt ON bt.block_id = b.id JOIN tags t ON t.id = bt.tag_id WHERE w.work_name = '标题作品'", [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
    assert_eq!(joined, ("article-1.md".into(), "2026-11-02".into(), "阅读".into()));
    assert_eq!(rebuild_workspace_index(&mut conn, &dir.0).unwrap(), 2);
    assert_eq!(logical_blocks(&conn), blocks);
    assert_eq!(logical_works(&conn), works);
    assert_eq!(workspace_files(&dir.0, true).unwrap(), files);
    for (path, (bytes, modified)) in files.iter().zip(originals) {
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), modified);
    }
}

#[test]
fn reflection_incremental_updates_cascade_and_roll_back_mentions_atomically() {
    let conn = memory_index();
    index_document(&conn, "article-1", "# 标题\n\n#阅读 看《三体》和《活着》。", &tests::test_times()).unwrap();
    let before_blocks = logical_blocks(&conn);
    let before_works = logical_works(&conn);
    conn.execute_batch("CREATE TRIGGER fail_work BEFORE INSERT ON note_work_mentions BEGIN SELECT RAISE(ABORT, 'entity failure'); END;").unwrap();
    assert!(index_document(&conn, "article-1", "# 新标题\n\n读《新作品》。", &tests::test_times()).is_err());
    assert_eq!(logical_blocks(&conn), before_blocks);
    assert_eq!(logical_works(&conn), before_works);
    assert_eq!(conn.query_row("SELECT title FROM documents", [], |row| row.get::<_, String>(0)).unwrap(), "标题");
    assert_eq!(query_tag_blocks(&conn, "阅读", None, None).unwrap().len(), 1);
    conn.execute_batch("DROP TRIGGER fail_work").unwrap();
    index_document(&conn, "article-1", "# 新标题\n\n无标签《新作品》。", &tests::test_times()).unwrap();
    assert_eq!(logical_works(&conn).len(), 1);
    assert_eq!(logical_works(&conn)[0].2, "新作品");
    assert!(logical_blocks(&conn)[0].4);
    conn.execute("DELETE FROM blocks", []).unwrap();
    assert!(logical_works(&conn).is_empty());
}

#[test]
fn reflection_populated_legacy_index_is_backfilled_once_and_schema_holes_are_detected() {
    let dir = fixture_workspace();
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, content TEXT NOT NULL, raw_markdown TEXT NOT NULL);
        CREATE TABLE documents (stem TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL);
        INSERT INTO documents VALUES ('removed', 'article', 'old');
        INSERT INTO blocks(date, content, raw_markdown) VALUES ('removed', 'stale', 'stale');").unwrap();
    initialize_index(&conn).unwrap();
    initialize_index(&conn).unwrap();
    assert_eq!(version(&conn), 0);
    ensure_index_ready(&mut conn, &dir.0).unwrap();
    assert_eq!(version(&conn), REFLECTION_INDEX_VERSION);
    assert!(logical_blocks(&conn).iter().all(|block| block.0 != "removed"));
    let works = logical_works(&conn);
    let ids: Vec<i64> = conn.prepare("SELECT id FROM blocks ORDER BY id").unwrap().query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
    initialize_index(&conn).unwrap();
    ensure_index_ready(&mut conn, &dir.0).unwrap();
    let after_ids: Vec<i64> = conn.prepare("SELECT id FROM blocks ORDER BY id").unwrap().query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
    assert_eq!(ids, after_ids);
    for damage in ["DROP TABLE note_work_mentions", "ALTER TABLE blocks DROP COLUMN hour_of_day", "DROP INDEX note_work_mentions_by_work"] {
        conn.execute_batch(damage).unwrap();
        initialize_index(&conn).unwrap();
        assert_eq!(version(&conn), 0);
        ensure_index_ready(&mut conn, &dir.0).unwrap();
        assert_eq!(version(&conn), REFLECTION_INDEX_VERSION);
        assert_eq!(logical_works(&conn), works);
    }
}

#[test]
fn reflection_failed_backfill_keeps_previous_data_and_retries() {
    let dir = fixture_workspace();
    let mut conn = memory_index();
    index_document(&conn, "old", "old 《旧作》", &tests::test_times()).unwrap();
    let blocks = logical_blocks(&conn);
    let works = logical_works(&conn);
    conn.execute_batch("CREATE TRIGGER fail_work BEFORE INSERT ON note_work_mentions BEGIN SELECT RAISE(ABORT, 'backfill failure'); END;").unwrap();
    assert!(ensure_index_ready(&mut conn, &dir.0).is_err());
    assert_eq!(version(&conn), 0);
    assert_eq!(logical_blocks(&conn), blocks);
    assert_eq!(logical_works(&conn), works);
    conn.execute_batch("DROP TRIGGER fail_work").unwrap();
    ensure_index_ready(&mut conn, &dir.0).unwrap();
    assert_eq!(version(&conn), REFLECTION_INDEX_VERSION);
    let blocks = logical_blocks(&conn);
    let works = logical_works(&conn);
    conn.execute_batch("CREATE TRIGGER fail_work BEFORE INSERT ON note_work_mentions BEGIN SELECT RAISE(ABORT, 'rebuild failure'); END;").unwrap();
    assert!(rebuild_workspace_index(&mut conn, &dir.0).is_err());
    assert_eq!(version(&conn), REFLECTION_INDEX_VERSION);
    assert_eq!(logical_blocks(&conn), blocks);
    assert_eq!(logical_works(&conn), works);
}

#[test]
fn reflection_schema_migration_is_atomic() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE blocks(id INTEGER PRIMARY KEY, date TEXT, content TEXT, raw_markdown TEXT);
        CREATE TABLE documents(stem TEXT PRIMARY KEY, kind TEXT, title TEXT);
        CREATE TABLE note_work_mentions_by_work(conflict TEXT);").unwrap();
    assert!(initialize_index(&conn).is_err());
    let columns: Vec<String> = conn.prepare("PRAGMA table_info(blocks)").unwrap().query_map([], |row| row.get(1)).unwrap().map(Result::unwrap).collect();
    assert_eq!(columns, vec!["id", "date", "content", "raw_markdown"]);
    assert_eq!(version(&conn), 0);
    conn.execute_batch("DROP TABLE note_work_mentions_by_work").unwrap();
    initialize_index(&conn).unwrap();
}

#[test]
fn reflection_incremental_rebuild_and_migrated_workspace_are_equivalent() {
    let source = fixture_workspace();
    let target = tests::TempDir::new();
    let incremental = memory_index();
    let registry = note_times::load(&source.0).unwrap();
    for filename in ["2026-11-02.md", "article-1.md"] {
        let raw = fs::read_to_string(source.0.join(filename)).unwrap();
        let times = note_times::get(&source.0, filename, &registry).unwrap();
        index_document(&incremental, documents::stem(filename), &raw, &times).unwrap();
    }
    let mut rebuilt = memory_index();
    rebuild_workspace_index(&mut rebuilt, &source.0).unwrap();
    assert_eq!(logical_blocks(&rebuilt), logical_blocks(&incremental));
    assert_eq!(logical_works(&rebuilt), logical_works(&incremental));
    copy_workspace(&source.0, &target.0, true).unwrap();
    let mut migrated = memory_index();
    rebuild_workspace_index(&mut migrated, &target.0).unwrap();
    assert_eq!(logical_blocks(&migrated), logical_blocks(&rebuilt));
    assert_eq!(logical_works(&migrated), logical_works(&rebuilt));
    fs::remove_file(target.0.join("article-1.md")).unwrap();
    rebuild_workspace_index(&mut migrated, &target.0).unwrap();
    assert!(logical_blocks(&migrated).iter().all(|block| block.0 != "article-1"));
    assert!(logical_works(&migrated).iter().all(|work| work.0 != "article-1"));
    assert_eq!(logical_works(&rebuilt).iter().filter(|work| work.0 == "article-1").count(), 3);
}

#[test]
fn reflection_code_indentation_and_existing_plain_block_grouping_are_preserved() {
    let conn = memory_index();
    index_document(&conn, "2026-11-02", "#随记 第一段\n\n第二行\n\n\n\n第二段", &tests::test_times()).unwrap();
    let blocks = query_tag_blocks(&conn, "随记", None, None).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].content, "第一段\n\n第二行");
    assert_eq!(blocks[0].raw_markdown, "#随记 第一段\n\n第二行");
    assert_eq!(query_tag_blocks(&conn, "默认", None, None).unwrap()[0].content, "第二段");
    index_document(&conn, "2026-11-02", "    #代码 《不可提取》\n\n\n\n    《仍是代码》", &tests::test_times()).unwrap();
    let blocks = logical_blocks(&conn);
    assert_eq!(blocks.len(), 1);
    assert!(blocks[0].1.starts_with("    #代码"));
    assert!(blocks[0].4);
    assert!(logical_works(&conn).is_empty());
    index_document(&conn, "2026-11-02", "```\n《不应提取》\n\n\n\n《仍被围栏保护》", &tests::test_times()).unwrap();
    let blocks = logical_blocks(&conn);
    assert_eq!(blocks.len(), 1);
    assert!(blocks[0].6);
    assert!(logical_works(&conn).is_empty());
}

#[test]
fn reflection_mixed_block_has_exact_character_allocation() {
    let conn = memory_index();
    index_document(&conn, "2026-11-02", "#札记 [[file|甲]]《一》与〈二〉《一》", &tests::test_times()).unwrap();
    let block: (String, i64, bool, bool) = conn.query_row(
        "SELECT clean_text, clean_char_count, is_untagged, is_noise FROM blocks", [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))).unwrap();
    assert_eq!(block, ("甲《一》与〈二〉《一》".into(), 11, false, false));
    let works = logical_works(&conn);
    assert_eq!(works.len(), 2);
    assert_eq!((works[0].2.as_str(), works[0].3, works[0].4, works[0].5), ("一", 2, 2, 5.5));
    assert_eq!((works[1].2.as_str(), works[1].3, works[1].4, works[1].5), ("二", 1, 2, 5.5));
    index_document(&conn, "2026-11-02", "   ", &tests::test_times()).unwrap();
    assert!(logical_blocks(&conn).is_empty());
    assert!(logical_works(&conn).is_empty());
    index_document(&conn, "article-1", "", &tests::test_times()).unwrap();
    let empty = logical_blocks(&conn);
    assert_eq!(empty.len(), 1);
    assert_eq!(empty[0].3, 0);
    assert!(empty[0].4);
    assert!(!empty[0].6);
    assert!(logical_works(&conn).is_empty());
}

#[test]
fn reflection_hours_share_document_creation_and_preserve_midnight_uncertainty() {
    let conn = memory_index();
    let mut times = tests::test_times();
    times.created = local_time(0);
    times.modified = local_time(19);
    index_document(&conn, "2026-11-02", "one\n\n\n\ntwo", &times).unwrap();
    assert!(logical_blocks(&conn).iter().all(|block| block.5.is_none()));
    times.created = local_time(22);
    index_document(&conn, "2026-11-02", "one\n\n\n\ntwo", &times).unwrap();
    assert!(logical_blocks(&conn).iter().all(|block| block.5 == Some(22)));
    times.created = local_time(0);
    index_document(&conn, "article-1", "# 标题", &times).unwrap();
    assert_eq!(logical_blocks(&conn).last().unwrap().5, Some(0));
}

fn period_times(created: &str, modified: &str) -> NoteTimes {
    let timestamp = |text: &str| {
        let value = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").unwrap();
        Local.from_local_datetime(&value).earliest().unwrap().timestamp()
    };
    NoteTimes { created: timestamp(created), modified: timestamp(modified), created_date: created[..10].into() }
}

fn period_result(conn: &mut rusqlite::Connection, json: serde_json::Value) -> serde_json::Value {
    let query: reflection::ReflectionQuery = serde_json::from_value(json).unwrap();
    query.validate().unwrap();
    let snapshot = reflection::load_snapshot(conn, &query).unwrap();
    serde_json::to_value(reflection::compute(snapshot, query)).unwrap()
}

#[test]
fn period_scope_uses_full_real_tags_and_counts_each_valid_reference() {
    let mut conn = memory_index();
    let old = period_times("2020-01-01 12:00:00", "2020-01-01 12:00:00");
    index_document(&conn, "target", "# 引力中心\n\n旧篇。", &old).unwrap();
    let now = period_times("2026-11-02 12:00:00", "2026-11-02 12:00:00");
    let source = "#阅读 #次标签 #默认 两次 [[target|名字]] 与 [[target.md]]。 `[[target]]` \\[[target]]\n\n```md\n[[target]] #代码标签\n```";
    index_document(&conn, "2026-11-02", source, &now).unwrap();
    index_document(&conn, "custom", "# 自引用\n\n#次标签 [[custom]] 与 [[target]]。", &now).unwrap();
    let query = serde_json::json!({"startDate":"2026-11-01", "endDate":"2026-11-30", "perspective":{"kind":"tag","tag":"次标签"}});
    let result = period_result(&mut conn, query);
    assert_eq!(result["overview"]["dailyBlocksCount"], 1);
    assert_eq!(result["overview"]["titledArticlesCount"], 1);
    assert_eq!(result["themes"]["untaggedBlocksCount"], 0);
    let tags = result["themes"]["topTags"].as_array().unwrap();
    assert!(tags.iter().any(|value| value["tag"] == "次标签" && value["count"] == 2));
    assert!(tags.iter().any(|value| value["tag"] == "默认" && value["count"] == 1));
    assert!(!tags.iter().any(|value| value["tag"] == "代码标签"));
    let target = &result["articles"]["mostReferenced"][0];
    assert_eq!(target["filename"], "target.md");
    assert_eq!(target["referenceCount"], 3);
    assert_eq!(target["sourceCount"], 2);
    assert_eq!(target["sources"].as_array().unwrap().len(), 2);
    assert!(!result["articles"]["mostReferenced"].as_array().unwrap().iter().any(|value| value["filename"] == "custom.md"));
    assert_eq!(query_tag_blocks(&conn, "次标签", None, None).unwrap().len(), 1);
    let untagged = period_result(&mut conn, serde_json::json!({"perspective":{"kind":"untagged"}}));
    assert!(untagged["themes"]["topTags"].as_array().unwrap().is_empty());
}

#[test]
fn period_modified_articles_contribute_events_without_replaying_old_words() {
    let mut conn = memory_index();
    let times = period_times("2020-01-01 12:00:00", "2026-11-02 12:00:00");
    index_document(&conn, "imported-title", &format!("# 《旧作品》\n\n#历史 {}", "旧".repeat(120)), &times).unwrap();
    let result = period_result(&mut conn, serde_json::json!({"startDate":"2026-11-02", "endDate":"2026-11-02"}));
    assert_eq!(result["overview"]["activeDaysCount"], 0);
    assert_eq!(result["overview"]["titledArticlesCount"], 0);
    assert_eq!(result["overview"]["richestDay"]["date"], "2026-11-02");
    assert_eq!(result["overview"]["richestDay"]["articles"][0]["filename"], "imported-title.md");
    assert!(result["overview"]["richestDay"]["tags"].as_array().unwrap().is_empty());
    assert_eq!(result["themes"]["totalDistinctWorksCount"], 0);
    assert_eq!(result["articles"]["longestBrewed"].as_array().unwrap().len(), 1);
    assert_eq!(result["articles"]["longestBrewed"][0]["filename"], "imported-title.md");
    assert!(result["sampledQuotes"].as_array().unwrap().is_empty());
}

#[test]
fn period_title_entity_merges_without_double_allocating_characters() {
    let mut conn = memory_index();
    let old = period_times("2020-01-01 12:00:00", "2020-01-01 12:00:00");
    index_document(&conn, "2020-01-01", "《三体》", &old).unwrap();
    let now = period_times("2026-11-02 12:00:00", "2026-11-02 12:00:00");
    index_document(&conn, "imported", &format!("# **三体**\n\n《活着》{}", "字".repeat(150)), &now).unwrap();
    let clean: f64 = conn.query_row("SELECT clean_char_count FROM blocks WHERE date='imported'", [], |row| row.get(0)).unwrap();
    let result = period_result(&mut conn, serde_json::json!({"startDate":"2026-11-02", "endDate":"2026-11-02"}));
    assert_eq!(result["themes"]["totalDistinctWorksCount"], 2);
    let works = result["themes"]["deepWorks"].as_array().unwrap();
    assert_eq!(works.len(), 2);
    assert_eq!(works[0]["workName"], "三体");
    assert_eq!(works[0]["mentionCount"], 1);
    let total: f64 = works.iter().map(|value| value["effectiveChars"].as_f64().unwrap()).sum();
    assert!((total - clean).abs() < 1e-10);
    assert!(works.iter().all(|value| value["representativeQuote"]["filename"] == "imported.md"));
    let stored: i64 = conn.query_row("SELECT COUNT(*) FROM article_title_works", [], |row| row.get(0)).unwrap();
    assert_eq!(stored, 0);
    index_document(&conn, "imported", "# 《三体》\n\n短文。", &now).unwrap();
    let result = period_result(&mut conn, serde_json::json!({"startDate":"2026-11-02", "endDate":"2026-11-02"}));
    assert_eq!(result["themes"]["deepWorks"][0]["mentionCount"], 1);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM article_title_works", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
    index_document(&conn, "imported", "# 新标题\n\n没有作品。", &now).unwrap();
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM article_title_works", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn period_v2_migration_repairs_metadata_and_new_index_writes_roll_back() {
    let dir = fixture_workspace();
    let mut conn = memory_index();
    rebuild_workspace_index(&mut conn, &dir.0).unwrap();
    conn.execute_batch("DROP TABLE reflection_wiki_links; DROP TABLE reflection_block_tags; DROP TABLE article_title_works;
        DROP INDEX blocks_by_document; ALTER TABLE blocks DROP COLUMN source_ordinal;
        ALTER TABLE blocks DROP COLUMN anchor_text; ALTER TABLE blocks DROP COLUMN anchor_occurrence;
        DROP INDEX articles_by_modified_date; ALTER TABLE documents DROP COLUMN modified_date;
        ALTER TABLE documents DROP COLUMN normalized_h1; PRAGMA user_version=1;").unwrap();
    initialize_index(&conn).unwrap();
    assert_eq!(version(&conn), 0);
    ensure_index_ready(&mut conn, &dir.0).unwrap();
    assert_eq!(version(&conn), 2);
    let query = serde_json::json!({});
    let before = period_result(&mut conn, query.clone());
    let metadata: (String, i64) = conn.query_row("SELECT modified_date, COUNT(*) FROM documents", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    assert_eq!(metadata.0.len(), 10);
    conn.execute_batch("CREATE TRIGGER fail_wiki BEFORE INSERT ON reflection_wiki_links BEGIN SELECT RAISE(ABORT,'v2 write failure'); END;").unwrap();
    assert!(index_document(&conn, "article-1", "# 新标题\n\n#新标签 [[target]] 《新作品》", &tests::test_times()).is_err());
    assert_eq!(period_result(&mut conn, query), before);
    conn.execute_batch("DROP TRIGGER fail_wiki; DELETE FROM blocks;").unwrap();
    for table in ["reflection_wiki_links", "reflection_block_tags", "note_work_mentions"] {
        assert_eq!(conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
}

#[test]
fn period_empty_scope_does_not_load_unrelated_article_metadata_or_work_names() {
    let mut conn = memory_index();
    let times = period_times("2020-01-01 12:00:00", "2020-01-02 12:00:00");
    for i in 0..50 {
        index_document(&conn, &format!("article-{i}"), &format!("# 《旧作品{i}》\n\n{}", "旧".repeat(120)), &times).unwrap();
    }
    let query: reflection::ReflectionQuery = serde_json::from_value(serde_json::json!({"startDate":"2026-11-01","endDate":"2026-11-30"})).unwrap();
    let snapshot = reflection::load_snapshot(&mut conn, &query).unwrap();
    assert!(snapshot.blocks.is_empty());
    assert!(snapshot.documents.is_empty());
    assert!(snapshot.known_work_names.is_empty());
}

fn without_block_ids(mut value: serde_json::Value) -> serde_json::Value {
    match &mut value {
        serde_json::Value::Object(fields) => {
            fields.remove("blockId");
            for child in fields.values_mut() { *child = without_block_ids(std::mem::take(child)); }
        }
        serde_json::Value::Array(values) => {
            for child in values { *child = without_block_ids(std::mem::take(child)); }
        }
        _ => {}
    }
    value
}

#[test]
fn period_sqlite_rebuild_preserves_logical_cards_and_full_results_are_repeatable() {
    let dir = tests::TempDir::new();
    let mut registry = note_times::Registry::new();
    for day in 1..=8 {
        let date = format!("2026-11-{day:02}");
        let filename = format!("{date}.md");
        fs::write(dir.0.join(&filename), format!("第{day}夜 {}。", "文字".repeat(40))).unwrap();
        let created = period_times(&format!("{date} 23:00:00"), &format!("{date} 23:00:00")).created;
        registry.insert(filename, note_times::Entry { created });
    }
    fs::write(dir.0.join(note_times::REGISTRY), serde_json::to_vec_pretty(&registry).unwrap()).unwrap();
    let mut conn = memory_index();
    rebuild_workspace_index(&mut conn, &dir.0).unwrap();
    let query = serde_json::json!({"startDate":"2026-11-01","endDate":"2026-11-30"});
    let original = period_result(&mut conn, query.clone());
    assert_eq!(original["sampledQuotes"].as_array().unwrap().len(), 4);
    assert_eq!(original, period_result(&mut conn, query.clone()));
    let rotated = period_result(&mut conn, serde_json::json!({"startDate":"2026-11-01","endDate":"2026-11-30","pageSeed":1}));
    assert_ne!(original["sampledQuotes"], rotated["sampledQuotes"]);
    for field in ["overview", "themes", "articles"] { assert_eq!(original[field], rotated[field]); }
    rebuild_workspace_index(&mut conn, &dir.0).unwrap();
    let rebuilt = period_result(&mut conn, query);
    assert_ne!(original["sampledQuotes"][0]["blockId"], rebuilt["sampledQuotes"][0]["blockId"]);
    assert_eq!(without_block_ids(original), without_block_ids(rebuilt));
}

#[test]
#[ignore = "manual warm SQLite query benchmark on 10,000 derived blocks"]
fn period_ten_thousand_block_warm_queries() {
    let mut conn = memory_index();
    {
        let tx = conn.transaction().unwrap();
        let base = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        for day in 0..100 {
            let date = (base + chrono::Duration::days(day)).to_string();
            let times = period_times(&format!("{date} 23:00:00"), &format!("{date} 23:00:00"));
            tx.execute("INSERT INTO documents(stem,kind,title,created,modified,created_date,modified_date) VALUES (?1,'journal',?1,?2,?2,?1,?1)",
                rusqlite::params![date, times.created]).unwrap();
            for ordinal in 0..100 {
                let name = format!("作品{}", ordinal % 20);
                let raw = format!("第{ordinal}则 《{name}》{}。", "文字".repeat(40));
                let chars = raw.chars().count() as i64;
                tx.execute("INSERT INTO blocks(date,content,raw_markdown,clean_text,clean_char_count,is_untagged,hour_of_day,is_noise,source_ordinal,anchor_text,anchor_occurrence) VALUES (?1,?2,?2,?2,?3,?4,23,?5,?6,?2,0)",
                    rusqlite::params![date, raw, chars, ordinal % 2 == 0, ordinal % 17 == 0, ordinal]).unwrap();
                let id = tx.last_insert_rowid();
                tx.execute("INSERT INTO note_work_mentions VALUES (?1,?2,1,1,?3)", rusqlite::params![id, name, chars]).unwrap();
                if ordinal % 2 != 0 {
                    tx.execute("INSERT INTO reflection_block_tags VALUES (?1,'读书')", [id]).unwrap();
                }
                if ordinal % 5 == 0 {
                    tx.execute("INSERT INTO reflection_wiki_links VALUES (?1,0,'article-0.md',0,1)", [id]).unwrap();
                }
            }
        }
        for i in 0..20 {
            let times = period_times("2025-01-01 12:00:00", "2026-02-01 12:00:00");
            index_document(&tx, &format!("article-{i}"), &format!("# 《作品{i}》\n\n{}", "篇目".repeat(60)), &times).unwrap();
        }
        tx.commit().unwrap();
    }
    for (label, json) in [("all", serde_json::json!({})),
        ("tag", serde_json::json!({"perspective":{"kind":"tag","tag":"读书"}})),
        ("empty", serde_json::json!({"startDate":"1900-01-01","endDate":"1900-01-31"}))] {
        let query: reflection::ReflectionQuery = serde_json::from_value(json).unwrap();
        let mut timings = Vec::new();
        for _ in 0..5 {
            let start = std::time::Instant::now();
            let snapshot = reflection::load_snapshot(&mut conn, &query).unwrap();
            let read = start.elapsed();
            let result = reflection::compute(snapshot, query.clone());
            let total = start.elapsed();
            timings.push(total);
            eprintln!("10k {label}: snapshot={read:?}, total={total:?}, bytes={}", serde_json::to_vec(&result).unwrap().len());
            if label == "all" { assert_eq!(result.overview.daily_blocks_count, 10_000); }
            if label == "empty" { assert_eq!(result.overview.daily_blocks_count, 0); }
        }
        timings.sort();
        eprintln!("10k {label}: p50={:?}, p95={:?}", timings[2], timings[4]);
    }
}
