use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path, time::SystemTime};

pub const REGISTRY: &str = ".silens-created.json";

#[derive(Debug, Clone)]
pub struct NoteTimes {
    pub created: i64,
    pub modified: i64,
    pub created_date: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry { pub created: i64 }
pub type Registry = BTreeMap<String, Entry>;

fn seconds(time: SystemTime) -> i64 {
    chrono::DateTime::<chrono::Utc>::from(time).timestamp()
}

// Callers hold StorageLock across reading, registering, and writing documents.
pub fn load(dir: &Path) -> Result<Registry, String> {
    match fs::read(dir.join(REGISTRY)) {
        Ok(bytes) => {
            let registry: Registry = serde_json::from_slice(&bytes)
                .map_err(|e| format!("CREATED_REGISTRY_ERROR: {}", e))?;
            for (name, entry) in &registry {
                super::document_filename(Some(name), "")?;
                if Local.timestamp_opt(entry.created, 0).single().is_none() {
                    return Err("CREATED_REGISTRY_ERROR: invalid timestamp".into());
                }
            }
            Ok(registry)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("CREATED_REGISTRY_ERROR: {}", e)),
    }
}

pub fn journal_date(filename: &str) -> Option<NaiveDate> {
    if super::documents::kind(filename) != "journal" { return None; }
    NaiveDate::parse_from_str(filename.get(..10)?, "%Y-%m-%d").ok()
}

pub fn ensure(dir: &Path, filename: &str, registry: &mut Registry) -> Result<(), String> {
    if registry.contains_key(filename) { return Ok(()); }
    let created = if let Some(date) = journal_date(filename) {
        Local.from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap()).earliest()
            .ok_or("CREATED_REGISTRY_ERROR: local day start does not exist")?.timestamp()
    } else {
        match fs::metadata(dir.join(filename)) {
            Ok(meta) => {
                let modified = meta.modified().map_err(|e| e.to_string())?;
                // Imported copies can be born after their last content edit.
                seconds(meta.created().unwrap_or(modified).min(modified))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Local::now().timestamp(),
            Err(e) => return Err(format!("CREATED_REGISTRY_ERROR: {}", e)),
        }
    };
    registry.insert(filename.to_owned(), Entry { created });
    let bytes = serde_json::to_vec_pretty(registry).map_err(|e| e.to_string())?;
    super::atomic_write(&dir.join(REGISTRY), &bytes)
}

pub fn get(dir: &Path, filename: &str, registry: &Registry) -> Result<NoteTimes, String> {
    let created = registry.get(filename).ok_or("CREATED_REGISTRY_ERROR: missing document")?.created;
    let modified = seconds(fs::metadata(dir.join(filename)).and_then(|meta| meta.modified())
        .map_err(|e| format!("DOCUMENT_TIME_ERROR: {}", e))?);
    let created_date = match journal_date(filename) {
        Some(date) => date.to_string(),
        None => Local.timestamp_opt(created, 0).single()
            .ok_or("CREATED_REGISTRY_ERROR: invalid timestamp")?.format("%Y-%m-%d").to_string(),
    };
    Ok(NoteTimes { created, modified, created_date })
}

pub fn ensure_workspace(dir: &Path) -> Result<Registry, String> {
    let mut registry = load(dir)?;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        if name.starts_with('.') || !name.ends_with(".md") { continue; }
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            return Err("CREATED_REGISTRY_ERROR: document is not a regular file".into());
        }
        ensure(dir, name, &mut registry)?;
    }
    Ok(registry)
}
