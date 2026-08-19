use std::{collections::HashMap, path::PathBuf};

use ysm_model_manager_core::{scan_fast, ModelEntry, ScanError, ScanPolicy, ScanReport};

#[derive(Debug, Clone, Default)]
pub struct IndexSnapshot {
    pub revision: u64,
    pub entries: Vec<ModelEntry>,
    pub errors: Vec<ScanError>,
}

#[derive(Debug, Clone, Default)]
pub struct IndexDelta {
    pub revision: u64,
    pub added: Vec<ModelEntry>,
    pub updated: Vec<ModelEntry>,
    pub removed: Vec<PathBuf>,
    pub errors: Vec<ScanError>,
}

#[derive(Debug, Default)]
pub struct ModelIndex {
    revision: u64,
    entries: HashMap<PathBuf, ModelEntry>,
    errors: Vec<ScanError>,
}

impl ModelIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn refresh(&mut self, root: impl AsRef<std::path::Path>, policy: &ScanPolicy) -> IndexDelta {
        self.apply_report(scan_fast(root, policy))
    }

    pub fn apply_report(&mut self, report: ScanReport) -> IndexDelta {
        let mut next = HashMap::with_capacity(report.entries.len());
        let mut added = Vec::new();
        let mut updated = Vec::new();

        for mut entry in report.entries {
            match self.entries.get(&entry.path) {
                Some(previous) if metadata_equal(previous, &entry) => {
                    entry.hash.clone_from(&previous.hash);
                }
                Some(_) => updated.push(entry.clone()),
                None => added.push(entry.clone()),
            }
            next.insert(entry.path.clone(), entry);
        }

        let mut removed: Vec<PathBuf> = self
            .entries
            .keys()
            .filter(|path| !next.contains_key(*path))
            .cloned()
            .collect();

        added.sort_by(|a, b| a.path.cmp(&b.path));
        updated.sort_by(|a, b| a.path.cmp(&b.path));
        removed.sort();

        if !added.is_empty() || !updated.is_empty() || !removed.is_empty() {
            self.revision = self.revision.saturating_add(1);
        }

        self.entries = next;
        self.errors = report.errors.clone();

        IndexDelta {
            revision: self.revision,
            added,
            updated,
            removed,
            errors: report.errors,
        }
    }

    pub fn snapshot(&self) -> IndexSnapshot {
        let mut entries: Vec<ModelEntry> = self.entries.values().cloned().collect();
        entries.sort_by(|a, b| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
                .then_with(|| a.path.cmp(&b.path))
        });

        IndexSnapshot {
            revision: self.revision,
            entries,
            errors: self.errors.clone(),
        }
    }

    pub fn replace_entry(&mut self, entry: ModelEntry) {
        self.entries.insert(entry.path.clone(), entry);
    }
}

fn metadata_equal(a: &ModelEntry, b: &ModelEntry) -> bool {
    a.name == b.name
        && a.size == b.size
        && a.ext == b.ext
        && a.mod_time_ms == b.mod_time_ms
        && a.subdir == b.subdir
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, size: i64, mod_time_ms: i64, hash: &str) -> ModelEntry {
        ModelEntry {
            name: path.to_string(),
            size,
            path: PathBuf::from(path),
            ext: ".ysm".to_string(),
            hash: hash.to_string(),
            mod_time_ms,
            subdir: String::new(),
        }
    }

    #[test]
    fn unchanged_refresh_preserves_hash_and_revision() {
        let mut index = ModelIndex::new();
        let first = ScanReport {
            entries: vec![entry("a.ysm", 4, 10, "")],
            errors: vec![],
        };
        let delta = index.apply_report(first);
        assert_eq!(delta.revision, 1);
        assert_eq!(delta.added.len(), 1);

        index.replace_entry(entry("a.ysm", 4, 10, "cached-hash"));
        let second = ScanReport {
            entries: vec![entry("a.ysm", 4, 10, "")],
            errors: vec![],
        };
        let delta = index.apply_report(second);
        assert_eq!(delta.revision, 1);
        assert!(delta.added.is_empty());
        assert!(delta.updated.is_empty());
        assert!(delta.removed.is_empty());
        assert_eq!(index.snapshot().entries[0].hash, "cached-hash");
    }

    #[test]
    fn changed_and_removed_entries_produce_small_delta() {
        let mut index = ModelIndex::new();
        index.apply_report(ScanReport {
            entries: vec![entry("a.ysm", 4, 10, ""), entry("b.ysm", 8, 20, "")],
            errors: vec![],
        });

        let delta = index.apply_report(ScanReport {
            entries: vec![entry("a.ysm", 5, 30, "")],
            errors: vec![],
        });

        assert_eq!(delta.revision, 2);
        assert!(delta.added.is_empty());
        assert_eq!(delta.updated.len(), 1);
        assert_eq!(delta.updated[0].path, PathBuf::from("a.ysm"));
        assert_eq!(delta.removed, vec![PathBuf::from("b.ysm")]);
    }
}
