use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use ysm_model_manager_core::{
    hydrate_hashes as hydrate_entry_hashes, ModelEntry, ScanError, ScanPolicy,
};
use ysm_model_manager_index::{IndexDelta, IndexSnapshot, ModelIndex};

struct AppState {
    policy: ScanPolicy,
    index: Mutex<ModelIndex>,
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorDto {
    path: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshotDto {
    revision: u64,
    root: String,
    entries: Vec<EntryDto>,
    errors: Vec<ErrorDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaSummary {
    revision: u64,
    added: usize,
    updated: usize,
    removed: usize,
    errors: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshPayload {
    snapshot: LibrarySnapshotDto,
    delta: DeltaSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryDeltaDto {
    revision: u64,
    added: Vec<EntryDto>,
    updated: Vec<EntryDto>,
    removed: Vec<String>,
    errors: Vec<ErrorDto>,
}

#[tauri::command]
fn scan_library(
    root: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RefreshPayload, String> {
    let root = normalize_root(&root)?;
    let payload = refresh_at(&root, &state)?;
    *state.root.lock().map_err(lock_error)? = Some(root.clone());
    restart_watcher(&app, &root, &state)?;
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

#[tauri::command]
fn hydrate_hashes(
    paths: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    if paths.is_empty() {
        return Ok(0);
    }

    let requested: HashSet<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let candidates: Vec<ModelEntry> = state
        .index
        .lock()
        .map_err(lock_error)?
        .snapshot()
        .entries
        .into_iter()
        .filter(|entry| requested.contains(&entry.path) && entry.hash.is_empty())
        .collect();
    let count = candidates.len();
    if count == 0 {
        return Ok(0);
    }

    let policy = state.policy.clone();
    std::thread::spawn(move || {
        let mut hydrated = candidates;
        let errors = hydrate_entry_hashes(&mut hydrated, &policy);
        let state = app.state::<AppState>();

        let (revision, applied) = {
            let mut index = match state.index.lock() {
                Ok(index) => index,
                Err(_) => return,
            };
            let current: HashMap<PathBuf, ModelEntry> = index
                .snapshot()
                .entries
                .into_iter()
                .map(|entry| (entry.path.clone(), entry))
                .collect();
            let mut applied = Vec::new();

            for entry in hydrated {
                let still_current = current
                    .get(&entry.path)
                    .is_some_and(|latest| metadata_equal(latest, &entry));
                if still_current && !entry.hash.is_empty() {
                    index.replace_entry(entry.clone());
                    applied.push(entry);
                }
            }
            (index.revision(), applied)
        };

        if applied.is_empty() && errors.is_empty() {
            return;
        }

        let payload = LibraryDeltaDto {
            revision,
            added: Vec::new(),
            updated: applied.into_iter().map(entry_dto).collect(),
            removed: Vec::new(),
            errors: errors.into_iter().map(error_dto).collect(),
        };
        let _ = app.emit("library-delta", payload);
    });

    Ok(count)
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

fn restart_watcher(app: &AppHandle, root: &Path, state: &AppState) -> Result<(), String> {
    let app_for_events = app.clone();
    let mut watcher = notify::recommended_watcher(move |result| {
        handle_fs_event(&app_for_events, result);
    })
    .map_err(|error| format!("无法启动模型库监听：{error}"))?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("无法监听模型库目录 {}：{error}", root.display()))?;

    *state.watcher.lock().map_err(lock_error)? = Some(watcher);
    Ok(())
}

fn handle_fs_event(app: &AppHandle, result: notify::Result<Event>) {
    let event = match result {
        Ok(event) => event,
        Err(error) => {
            let _ = app.emit("library-watch-error", error.to_string());
            return;
        }
    };

    if matches!(event.kind, EventKind::Access(_)) || event.paths.is_empty() {
        return;
    }

    let state = app.state::<AppState>();
    let root = match state.root.lock() {
        Ok(root) => root.clone(),
        Err(_) => return,
    };
    let Some(root) = root else {
        return;
    };

    let delta = match state.index.lock() {
        Ok(mut index) => index.apply_paths(&root, &state.policy, &event.paths),
        Err(_) => return,
    };

    if delta.added.is_empty()
        && delta.updated.is_empty()
        && delta.removed.is_empty()
        && delta.errors.is_empty()
    {
        return;
    }

    let _ = app.emit("library-delta", delta_dto(delta));
}

fn normalize_root(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("模型库路径不能为空".to_string());
    }

    let path = PathBuf::from(trimmed);
    let path = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| format!("无法解析当前目录：{error}"))?
            .join(path)
    };

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

fn delta_dto(delta: IndexDelta) -> LibraryDeltaDto {
    LibraryDeltaDto {
        revision: delta.revision,
        added: delta.added.into_iter().map(entry_dto).collect(),
        updated: delta.updated.into_iter().map(entry_dto).collect(),
        removed: delta
            .removed
            .into_iter()
            .map(|path| display_path(&path))
            .collect(),
        errors: delta.errors.into_iter().map(error_dto).collect(),
    }
}

fn metadata_equal(a: &ModelEntry, b: &ModelEntry) -> bool {
    a.name == b.name
        && a.size == b.size
        && a.ext == b.ext
        && a.mod_time_ms == b.mod_time_ms
        && a.subdir == b.subdir
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
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            scan_library,
            refresh_library,
            library_snapshot,
            hydrate_hashes
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YSM Model Manager Next");
}
