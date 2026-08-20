use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

use ysm_model_manager_core::{scan_fast, ModelEntry, ScanError, ScanPolicy, ScanReport};

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

    pub fn refresh(&mut self, root: impl AsRef<Path>, policy: &ScanPolicy) -> IndexDelta {
        self.apply_report(scan_fast(root, policy))
    }

    /// Apply a batch of filesystem event paths without rescanning the whole library.
    ///
    /// Regular file events only rescan the file's containing directory and then keep the exact
    /// path from that small report. A directory-level event falls back to a full refresh because
    /// a directory create/move can change an arbitrary number of descendants at once.
    pub fn apply_paths(
        &mut self,
        root: &Path,
        policy: &ScanPolicy,
        paths: &[PathBuf],
    ) -> IndexDelta {
        let mut unique_paths = HashSet::with_capacity(paths.len());
        let mut pending = HashMap::<PathBuf, Option<ModelEntry>>::new();
        let mut errors = Vec::new();

        for path in paths {
            if !unique_paths.insert(path.clone()) || !path.starts_with(root) {
                continue;
            }

            if path.is_dir() {
                return self.refresh(root, policy);
            }

            if path.exists() {
                let (entry, mut path_errors) = inspect_file(root, path, policy);
                errors.append(&mut path_errors);
                pending.insert(path.clone(), entry);
            } else {
                pending.insert(path.clone(), None);
            }
        }

        let mut added = Vec::new();
        let mut updated = Vec::new();
        let mut removed = HashSet::new();

        for (path, next_entry) in pending {
            match next_entry {
                Some(mut entry) => match self.entries.get(&entry.path) {
                    Some(previous) if metadata_equal(previous, &entry) => {
                        entry.hash.clone_from(&previous.hash);
                        self.entries.insert(entry.path.clone(), entry);
                    }
                    Some(_) => {
                        updated.push(entry.clone());
                        self.entries.insert(entry.path.clone(), entry);
                    }
                    None => {
                        added.push(entry.clone());
                        self.entries.insert(entry.path.clone(), entry);
                    }
                },
                None => {
                    let to_remove: Vec<PathBuf> = self
                        .entries
                        .keys()
                        .filter(|existing| *existing == &path || existing.starts_with(&path))
                        .cloned()
                        .collect();
                    for existing in to_remove {
                        self.entries.remove(&existing);
                        removed.insert(existing);
                    }
                }
            }
        }

        added.sort_by(|a, b| a.path.cmp(&b.path));
        updated.sort_by(|a, b| a.path.cmp(&b.path));
        let mut removed: Vec<PathBuf> = removed.into_iter().collect();
        removed.sort();

        if !added.is_empty() || !updated.is_empty() || !removed.is_empty() {
            self.revision = self.revision.saturating_add(1);
        }

        self.errors = errors.clone();

        IndexDelta {
            revision: self.revision,
            added,
            updated,
            removed,
            errors,
        }
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

fn inspect_file(
    root: &Path,
    path: &Path,
    policy: &ScanPolicy,
) -> (Option<ModelEntry>, Vec<ScanError>) {
    if path_is_ignored(root, path) || !path.is_file() {
        return (None, Vec::new());
    }

    let parent = path.parent().unwrap_or(root);
    let report = scan_fast(parent, policy);
    let mut entry = report.entries.into_iter().find(|entry| entry.path == path);
    if let Some(entry) = entry.as_mut() {
        entry.subdir = mmd_subdir(root, path);
    }
    (entry, report.errors)
}

fn path_is_ignored(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };

    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        if components.peek().is_none() {
            break;
        }
        if let Component::Normal(name) = component {
            let name = name.to_string_lossy();
            if name.eq_ignore_ascii_case(".recycle")
                || name == ".github"
                || name.to_ascii_lowercase().ends_with(".ban")
            {
                return true;
            }
        }
    }
    false
}

fn mmd_subdir(root: &Path, path: &Path) -> String {
    let Ok(relative) = path.strip_prefix(root) else {
        return String::new();
    };

    for component in relative.components() {
        let Component::Normal(name) = component else {
            continue;
        };
        let name = name.to_string_lossy();
        if let Some(canonical) = MMD_SUBDIRS
            .iter()
            .find(|candidate| candidate.eq_ignore_ascii_case(&name))
        {
            return (*canonical).to_string();
        }
    }
    String::new()
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
    use std::{
        fs, process,
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
                "ysm-rust-index-{label}-{}-{timestamp}-{nonce}",
                process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
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
                {"id":"mmd","extensions":[".pmx"],"hashable":true}
              ]
            }"#,
        )
        .unwrap()
    }

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

    #[test]
    fn file_event_updates_only_the_touched_entry() {
        let temp = TempRoot::new("file-event");
        let a = temp.0.join("a.ysm");
        let b = temp.0.join("b.ysm");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"bbbb").unwrap();

        let policy = policy();
        let mut index = ModelIndex::new();
        index.refresh(&temp.0, &policy);
        let initial_revision = index.revision();

        fs::write(&a, b"aaaaaa").unwrap();
        let delta = index.apply_paths(&temp.0, &policy, std::slice::from_ref(&a));

        assert_eq!(delta.revision, initial_revision + 1);
        assert_eq!(delta.updated.len(), 1);
        assert_eq!(delta.updated[0].path, a);
        assert!(delta.added.is_empty());
        assert!(delta.removed.is_empty());
        assert_eq!(index.len(), 2);
    }

    #[test]
    fn removal_event_drops_a_missing_path_without_full_refresh() {
        let temp = TempRoot::new("remove-event");
        let a = temp.0.join("a.ysm");
        let b = temp.0.join("b.ysm");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();

        let policy = policy();
        let mut index = ModelIndex::new();
        index.refresh(&temp.0, &policy);
        fs::remove_file(&a).unwrap();

        let delta = index.apply_paths(&temp.0, &policy, std::slice::from_ref(&a));
        assert_eq!(delta.removed, vec![a]);
        assert_eq!(index.len(), 1);
        assert_eq!(index.snapshot().entries[0].path, b);
    }

    #[test]
    fn localized_scan_restores_mmd_subdir_from_library_root() {
        let temp = TempRoot::new("mmd-subdir");
        let dir = temp.0.join("mmd").join("EntityPlayer");
        fs::create_dir_all(&dir).unwrap();
        let model = dir.join("hero.pmx");
        fs::write(&model, b"pmx").unwrap();

        let policy = policy();
        let mut index = ModelIndex::new();
        let delta = index.apply_paths(&temp.0, &policy, std::slice::from_ref(&model));
        assert_eq!(delta.added.len(), 1);
        assert_eq!(delta.added[0].subdir, "EntityPlayer");
    }
}
