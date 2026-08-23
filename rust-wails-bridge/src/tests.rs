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
    // Go types.ModelEntry 契约：ModTime = Unix 毫秒（Go 侧注释锁定单位），
    // 与当前时钟对拍 ±5s——只断言 >0 锁不住秒/毫秒漂移
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let mod_time = entry["ModTime"].as_i64().unwrap();
    assert!(
        (mod_time - now_ms).abs() < 5_000,
        "ModTime {mod_time} 偏离当前毫秒时钟 {now_ms} 超过 5s（疑似秒/毫秒单位漂移）"
    );
    // Path 字段：绝对路径且指向该文件
    let path = entry["Path"].as_str().unwrap();
    assert!(
        std::path::Path::new(path).is_absolute() && path.ends_with("hero.ysm"),
        "Path 应为指向 hero.ysm 的绝对路径，实际 {path}"
    );
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
fn missing_root_reports_scan_error_and_stays_uncacheable() {
    // 锁定「合法 registry + 不可读 root」的行为：errors 数组承载错误（非顶层 error）、
    // entries 空、cacheable=false——Go rustbridge.Scan 据此透传，行为漂移即双端断裂
    let missing = std::env::temp_dir()
        .join(format!("ysm-missing-root-{}", std::process::id()))
        .join("no-such-dir");
    let value = serde_json::to_value(scan_json(missing.to_str().unwrap(), registry())).unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    assert!(value["error"].is_null());
    let err = &value["errors"].as_array().unwrap()[0];
    assert!(
        err["message"].as_str().unwrap().contains("not readable"),
        "应报 not readable，实际 {}",
        err["message"]
    );
    assert_eq!(value["cacheable"], false);
}

#[test]
fn file_root_is_reported_not_a_directory() {
    // root 是文件而非目录：独立于「不可读」的错误分支（fs::metadata Ok 但 !is_dir）
    let root = TempRoot::new();
    let file = root.0.join("plain-file.txt");
    fs::write(&file, b"x").unwrap();
    let value = serde_json::to_value(scan_json(file.to_str().unwrap(), registry())).unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    let err = &value["errors"].as_array().unwrap()[0];
    assert!(err["message"].as_str().unwrap().contains("not a directory"));
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
