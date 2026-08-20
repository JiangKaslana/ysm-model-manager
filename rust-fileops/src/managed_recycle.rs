use super::{
    is_strictly_inside, is_ysm_entry_json, path_eq, path_starts_with, prepare_recycle_root,
    FileOpError,
};
use std::{
    error::Error,
    ffi::{OsStr, OsString},
    fmt, fs, io,
    path::{Component, Path, PathBuf},
    process,
    sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const ITEMS_DIR: &str = ".items";
const META_FILE: &str = "origin.meta";
const PAYLOAD_NAME: &str = "payload";
const META_VERSION: &str = "v1";

static NEXT_ID: AtomicU64 = AtomicU64::new(0);
static OP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRecycleOutcome {
    pub before: PathBuf,
    pub stored_path: PathBuf,
    pub id: String,
    pub original_relative: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreOutcome {
    pub id: String,
    pub before: PathBuf,
    pub after: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRecycleEntry {
    pub id: String,
    pub original_relative: PathBuf,
    pub stored_path: PathBuf,
    pub deleted_at_ms: u128,
    pub size: u64,
    pub is_dir: bool,
    pub restorable: bool,
}

#[derive(Debug)]
pub enum ManagedRecycleError {
    EmptyPath,
    RootRequired,
    RootOperation,
    AlreadyRecycled(PathBuf),
    InvalidId,
    InvalidMetadata(PathBuf),
    UnsafePath(PathBuf),
    UnsafeItemsRoot(PathBuf),
    TargetExists(PathBuf),
    LockPoisoned,
    Base(FileOpError),
    Io(io::Error),
}

impl fmt::Display for ManagedRecycleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPath => write!(f, "参数为空"),
            Self::RootRequired => write!(f, "该操作需要资源根目录"),
            Self::RootOperation => write!(f, "不能对资源根目录执行此操作"),
            Self::AlreadyRecycled(path) => write!(f, "资源已经位于回收区: {}", path.display()),
            Self::InvalidId => write!(f, "回收项 ID 非法"),
            Self::InvalidMetadata(path) => write!(f, "回收项元数据损坏: {}", path.display()),
            Self::UnsafePath(path) => write!(f, "路径不安全: {}", path.display()),
            Self::UnsafeItemsRoot(path) => write!(f, "回收区索引目录不安全: {}", path.display()),
            Self::TargetExists(path) => write!(f, "恢复目标已存在: {}", path.display()),
            Self::LockPoisoned => write!(f, "文件操作锁已损坏，请重启应用"),
            Self::Base(error) => error.fmt(f),
            Self::Io(error) => error.fmt(f),
        }
    }
}

impl Error for ManagedRecycleError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Base(error) => Some(error),
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<FileOpError> for ManagedRecycleError {
    fn from(value: FileOpError) -> Self {
        Self::Base(value)
    }
}

impl From<io::Error> for ManagedRecycleError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn move_to_managed_recycle(
    root: impl AsRef<Path>,
    path: impl AsRef<Path>,
) -> Result<ManagedRecycleOutcome, ManagedRecycleError> {
    let _guard = op_lock()?;
    let root = root.as_ref();
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return Err(ManagedRecycleError::EmptyPath);
    }
    if root.as_os_str().is_empty() {
        return Err(ManagedRecycleError::RootRequired);
    }

    let root = fs::canonicalize(root)?;
    reject_symlink_source(path)?;
    let source = super::guard_source(&root, path)?;
    let recycle_root = prepare_recycle_root(&root)?;
    if path_starts_with(&source, &recycle_root) {
        return Err(ManagedRecycleError::AlreadyRecycled(source));
    }

    let mut movable = source;
    if is_ysm_entry_json(&movable) {
        let parent = movable.parent().unwrap_or(&root);
        if is_strictly_inside(&root, parent)? {
            movable = parent.to_path_buf();
        }
    }
    if path_eq(&movable, &root) {
        return Err(ManagedRecycleError::RootOperation);
    }

    let relative = movable
        .strip_prefix(&root)
        .map_err(|_| ManagedRecycleError::UnsafePath(movable.clone()))?
        .to_path_buf();
    validate_relative(&relative)?;

    let items_root = prepare_items_root(&recycle_root)?;
    let (id, container) = create_container(&items_root)?;
    let payload = container.join(PAYLOAD_NAME);
    let deleted_at_ms = now_ms();
    let meta = encode_metadata(&relative, deleted_at_ms);

    if let Err(error) = fs::write(container.join(META_FILE), meta) {
        let _ = fs::remove_dir_all(&container);
        return Err(error.into());
    }
    if let Err(error) = fs::rename(&movable, &payload) {
        let _ = fs::remove_dir_all(&container);
        return Err(error.into());
    }

    Ok(ManagedRecycleOutcome {
        before: movable,
        stored_path: payload,
        id,
        original_relative: relative,
    })
}

