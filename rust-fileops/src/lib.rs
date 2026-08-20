use std::{
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
};

const BAN_SUFFIX: &str = ".ban";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToggleOutcome {
    pub enabled: bool,
    pub before: PathBuf,
    pub after: PathBuf,
}

#[derive(Debug)]
pub enum FileOpError {
    EmptyPath,
    RootOperation,
    OutsideRoot(PathBuf),
    TargetExists(PathBuf),
    Io(std::io::Error),
}

impl fmt::Display for FileOpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPath => write!(f, "参数为空"),
            Self::RootOperation => write!(f, "不能对资源根目录执行启用/禁用操作"),
            Self::OutsideRoot(path) => write!(f, "拒绝操作仓库外路径: {}", path.display()),
            Self::TargetExists(path) => write!(f, "目标已存在: {}", path.display()),
            Self::Io(error) => error.fmt(f),
        }
    }
}

impl Error for FileOpError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for FileOpError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn is_banned(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return false;
    }
    if has_ban_suffix(path) {
        return true;
    }
    path.parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(BAN_SUFFIX))
}

pub fn toggle_model_enable(
    root: impl AsRef<Path>,
    path: impl AsRef<Path>,
) -> Result<ToggleOutcome, FileOpError> {
    let root = root.as_ref();
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return Err(FileOpError::EmptyPath);
    }

    let source = guard_source(root, path)?;

    let parent = source.parent().unwrap_or(root);
    if parent
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(BAN_SUFFIX))
    {
        return enable_banned_parent(root, &source, parent);
    }

    let mut target_source = source.clone();
    if is_ysm_entry_json(&source) {
        let parent = source.parent().unwrap_or(root);
        if root.as_os_str().is_empty() || is_strictly_inside(root, parent)? {
            target_source = parent.to_path_buf();
        }
    }

    if has_ban_suffix(&target_source) {
        let target = strip_ban_suffix(&target_source);
        ensure_target_absent(&target)?;
        fs::rename(&target_source, &target)?;
        Ok(ToggleOutcome {
            enabled: true,
            before: target_source,
            after: target,
        })
    } else {
        let target = append_ban_suffix(&target_source);
        ensure_target_absent(&target)?;
        fs::rename(&target_source, &target)?;
        Ok(ToggleOutcome {
            enabled: false,
            before: target_source,
            after: target,
        })
    }
}

fn enable_banned_parent(
    root: &Path,
    source: &Path,
    banned_parent: &Path,
) -> Result<ToggleOutcome, FileOpError> {
    if !root.as_os_str().is_empty() && same_path(root, banned_parent)? {
        return Err(FileOpError::RootOperation);
    }

    if has_ban_suffix(source) {
        let file_target = strip_ban_suffix(source);
        ensure_target_absent(&file_target)?;
        fs::rename(source, file_target)?;
    }

    let dir_target = strip_ban_suffix(banned_parent);
    ensure_target_absent(&dir_target)?;
    fs::rename(banned_parent, &dir_target)?;
    Ok(ToggleOutcome {
        enabled: true,
        before: banned_parent.to_path_buf(),
        after: dir_target,
    })
}

fn guard_source(root: &Path, path: &Path) -> Result<PathBuf, FileOpError> {
    let source = fs::canonicalize(path)?;
    if root.as_os_str().is_empty() {
        return Ok(source);
    }

    let root = fs::canonicalize(root)?;
    if path_eq(&source, &root) {
        return Err(FileOpError::RootOperation);
    }
    if !path_starts_with(&source, &root) {
        return Err(FileOpError::OutsideRoot(path.to_path_buf()));
    }
    Ok(source)
}

fn is_strictly_inside(root: &Path, path: &Path) -> Result<bool, FileOpError> {
    let root = fs::canonicalize(root)?;
    let path = fs::canonicalize(path)?;
    Ok(!path_eq(&path, &root) && path_starts_with(&path, &root))
}

fn same_path(a: &Path, b: &Path) -> Result<bool, FileOpError> {
    Ok(path_eq(&fs::canonicalize(a)?, &fs::canonicalize(b)?))
}

#[cfg(windows)]
fn path_eq(a: &Path, b: &Path) -> bool {
    a.to_string_lossy()
        .eq_ignore_ascii_case(&b.to_string_lossy())
}

#[cfg(not(windows))]
fn path_eq(a: &Path, b: &Path) -> bool {
    a == b
}

#[cfg(windows)]
fn path_starts_with(path: &Path, root: &Path) -> bool {
    let path = path.to_string_lossy().to_ascii_lowercase();
    let root = root.to_string_lossy().to_ascii_lowercase();
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|tail| tail.starts_with(['\\', '/']))
}

#[cfg(not(windows))]
fn path_starts_with(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn is_ysm_entry_json(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(strip_ban_suffix_str)
        .is_some_and(|name| name.eq_ignore_ascii_case("ysm.json"))
}

fn has_ban_suffix(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(BAN_SUFFIX))
}

fn strip_ban_suffix(path: &Path) -> PathBuf {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return path.to_path_buf();
    };
    let stripped = strip_ban_suffix_str(name);
    path.with_file_name(stripped)
}

fn strip_ban_suffix_str(name: &str) -> &str {
    if name.to_ascii_lowercase().ends_with(BAN_SUFFIX) {
        &name[..name.len() - BAN_SUFFIX.len()]
    } else {
        name
    }
}

fn append_ban_suffix(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{name}{BAN_SUFFIX}"))
}

