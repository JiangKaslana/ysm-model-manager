use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use ysm_model_manager_core::{scan_eager, ModelEntry, ScanError, ScanPolicy};

#[derive(Serialize)]
pub(crate) struct ScanResponse {
    entries: Vec<CompatModelEntry>,
    errors: Vec<CompatScanError>,
    cacheable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ScanResponse {
    pub(crate) fn fatal(message: impl Into<String>) -> Self {
        Self {
            entries: Vec::new(),
            errors: Vec::new(),
            cacheable: false,
            error: Some(message.into()),
        }
    }
}

#[derive(Serialize)]
struct CompatModelEntry {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Size")]
    size: i64,
    #[serde(rename = "Path")]
    path: String,
    #[serde(rename = "Ext")]
    ext: String,
    #[serde(rename = "Hash")]
    hash: String,
    #[serde(rename = "ModTime")]
    mod_time: i64,
    #[serde(rename = "HasTags")]
    has_tags: bool,
    #[serde(rename = "subdir", skip_serializing_if = "String::is_empty")]
    subdir: String,
}

impl From<ModelEntry> for CompatModelEntry {
    fn from(entry: ModelEntry) -> Self {
        Self {
            name: entry.name,
            size: entry.size,
            path: entry.path.to_string_lossy().into_owned(),
            ext: entry.ext,
            hash: entry.hash,
            mod_time: entry.mod_time_ms,
            has_tags: false,
            // Upstream v1.13 flattened the Wails repository view. Keep richer grouping metadata
            // inside rust-core/rust-index, but do not reintroduce it through the legacy binding.
            subdir: String::new(),
        }
    }
}

#[derive(Serialize)]
struct CompatScanError {
    path: String,
    message: String,
}

impl From<ScanError> for CompatScanError {
    fn from(error: ScanError) -> Self {
        Self {
            path: error.path.to_string_lossy().into_owned(),
            message: error.message,
        }
    }
}

pub(crate) fn scan_json(root: &str, registry_json: &str) -> ScanResponse {
    let policy = match ScanPolicy::from_registry_json(registry_json) {
        Ok(policy) => policy,
        Err(error) => return ScanResponse::fatal(format!("invalid resource registry: {error}")),
    };
    let root = PathBuf::from(root);
    match fs::metadata(&root) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return non_cacheable_error(&root, "scan root is not a directory"),
        Err(error) => {
            return non_cacheable_error(&root, format!("scan root is not readable: {error}"))
        }
    }
    let mut report = scan_eager(root, &policy);
    report.entries.sort_by(|a, b| a.path.cmp(&b.path));
    report.errors.sort_by(|a, b| a.path.cmp(&b.path));
    ScanResponse {
        entries: report.entries.into_iter().map(Into::into).collect(),
        errors: report.errors.into_iter().map(Into::into).collect(),
        cacheable: true,
        error: None,
    }
}

fn non_cacheable_error(path: &Path, message: impl Into<String>) -> ScanResponse {
    ScanResponse {
        entries: Vec::new(),
        errors: vec![CompatScanError {
            path: path.to_string_lossy().into_owned(),
            message: message.into(),
        }],
        cacheable: false,
        error: None,
    }
}