pub fn list_recycle(
    root: impl AsRef<Path>,
) -> Result<Vec<ManagedRecycleEntry>, ManagedRecycleError> {
    let root = root.as_ref();
    if root.as_os_str().is_empty() {
        return Err(ManagedRecycleError::RootRequired);
    }
    let root = fs::canonicalize(root)?;
    let recycle_root = match existing_recycle_root(&root)? {
        Some(path) => path,
        None => return Ok(Vec::new()),
    };

    let mut entries = Vec::new();
    if let Some(items_root) = existing_items_root(&recycle_root)? {
        for child in fs::read_dir(&items_root)? {
            let child = child?;
            let path = child.path();
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }
            if let Ok(entry) = read_managed_entry(&path) {
                entries.push(entry);
            }
        }
    }

    // Development builds before managed recycle stored payloads directly in `.recycle`.
    // Surface those entries for visibility, but never guess an original path for automatic restore.
    for child in fs::read_dir(&recycle_root)? {
        let child = child?;
        if child.file_name() == OsStr::new(ITEMS_DIR) {
            continue;
        }
        let path = child.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        entries.push(ManagedRecycleEntry {
            id: format!("legacy:{}", child.file_name().to_string_lossy()),
            original_relative: PathBuf::from(child.file_name()),
            stored_path: path.clone(),
            deleted_at_ms: metadata
                .modified()
                .ok()
                .and_then(system_time_ms)
                .unwrap_or(0),
            size: tree_size(&path)?,
            is_dir: metadata.is_dir(),
            restorable: false,
        });
    }

    entries.sort_by(|a, b| {
        b.deleted_at_ms
            .cmp(&a.deleted_at_ms)
            .then_with(|| a.original_relative.cmp(&b.original_relative))
    });
    Ok(entries)
}

pub fn restore_recycled(
    root: impl AsRef<Path>,
    id: &str,
) -> Result<RestoreOutcome, ManagedRecycleError> {
    let _guard = op_lock()?;
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-') {
        return Err(ManagedRecycleError::InvalidId);
    }

    let root = root.as_ref();
    if root.as_os_str().is_empty() {
        return Err(ManagedRecycleError::RootRequired);
    }
    let root = fs::canonicalize(root)?;
    let recycle_root = existing_recycle_root(&root)?
        .ok_or_else(|| ManagedRecycleError::InvalidMetadata(root.join(".recycle")))?;
    let items_root = existing_items_root(&recycle_root)?
        .ok_or_else(|| ManagedRecycleError::InvalidMetadata(recycle_root.join(ITEMS_DIR)))?;
    let container = items_root.join(id);
    let container_meta = fs::symlink_metadata(&container)
        .map_err(|_| ManagedRecycleError::InvalidMetadata(container.clone()))?;
    if container_meta.file_type().is_symlink() || !container_meta.is_dir() {
        return Err(ManagedRecycleError::UnsafePath(container));
    }
    let canonical_container = fs::canonicalize(&container)?;
    if !path_starts_with(&canonical_container, &items_root) || path_eq(&canonical_container, &items_root)
    {
        return Err(ManagedRecycleError::UnsafePath(container));
    }

    let entry = read_managed_entry(&container)?;
    let target = root.join(&entry.original_relative);
    validate_relative(&entry.original_relative)?;
    prepare_restore_parent(&root, target.parent().unwrap_or(&root))?;
    ensure_absent(&target)?;

    let payload = entry.stored_path;
    fs::rename(&payload, &target)?;
    let _ = fs::remove_file(container.join(META_FILE));
    fs::remove_dir(&container)?;

    Ok(RestoreOutcome {
        id: id.to_string(),
        before: payload,
        after: target,
    })
}