fn ensure_target_absent(path: &Path) -> Result<(), FileOpError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(FileOpError::TargetExists(path.to_path_buf())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(FileOpError::Io(error)),
    }
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
                "ysm-rust-fileops-{label}-{}-{timestamp}-{nonce}",
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
    fn rejects_empty_and_root_paths() {
        let temp = TempRoot::new("root-guard");
        assert!(matches!(
            toggle_model_enable(&temp.0, Path::new("")),
            Err(FileOpError::EmptyPath)
        ));
        assert!(matches!(
            toggle_model_enable(&temp.0, &temp.0),
            Err(FileOpError::RootOperation)
        ));
    }

    #[test]
    fn rejects_path_outside_root() {
        let root = TempRoot::new("inside");
        let outside = TempRoot::new("outside");
        let model = outside.0.join("x.ysm");
        fs::write(&model, b"x").unwrap();
        assert!(matches!(
            toggle_model_enable(&root.0, &model),
            Err(FileOpError::OutsideRoot(_))
        ));
        assert!(model.exists());
        assert!(!append_ban_suffix(&model).exists());
    }

    #[test]
    fn toggles_regular_file_and_reports_final_paths() {
        let root = TempRoot::new("regular");
        let model = root.0.join("hero.ysm");
        fs::write(&model, b"x").unwrap();

        let disabled = toggle_model_enable(&root.0, &model).unwrap();
        assert!(!disabled.enabled);
        assert!(!disabled.before.exists());
        assert!(disabled.after.exists());
        assert!(is_banned(&disabled.after));

        let enabled = toggle_model_enable(&root.0, &disabled.after).unwrap();
        assert!(enabled.enabled);
        assert_eq!(enabled.after.file_name().unwrap(), "hero.ysm");
        assert!(enabled.after.exists());
    }

    #[test]
    fn ysm_json_toggles_the_whole_model_directory() {
        let root = TempRoot::new("ysm-dir");
        let model_dir = root.0.join("ModelA");
        fs::create_dir_all(&model_dir).unwrap();
        let ysm = model_dir.join("ysm.json");
        let texture = model_dir.join("texture.png");
        fs::write(&ysm, b"{}").unwrap();
        fs::write(&texture, b"png").unwrap();

        let disabled = toggle_model_enable(&root.0, &ysm).unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.after.file_name().unwrap(), "ModelA.ban");
        assert!(disabled.after.join("ysm.json").exists());
        assert!(disabled.after.join("texture.png").exists());

        let enabled = toggle_model_enable(&root.0, disabled.after.join("ysm.json")).unwrap();
        assert!(enabled.enabled);
        assert_eq!(enabled.after.file_name().unwrap(), "ModelA");
        assert!(enabled.after.join("ysm.json").exists());
    }

    #[test]
    fn root_level_ysm_json_falls_back_to_file_toggle() {
        let root = TempRoot::new("root-ysm");
        let ysm = root.0.join("ysm.json");
        fs::write(&ysm, b"{}").unwrap();

        let disabled = toggle_model_enable(&root.0, &ysm).unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.after.file_name().unwrap(), "ysm.json.ban");
        assert!(root.0.exists());

        let enabled = toggle_model_enable(&root.0, &disabled.after).unwrap();
        assert!(enabled.enabled);
        assert_eq!(enabled.after, ysm.canonicalize().unwrap_or(ysm));
    }

    #[test]
    fn banned_parent_with_file_residue_restores_both() {
        let root = TempRoot::new("double-ban");
        let banned_dir = root.0.join("ModelA.ban");
        fs::create_dir_all(&banned_dir).unwrap();
        let residue = banned_dir.join("loose.ysm.ban");
        fs::write(&residue, b"x").unwrap();

        let outcome = toggle_model_enable(&root.0, &residue).unwrap();
        assert!(outcome.enabled);
        assert!(root.0.join("ModelA").join("loose.ysm").exists());
        assert!(!banned_dir.exists());
    }

    #[test]
    fn target_collisions_are_rejected_without_overwrite() {
        let root = TempRoot::new("collision");
        let model = root.0.join("m.ysm");
        let banned = root.0.join("m.ysm.ban");
        fs::write(&model, b"original").unwrap();
        fs::write(&banned, b"blocked").unwrap();

        assert!(matches!(
            toggle_model_enable(&root.0, &model),
            Err(FileOpError::TargetExists(_))
        ));
        assert_eq!(fs::read(&model).unwrap(), b"original");
        assert_eq!(fs::read(&banned).unwrap(), b"blocked");
    }

    #[test]
    fn banned_root_is_never_restored_as_a_group() {
        let base = TempRoot::new("ban-root");
        let root = base.0.join("ModelA.ban");
        fs::create_dir_all(&root).unwrap();
        let ysm = root.join("ysm.json");
        fs::write(&ysm, b"{}").unwrap();

        assert!(matches!(
            toggle_model_enable(&root, &ysm),
            Err(FileOpError::RootOperation)
        ));
        assert!(root.exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_that_escapes_root() {
        use std::os::unix::fs::symlink;

        let root = TempRoot::new("symlink-root");
        let outside = TempRoot::new("symlink-outside");
        let external = outside.0.join("external.ysm");
        fs::write(&external, b"x").unwrap();
        let link = root.0.join("link.ysm");
        symlink(&external, &link).unwrap();

        assert!(matches!(
            toggle_model_enable(&root.0, &link),
            Err(FileOpError::OutsideRoot(_))
        ));
        assert!(external.exists());
    }
}
