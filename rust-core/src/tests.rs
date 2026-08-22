use super::*;
use std::{
    fs,
    path::{Path, PathBuf},
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
    assert_eq!(
        report
            .entries
            .iter()
            .find(|e| e.name == "c.ysm.ban")
            .unwrap()
            .ext,
        ".ysm"
    );
    assert!(report.entries.iter().any(|e| e.name == "a.ysm"));
    // Go 契约（code review P2）：ysm.json 条目重命名为父目录名（root 目录 basename）
    let root_name = root
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(
        report.entries.iter().any(|e| e.name == root_name),
        "ysm.json 条目应重命名为父目录名 {}，实际 {:?}",
        root_name,
        report.entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>()
    );
    assert!(!report.entries.iter().any(|e| e.name == "anim.json"));
    assert!(!report
        .entries
        .iter()
        .any(|e| e.path.starts_with(&banned_dir)));
}

#[test]
fn index_scan_discovers_banned_directories_without_changing_compat_scan() {
    let root = TempRoot::new("index-disabled");
    let banned_dir = root.path().join("ModelA.ban");
    fs::create_dir_all(&banned_dir).unwrap();
    fs::write(banned_dir.join("ysm.json"), b"{}").unwrap();
    assert!(scan_fast(root.path(), &policy()).entries.is_empty());
    let indexed = scan_index(root.path(), &policy());
    assert!(indexed.errors.is_empty(), "{:?}", indexed.errors);
    assert_eq!(indexed.entries.len(), 1);
    assert!(indexed.entries[0].path.starts_with(&banned_dir));
}

#[test]
fn fast_scan_defers_hash_then_parallel_hydration_matches_sha256() {
    let root = TempRoot::new("hash");
    fs::write(root.path().join("hello.ysm"), b"hello").unwrap();
    let mut report = scan_fast(root.path(), &policy());
    assert_eq!(report.entries[0].hash, "");
    assert!(hydrate_hashes(&mut report.entries, &policy()).is_empty());
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
    assert_eq!(report.entries[0].subdir, "SceneModel");
}

#[test]
fn oversized_hashable_file_is_reported_without_hashing() {
    let root = TempRoot::new("limit");
    fs::write(root.path().join("large.ysm"), b"1234").unwrap();
    let mut policy = policy();
    policy.max_hash_bytes = 3;
    let mut report = scan_fast(root.path(), &policy);
    let errors = hydrate_hashes(&mut report.entries, &policy);
    assert_eq!(report.entries[0].hash, "");
    assert_eq!(errors.len(), 1);
}
