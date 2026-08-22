use serde::Deserialize;
use std::{collections::HashSet, fs, io, path::Path};

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

    pub(crate) fn is_mmd_subdir(&self, name: &str) -> bool {
        self.mmd_subdirs.contains(&name.to_ascii_lowercase())
    }
}

pub(crate) fn normalize_ext(ext: &str) -> String {
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
