use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelEntry {
    pub name: String,
    pub size: i64,
    pub path: PathBuf,
    pub ext: String,
    pub hash: String,
    pub mod_time_ms: i64,
    pub subdir: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanError {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct ScanReport {
    pub entries: Vec<ModelEntry>,
    pub errors: Vec<ScanError>,
}