fn read_managed_entry(container: &Path) -> Result<ManagedRecycleEntry, ManagedRecycleError> {
    let id = container
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or(ManagedRecycleError::InvalidId)?
        .to_string();
    let meta_path = container.join(META_FILE);
    let payload = container.join(PAYLOAD_NAME);
    let text = fs::read_to_string(&meta_path)?;
    let (relative, deleted_at_ms) = decode_metadata(&text)
        .ok_or_else(|| ManagedRecycleError::InvalidMetadata(meta_path.clone()))?;
    validate_relative(&relative)?;

    let payload_meta = fs::symlink_metadata(&payload)
        .map_err(|_| ManagedRecycleError::InvalidMetadata(payload.clone()))?;
    if payload_meta.file_type().is_symlink() {
        return Err(ManagedRecycleError::UnsafePath(payload));
    }

    Ok(ManagedRecycleEntry {
        id,
        original_relative: relative,
        stored_path: payload.clone(),
        deleted_at_ms,
        size: tree_size(&payload)?,
        is_dir: payload_meta.is_dir(),
        restorable: true,
    })
}

fn prepare_items_root(recycle_root: &Path) -> Result<PathBuf, ManagedRecycleError> {
    let items = recycle_root.join(ITEMS_DIR);
    match fs::symlink_metadata(&items) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ManagedRecycleError::UnsafeItemsRoot(items));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(&items)?,
        Err(error) => return Err(error.into()),
    }
    let canonical = fs::canonicalize(&items)?;
    if !path_starts_with(&canonical, recycle_root) || path_eq(&canonical, recycle_root) {
        return Err(ManagedRecycleError::UnsafeItemsRoot(items));
    }
    Ok(canonical)
}

fn existing_recycle_root(root: &Path) -> Result<Option<PathBuf>, ManagedRecycleError> {
    let recycle = root.join(".recycle");
    match fs::symlink_metadata(&recycle) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ManagedRecycleError::UnsafePath(recycle));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let canonical = fs::canonicalize(&recycle)?;
    if !path_starts_with(&canonical, root) || path_eq(&canonical, root) {
        return Err(ManagedRecycleError::UnsafePath(recycle));
    }
    Ok(Some(canonical))
}

fn existing_items_root(recycle_root: &Path) -> Result<Option<PathBuf>, ManagedRecycleError> {
    let items = recycle_root.join(ITEMS_DIR);
    match fs::symlink_metadata(&items) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ManagedRecycleError::UnsafeItemsRoot(items));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let canonical = fs::canonicalize(&items)?;
    if !path_starts_with(&canonical, recycle_root) || path_eq(&canonical, recycle_root) {
        return Err(ManagedRecycleError::UnsafeItemsRoot(items));
    }
    Ok(Some(canonical))
}

