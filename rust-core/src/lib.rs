use jwalk::{rayon::prelude::*, WalkDir};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const DEFAULT_MAX_HASH_BYTES: u64 = 500 * 1024 * 1024;

const MMD_SUBDIRS: &[&str] = &[
    "EntityPlayer",
    "SceneModel",
    "DefaultAnim",
    "CustomAnim",
    "StageAnim",
    "DefaultMorph",
    "CustomMorph",
    "shader",
];

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

#[derive(Debug, Clone)]
pub struct ScanPolicy {
    supported_exts: HashSet<String>,
    hash_exts: HashSet<String>,
    mmd_subdirs: HashSet<String>,
    pub max_hash_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct Registry {
    #[serde(rename = "resourceTypes")]
    resource_types: Vec<ResourceType>,
}

#[derive(Debug, Deserialize)]
struct ResourceType {
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    hashable: bool,
}

impl ScanPolicy {
    pub fn from_registry_json(input: &str) -> Result<Self, serde_json::Error> {
        let registry: Registry = serde_json::from_str(input)?;
        let mut supported_exts = HashSet::new();
        let mut hash_exts = HashSet::new();

        for resource_type in registry.resource_types {
            for ext in resource_type.extensions {
                let ext = normalize_ext(&ext);
                if ext.is_empty() {
                    continue;
                }
                supported_exts.insert(ext.clone());
                if resource_type.hashable {
                    hash_exts.insert(ext);
                }
            }
        }

        Ok(Self {
            supported_exts,
            hash_exts,
            mmd_subdirs: MMD_SUBDIRS.iter().map(|s| s.to_ascii_lowercase()).collect(),
            max_hash_bytes: DEFAULT_MAX_HASH_BYTES,
        })
    }

    pub fn from_registry_path(path: impl AsRef<Path>) -> io::Result<Self> {
        let raw = fs::read_to_string(path)?;
        Self::from_registry_json(&raw)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
    }

    pub fn supports_ext(&self, ext: &str) -> bool {
        self.supported_exts.contains(&normalize_ext(ext))
    }

    pub fn should_hash_ext(&self, ext: &str) -> bool {
        self.hash_exts.contains(&normalize_ext(ext))
    }

    fn is_mmd_subdir(&self, name: &str) -> bool {
        self.mmd_subdirs.contains(&name.to_ascii_lowercase())
    }
}

pub fn scan_fast(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    let root = root.as_ref().to_path_buf();
    if root.as_os_str().is_empty() {
        return ScanReport::default();
    }

    let mut errors = Vec::new();
    let mut candidates = Vec::new();

    let walk = WalkDir::new(&root).process_read_dir(|_, _, _, children| {
        for child in children
            .iter_mut()
            .filter_map(|result| result.as_mut().ok())
        {
            if child.file_type.is_dir() && should_skip_dir_name(&child.file_name.to_string_lossy())
            {
                child.read_children = None;
            }
        }
    });

    for result in walk {
        match result {
            Ok(entry) => {
                if entry.depth() == 0 || entry.file_type().is_dir() {
                    continue;
                }

                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                let restored = strip_disable_suffix(&name);
                let ext = extension_of(restored);

                if ext.is_empty() || !policy.supports_ext(&ext) {
                    continue;
                }
                if ext == ".json" && !restored.eq_ignore_ascii_case("ysm.json") {
                    continue;
                }

                let subdir = first_relative_component(&root, &path)
                    .filter(|name| policy.is_mmd_subdir(name))
                    .unwrap_or_default();

                candidates.push(Candidate {
                    name,
                    path,
                    ext,
                    subdir,
                });
            }
            Err(err) => errors.push(ScanError {
                path: err.path().unwrap_or(root.as_path()).to_path_buf(),
                message: err.to_string(),
            }),
        }
    }

    let resolved: Vec<Result<ModelEntry, ScanError>> =
        candidates.into_par_iter().map(resolve_metadata).collect();

    let mut entries = Vec::with_capacity(resolved.len());
    for item in resolved {
        match item {
            Ok(entry) => entries.push(entry),
            Err(err) => errors.push(err),
        }
    }

    ScanReport { entries, errors }
}

pub fn hydrate_hashes(entries: &mut [ModelEntry], policy: &ScanPolicy) -> Vec<ScanError> {
    entries
        .par_iter_mut()
        .filter_map(|entry| {
            if !policy.should_hash_ext(&entry.ext) {
                return None;
            }
            if entry.size < 0 || entry.size as u64 > policy.max_hash_bytes {
                entry.hash.clear();
                return Some(ScanError {
                    path: entry.path.clone(),
                    message: format!(
                        "hash skipped: file is larger than {} bytes",
                        policy.max_hash_bytes
                    ),
                });
            }

            match sha256_file(&entry.path) {
                Ok(hash) => {
                    entry.hash = hash;
                    None
                }
                Err(err) => {
                    entry.hash.clear();
                    Some(ScanError {
                        path: entry.path.clone(),
                        message: format!("hash failed: {err}"),
                    })
                }
            }
        })
        .collect()
}

pub fn scan_eager(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    let mut report = scan_fast(root, policy);
    report
        .errors
        .extend(hydrate_hashes(&mut report.entries, policy));
    report
}

pub fn sha256_file(path: impl AsRef<Path>) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    Ok(hex)
}

