use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use ysm_model_manager_core::{ModelEntry, ScanError, ScanPolicy};
use ysm_model_manager_index::{IndexDelta, IndexSnapshot, ModelIndex};

struct AppState {
    policy: ScanPolicy,
    index: Mutex<ModelIndex>,
    root: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryDto {
    name: String,
    size: i64,
    path: String,
    ext: String,
    hash: String,
    mod_time_ms: i64,
    subdir: String,
    disabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorDto {
    path: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshotDto {
    revision: u64,
    root: String,
    entries: Vec<EntryDto>,
    errors: Vec<ErrorDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaSummary {
    revision: u64,
    added: usize,
    updated: usize,
    removed: usize,
    errors: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshPayload {
    snapshot: LibrarySnapshotDto,
    delta: DeltaSummary,
}

#[tauri::command]
fn scan_library(root: String, state: State<'_, AppState>) -> Result<RefreshPayload, String> {
    let root = normalize_root(&root)?;
    let payload = refresh_at(&root, &state)?;
    *state.root.lock().map_err(lock_error)? = Some(root);
    Ok(payload)
}

#[tauri::command]
fn refresh_library(state: State<'_, AppState>) -> Result<RefreshPayload, String> {
    let root = state
        .root
        .lock()
        .map_err(lock_error)?
        .clone()
        .ok_or_else(|| "尚未选择模型库目录".to_string())?;
    refresh_at(&root, &state)
}

#[tauri::command]
fn library_snapshot(state: State<'_, AppState>) -> Result<LibrarySnapshotDto, String> {
    let root = state.root.lock().map_err(lock_error)?.clone();
    let snapshot = state.index.lock().map_err(lock_error)?.snapshot();
    Ok(snapshot_dto(snapshot, root.as_deref()))
}

fn refresh_at(root: &Path, state: &AppState) -> Result<RefreshPayload, String> {
    let mut index = state.index.lock().map_err(lock_error)?;
    let delta = index.refresh(root, &state.policy);
    let snapshot = index.snapshot();
    Ok(RefreshPayload {
        snapshot: snapshot_dto(snapshot, Some(root)),
        delta: delta_summary(&delta),
    })
}

fn normalize_root(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("模型库路径不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(format!("目录不存在或不可读：{}", path.display()));
    }
    Ok(path)
}

fn snapshot_dto(snapshot: IndexSnapshot, root: Option<&Path>) -> LibrarySnapshotDto {
    LibrarySnapshotDto {
        revision: snapshot.revision,
        root: root.map(display_path).unwrap_or_default(),
        entries: snapshot.entries.into_iter().map(entry_dto).collect(),
        errors: snapshot.errors.into_iter().map(error_dto).collect(),
    }
}

fn delta_summary(delta: &IndexDelta) -> DeltaSummary {
    DeltaSummary {
        revision: delta.revision,
        added: delta.added.len(),
        updated: delta.updated.len(),
        removed: delta.removed.len(),
        errors: delta.errors.len(),
    }
}

fn entry_dto(entry: ModelEntry) -> EntryDto {
    let lower = entry.name.to_ascii_lowercase();
    EntryDto {
        name: entry.name,
        size: entry.size,
        path: display_path(&entry.path),
        ext: entry.ext,
        hash: entry.hash,
        mod_time_ms: entry.mod_time_ms,
        subdir: entry.subdir,
        disabled: lower.ends_with(".ban") || lower.ends_with(".disabled"),
    }
}

fn error_dto(error: ScanError) -> ErrorDto {
    ErrorDto {
        path: display_path(&error.path),
        message: error.message,
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "内部状态锁已损坏，请重启应用".to_string()
}

fn main() {
    let policy = ScanPolicy::from_registry_json(include_str!("../../../resource_types.json"))
        .expect("embedded resource_types.json must be valid");

    tauri::Builder::default()
        .manage(AppState {
            policy,
            index: Mutex::new(ModelIndex::new()),
            root: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            scan_library,
            refresh_library,
            library_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YSM Model Manager Next");
}