fn create_container(items_root: &Path) -> Result<(String, PathBuf), ManagedRecycleError> {
    for _ in 0..128 {
        let id = new_id();
        let container = items_root.join(&id);
        match fs::create_dir(&container) {
            Ok(()) => return Ok((id, container)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(ManagedRecycleError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "无法分配唯一回收项 ID",
    )))
}

fn new_id() -> String {
    let nonce = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("{:032x}-{:x}-{:x}", now_ns(), process::id(), nonce)
}

fn encode_metadata(relative: &Path, deleted_at_ms: u128) -> String {
    format!(
        "{META_VERSION}\n{deleted_at_ms}\n{}\n",
        encode_os(relative.as_os_str())
    )
}

fn decode_metadata(text: &str) -> Option<(PathBuf, u128)> {
    let mut lines = text.lines();
    if lines.next()? != META_VERSION {
        return None;
    }
    let deleted_at_ms = lines.next()?.parse().ok()?;
    let encoded = lines.next()?;
    if lines.next().is_some() {
        return None;
    }
    Some((PathBuf::from(decode_os(encoded)?), deleted_at_ms))
}

#[cfg(unix)]
fn encode_os(value: &OsStr) -> String {
    use std::os::unix::ffi::OsStrExt;
    hex_encode(value.as_bytes())
}

#[cfg(unix)]
fn decode_os(value: &str) -> Option<OsString> {
    use std::os::unix::ffi::OsStringExt;
    Some(OsString::from_vec(hex_decode(value)?))
}

#[cfg(windows)]
fn encode_os(value: &OsStr) -> String {
    use std::os::windows::ffi::OsStrExt;
    let mut bytes = Vec::new();
    for unit in value.encode_wide() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    hex_encode(&bytes)
}

#[cfg(windows)]
fn decode_os(value: &str) -> Option<OsString> {
    use std::os::windows::ffi::OsStringExt;
    let bytes = hex_decode(value)?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let wide: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    Some(OsString::from_wide(&wide))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| Some((hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?))
        .collect()
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn validate_relative(path: &Path) -> Result<(), ManagedRecycleError> {
    if path.as_os_str().is_empty() {
        return Err(ManagedRecycleError::UnsafePath(path.to_path_buf()));
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(ManagedRecycleError::UnsafePath(path.to_path_buf()));
        }
    }
    Ok(())
}

fn prepare_restore_parent(root: &Path, parent: &Path) -> Result<(), ManagedRecycleError> {
    let relative = parent
        .strip_prefix(root)
        .map_err(|_| ManagedRecycleError::UnsafePath(parent.to_path_buf()))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(ManagedRecycleError::UnsafePath(parent.to_path_buf()));
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(ManagedRecycleError::UnsafePath(current));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(&current)?,
            Err(error) => return Err(error.into()),
        }
        let canonical = fs::canonicalize(&current)?;
        if !path_starts_with(&canonical, root) {
            return Err(ManagedRecycleError::UnsafePath(current));
        }
    }
    Ok(())
}

fn reject_symlink_source(path: &Path) -> Result<(), ManagedRecycleError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(ManagedRecycleError::UnsafePath(path.to_path_buf()));
    }
    Ok(())
}

fn ensure_absent(path: &Path) -> Result<(), ManagedRecycleError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(ManagedRecycleError::TargetExists(path.to_path_buf())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn tree_size(path: &Path) -> Result<u64, ManagedRecycleError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok(0);
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for child in fs::read_dir(path)? {
        total = total.saturating_add(tree_size(&child?.path())?);
    }
    Ok(total)
}

fn op_lock() -> Result<std::sync::MutexGuard<'static, ()>, ManagedRecycleError> {
    OP_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| ManagedRecycleError::LockPoisoned)
}

fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn system_time_ms(time: SystemTime) -> Option<u128> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let nonce = TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "ysm-managed-recycle-{label}-{}-{stamp}-{nonce}",
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

    #[test]
    fn managed_move_preserves_nested_original_path_and_lists_it() {
        let root = TempRoot::new("nested");
        let dir = root.0.join("packs").join("a");
        fs::create_dir_all(&dir).unwrap();
        let model = dir.join("hero.ysm");
        fs::write(&model, b"hero").unwrap();

        let moved = move_to_managed_recycle(&root.0, &model).unwrap();
        assert_eq!(moved.original_relative, PathBuf::from("packs/a/hero.ysm"));
        assert!(!model.exists());
        assert!(moved.stored_path.exists());

        let entries = list_recycle(&root.0).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, moved.id);
        assert_eq!(entries[0].original_relative, moved.original_relative);
        assert_eq!(entries[0].size, 4);
        assert!(entries[0].restorable);
    }

    #[test]
    fn managed_ysm_json_moves_and_restores_whole_directory() {
        let root = TempRoot::new("ysm-dir");
        let model_dir = root.0.join("models").join("ModelA");
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("ysm.json"), b"{}").unwrap();
        fs::write(model_dir.join("texture.png"), b"png").unwrap();

        let moved = move_to_managed_recycle(&root.0, model_dir.join("ysm.json")).unwrap();
        assert_eq!(moved.original_relative, PathBuf::from("models/ModelA"));
        assert!(!model_dir.exists());

        let restored = restore_recycled(&root.0, &moved.id).unwrap();
        assert_eq!(restored.after, model_dir);
        assert!(restored.after.join("ysm.json").exists());
        assert!(restored.after.join("texture.png").exists());
        assert!(list_recycle(&root.0).unwrap().is_empty());
    }

    #[test]
    fn duplicate_deleted_paths_get_distinct_ids_without_overwrite() {
        let root = TempRoot::new("duplicate");
        let model = root.0.join("hero.ysm");
        fs::write(&model, b"first").unwrap();
        let first = move_to_managed_recycle(&root.0, &model).unwrap();
        fs::write(&model, b"second").unwrap();
        let second = move_to_managed_recycle(&root.0, &model).unwrap();

        assert_ne!(first.id, second.id);
        assert_eq!(list_recycle(&root.0).unwrap().len(), 2);
    }

    #[test]
    fn restore_recreates_nested_parent_directories() {
        let root = TempRoot::new("restore-parent");
        let nested = root.0.join("one").join("two");
        fs::create_dir_all(&nested).unwrap();
        let model = nested.join("hero.ysm");
        fs::write(&model, b"x").unwrap();
        let moved = move_to_managed_recycle(&root.0, &model).unwrap();
        fs::remove_dir_all(root.0.join("one")).unwrap();

        let restored = restore_recycled(&root.0, &moved.id).unwrap();
        assert_eq!(restored.after, root.0.join("one/two/hero.ysm"));
        assert!(restored.after.exists());
    }

    #[test]
    fn restore_collision_is_rejected_without_losing_recycled_payload() {
        let root = TempRoot::new("restore-collision");
        let model = root.0.join("hero.ysm");
        fs::write(&model, b"old").unwrap();
        let moved = move_to_managed_recycle(&root.0, &model).unwrap();
        fs::write(&model, b"new").unwrap();

        assert!(matches!(
            restore_recycled(&root.0, &moved.id),
            Err(ManagedRecycleError::TargetExists(_))
        ));
        assert_eq!(fs::read(&model).unwrap(), b"new");
        assert!(moved.stored_path.exists());
    }

    #[test]
    fn legacy_flat_entries_are_visible_but_not_auto_restored() {
        let root = TempRoot::new("legacy");
        let recycle = root.0.join(".recycle");
        fs::create_dir(&recycle).unwrap();
        fs::write(recycle.join("legacy.ysm"), b"legacy").unwrap();

        let entries = list_recycle(&root.0).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].restorable);
        assert!(entries[0].id.starts_with("legacy:"));
    }

    #[test]
    fn restore_rejects_invalid_ids() {
        let root = TempRoot::new("bad-id");
        assert!(matches!(
            restore_recycled(&root.0, "../escape"),
            Err(ManagedRecycleError::InvalidId)
        ));
    }

    #[test]
    fn unicode_relative_path_round_trips() {
        let root = TempRoot::new("unicode");
        let dir = root.0.join("角色");
        fs::create_dir(&dir).unwrap();
        let model = dir.join("琪亚娜.ysm");
        fs::write(&model, b"x").unwrap();
        let moved = move_to_managed_recycle(&root.0, &model).unwrap();
        assert_eq!(moved.original_relative, PathBuf::from("角色/琪亚娜.ysm"));
        let restored = restore_recycled(&root.0, &moved.id).unwrap();
        assert!(restored.after.exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_items_root_is_rejected() {
        use std::os::unix::fs::symlink;

        let root = TempRoot::new("items-symlink");
        let outside = TempRoot::new("items-outside");
        let recycle = root.0.join(".recycle");
        fs::create_dir(&recycle).unwrap();
        symlink(&outside.0, recycle.join(ITEMS_DIR)).unwrap();
        let model = root.0.join("hero.ysm");
        fs::write(&model, b"x").unwrap();

        assert!(matches!(
            move_to_managed_recycle(&root.0, &model),
            Err(ManagedRecycleError::UnsafeItemsRoot(_))
        ));
        assert!(model.exists());
    }
}
