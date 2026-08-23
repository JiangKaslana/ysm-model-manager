use super::*;
use crate::response::scan_json;
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process, ptr, slice,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);
struct TempRoot(PathBuf);

impl TempRoot {
    fn new() -> Self {
        let nonce = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ysm-wails-bridge-{}-{stamp}-{nonce}",
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

fn registry() -> &'static str {
    r#"{"resourceTypes":[{"id":"ysm","extensions":[".ysm",".json"],"hashable":true}]}"#
}

#[test]
fn response_preserves_wails_model_entry_contract() {
    let root = TempRoot::new();
    fs::write(root.0.join("hero.ysm"), b"hero").unwrap();
    fs::write(root.0.join("animation.json"), b"{}").unwrap();
    let value = serde_json::to_value(scan_json(root.0.to_str().unwrap(), registry())).unwrap();
    let entry = &value["entries"].as_array().unwrap()[0];
    assert_eq!(entry["Name"], "hero.ysm");
    assert_eq!(entry["Size"], 4);
    assert_eq!(entry["Ext"], ".ysm");
    assert!(entry["ModTime"].as_i64().unwrap() > 0);
    assert_eq!(entry["HasTags"], false);
    assert_eq!(entry["Hash"].as_str().unwrap().len(), 64);
    assert!(entry.get("subdir").is_none());
}

#[test]
fn response_uses_parent_directory_name_for_ysm_json() {
    let root = TempRoot::new();
    let model_dir = root.0.join("official-winefox");
    fs::create_dir_all(&model_dir).unwrap();
    fs::write(model_dir.join("ysm.json"), b"{}").unwrap();

    let value = serde_json::to_value(scan_json(root.0.to_str().unwrap(), registry())).unwrap();
    let entries = value["entries"].as_array().unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["Name"], "official-winefox");
    assert_eq!(entries[0]["Size"], 2);
    assert!(entries[0]["ModTime"].as_i64().unwrap() > 0);
    assert_eq!(entries[0]["Hash"].as_str().unwrap().len(), 64);
}

#[test]
fn invalid_registry_is_fatal_without_panicking() {
    let value = serde_json::to_value(scan_json("C:/models", "not-json")).unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    assert!(value["error"]
        .as_str()
        .unwrap()
        .contains("invalid resource registry"));
}

#[test]
fn c_abi_buffer_can_be_released() {
    let root = TempRoot::new();
    fs::write(root.0.join("hero.ysm"), b"hero").unwrap();
    let root_text = root.0.to_string_lossy();
    let mut buffer = YsmBuffer {
        ptr: ptr::null_mut(),
        len: 0,
        cap: 0,
    };
    let status = unsafe {
        ysm_scan_json(
            root_text.as_ptr(),
            root_text.len(),
            registry().as_ptr(),
            registry().len(),
            &mut buffer,
        )
    };
    assert_eq!(status, 0);
    let json = unsafe { slice::from_raw_parts(buffer.ptr, buffer.len) };
    let value: Value = serde_json::from_slice(json).unwrap();
    assert_eq!(value["entries"].as_array().unwrap().len(), 1);
    unsafe { ysm_buffer_free(buffer.ptr, buffer.len, buffer.cap) };
}
