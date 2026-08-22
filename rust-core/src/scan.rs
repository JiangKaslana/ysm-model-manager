use crate::{policy::normalize_ext, ModelEntry, ScanError, ScanPolicy, ScanReport};
use jwalk::{rayon::prelude::*, WalkDir};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

/// Compatibility scan matching the existing Go scanner contract.
/// Directories ending in `.ban` are not descended into.
pub fn scan_fast(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    scan_impl(root.as_ref(), policy, false)
}

/// Stateful-index scan used by the new desktop shell.
///
/// Unlike [`scan_fast`], this intentionally descends into `.ban` directories so disabled
/// directory-based models remain discoverable and can be re-enabled after a restart.
pub fn scan_index(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    scan_impl(root.as_ref(), policy, true)
}

fn scan_impl(root: &Path, policy: &ScanPolicy, include_banned_dirs: bool) -> ScanReport {
    let root = root.to_path_buf();
    if root.as_os_str().is_empty() {
        return ScanReport::default();
    }

    let mut errors = Vec::new();
    let mut candidates = Vec::new();
    let walk = WalkDir::new(&root).process_read_dir(move |_, _, _, children| {
        for child in children
            .iter_mut()
            .filter_map(|result| result.as_mut().ok())
        {
            if child.file_type.is_dir()
                && should_skip_dir_name(&child.file_name.to_string_lossy(), include_banned_dirs)
            {
                child.read_children = None;
            }
        }
    });

    for result in walk {
        match result {
            Ok(entry) => {
                if entry.depth() == 0 || entry.file_type().is_dir() {
                    continue;
                }
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                let restored = strip_disable_suffix(&name);
                let ext = extension_of(restored);
                if ext.is_empty() || !policy.supports_ext(&ext) {
                    continue;
                }
                if ext == ".json" && !is_model_json_name(restored) {
                    continue;
                }
                let subdir = first_relative_component(&root, &path)
                    .filter(|name| policy.is_mmd_subdir(name))
                    .unwrap_or_default();
                let rtype = policy.rtype_for_ext(&ext).to_string();
                candidates.push(Candidate {
                    name,
                    path,
                    ext,
                    subdir,
                    rtype,
                });
            }
            Err(err) => errors.push(ScanError {
                path: err.path().unwrap_or(root.as_path()).to_path_buf(),
                message: err.to_string(),
            }),
        }
    }

    let resolved: Vec<Result<ModelEntry, ScanError>> =
        candidates.into_par_iter().map(resolve_metadata).collect();
    let mut entries = Vec::with_capacity(resolved.len());
    for item in resolved {
        match item {
            Ok(entry) => entries.push(entry),
            Err(err) => errors.push(err),
        }
    }
    ScanReport { entries, errors }
}

#[derive(Debug)]
struct Candidate {
    name: String,
    path: PathBuf,
    ext: String,
    subdir: String,
    rtype: String,
}

fn resolve_metadata(candidate: Candidate) -> Result<ModelEntry, ScanError> {
    let metadata = fs::metadata(&candidate.path).map_err(|err| ScanError {
        path: candidate.path.clone(),
        message: format!("metadata failed: {err}"),
    })?;
    Ok(ModelEntry {
        name: candidate.name,
        size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
        path: candidate.path,
        ext: candidate.ext,
        hash: String::new(),
        mod_time_ms: system_time_to_unix_ms(metadata.modified().unwrap_or(UNIX_EPOCH)),
        subdir: candidate.subdir,
        rtype: candidate.rtype,
    })
}

fn system_time_to_unix_ms(time: std::time::SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(err) => -i64::try_from(err.duration().as_millis()).unwrap_or(i64::MAX),
    }
}

fn strip_disable_suffix(name: &str) -> &str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".ban") {
        &name[..name.len() - 4]
    } else if lower.ends_with(".disabled") {
        &name[..name.len() - ".disabled".len()]
    } else {
        name
    }
}

/// `.json` 文件名白名单：ysm.json（新格式声明）+
/// 旧格式几何约定（main/arm/arrow/info，含 .geo.json 变体）。
/// 对齐 Go 端 `types.IsYsmEntryJSON` + `isLegacyGeometryName` 双口径。
fn is_model_json_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.eq_ignore_ascii_case("ysm.json") {
        return true;
    }
    const LEGACY_BASES: &[&str] = &["main", "arm", "arrow", "info"];
    for base in LEGACY_BASES {
        if lower == format!("{base}.json") || lower == format!("{base}.geo.json") {
            return true;
        }
    }
    false
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_ext)
        .unwrap_or_default()
}

fn should_skip_dir_name(name: &str, include_banned_dirs: bool) -> bool {
    name.eq_ignore_ascii_case(".recycle")
        || name == ".github"
        || (!include_banned_dirs && name.to_ascii_lowercase().ends_with(".ban"))
}

fn first_relative_component(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    relative.components().find_map(|component| match component {
        Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
        _ => None,
    })
}