#[derive(Debug)]
struct Candidate {
    name: String,
    path: PathBuf,
    ext: String,
    subdir: String,
}

fn resolve_metadata(candidate: Candidate) -> Result<ModelEntry, ScanError> {
    let metadata = fs::metadata(&candidate.path).map_err(|err| ScanError {
        path: candidate.path.clone(),
        message: format!("metadata failed: {err}"),
    })?;

    Ok(ModelEntry {
        name: candidate.name,
        size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
        path: candidate.path,
        ext: candidate.ext,
        hash: String::new(),
        mod_time_ms: system_time_to_unix_ms(metadata.modified().unwrap_or(UNIX_EPOCH)),
        subdir: candidate.subdir,
    })
}

fn system_time_to_unix_ms(time: std::time::SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(err) => -i64::try_from(err.duration().as_millis()).unwrap_or(i64::MAX),
    }
}

fn normalize_ext(ext: &str) -> String {
    let trimmed = ext.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        return trimmed;
    }
    if trimmed.starts_with('.') {
        trimmed
    } else {
        format!(".{trimmed}")
    }
}

fn strip_disable_suffix(name: &str) -> &str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".ban") {
        &name[..name.len() - 4]
    } else if lower.ends_with(".disabled") {
        &name[..name.len() - ".disabled".len()]
    } else {
        name
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_ext)
        .unwrap_or_default()
}

fn should_skip_dir_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(".recycle")
        || name == ".github"
        || name.to_ascii_lowercase().ends_with(".ban")
}

fn first_relative_component(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    relative.components().find_map(|component| match component {
        Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let nonce = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "ysm-rust-core-{label}-{}-{timestamp}-{nonce}",
                process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn policy() -> ScanPolicy {
        ScanPolicy::from_registry_json(
            r#"{
              "resourceTypes": [
                {"id":"ysm","extensions":[".ysm",".json"],"hashable":true},
                {"id":"blueprint","extensions":[".nbt"],"hashable":true},
                {"id":"other","extensions":[".zip"],"hashable":false}
              ]
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn registry_drives_supported_and_hashable_extensions() {
        let policy = policy();
        assert!(policy.supports_ext(".ysm"));
        assert!(policy.supports_ext("ZIP"));
        assert!(policy.should_hash_ext(".ysm"));
        assert!(!policy.should_hash_ext(".zip"));
    }

    #[test]
    fn scan_preserves_go_filter_contract() {
        let root = TempRoot::new("filters");
        fs::write(root.path().join("a.ysm"), b"data").unwrap();
        fs::write(root.path().join("b.txt"), b"x").unwrap();
        fs::write(root.path().join("c.ysm.ban"), b"x").unwrap();
        fs::write(root.path().join("anim.json"), b"{}").unwrap();
        fs::write(root.path().join("ysm.json"), b"{}").unwrap();

        let recycle = root.path().join(".ReCyClE");
        fs::create_dir_all(&recycle).unwrap();
        fs::write(recycle.join("d.ysm"), b"x").unwrap();

        let github = root.path().join(".github");
        fs::create_dir_all(&github).unwrap();
        fs::write(github.join("ignored.ysm"), b"x").unwrap();

        let banned_dir = root.path().join("disabled-model.ban");
        fs::create_dir_all(&banned_dir).unwrap();
        fs::write(banned_dir.join("ignored.ysm"), b"x").unwrap();

        let report = scan_fast(root.path(), &policy());
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.entries.len(), 3);

        let disabled = report
            .entries
            .iter()
            .find(|entry| entry.name == "c.ysm.ban")
            .unwrap();
        assert_eq!(disabled.ext, ".ysm");

        assert!(report.entries.iter().any(|entry| entry.name == "a.ysm"));
        assert!(report.entries.iter().any(|entry| entry.name == "ysm.json"));
        assert!(!report.entries.iter().any(|entry| entry.name == "anim.json"));
    }

    #[test]
    fn fast_scan_defers_hash_then_parallel_hydration_matches_sha256() {
        let root = TempRoot::new("hash");
        fs::write(root.path().join("hello.ysm"), b"hello").unwrap();

        let mut report = scan_fast(root.path(), &policy());
        assert!(report.errors.is_empty());
        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.entries[0].hash, "");

        let errors = hydrate_hashes(&mut report.entries, &policy());
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(
            report.entries[0].hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn mmd_first_level_directory_is_preserved_for_grouping() {
        let root = TempRoot::new("mmd");
        let scene = root.path().join("SceneModel");
        fs::create_dir_all(&scene).unwrap();
        fs::write(scene.join("stage.nbt"), b"x").unwrap();

        let report = scan_fast(root.path(), &policy());
        assert!(report.errors.is_empty());
        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.entries[0].subdir, "SceneModel");
    }

    #[test]
    fn oversized_hashable_file_is_reported_without_hashing() {
        let root = TempRoot::new("limit");
        let path = root.path().join("large.ysm");
        fs::write(&path, b"1234").unwrap();

        let mut policy = policy();
        policy.max_hash_bytes = 3;

        let mut report = scan_fast(root.path(), &policy);
        let errors = hydrate_hashes(&mut report.entries, &policy);

        assert_eq!(report.entries[0].hash, "");
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("larger than"));
    }
}
