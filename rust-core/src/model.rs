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
    /// Resource type id (e.g. "ysm" / "EntityPlayer"). Filled from ScanPolicy during scan
    /// so the frontend can read `entry.rtype` directly instead of reverse-looking-up the
    /// type from the file path.
    pub rtype: String,
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
