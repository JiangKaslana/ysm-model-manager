use std::{
    env,
    path::{Path, PathBuf},
    process,
    time::Instant,
};

use ysm_model_manager_core::{hydrate_hashes, scan_fast, ScanPolicy};

fn main() {
    let mut args = env::args().skip(1);
    let Some(root) = args.next() else {
        print_usage_and_exit();
    };

    let mut registry: Option<PathBuf> = None;
    let mut eager_hash = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--registry" => {
                let Some(path) = args.next() else {
                    eprintln!("--registry requires a path");
                    process::exit(2);
                };
                registry = Some(PathBuf::from(path));
            }
            "--eager-hash" => eager_hash = true,
            _ => {
                eprintln!("unknown argument: {arg}");
                print_usage_and_exit();
            }
        }
    }

    let registry = registry.unwrap_or_else(default_registry_path);
    let policy = ScanPolicy::from_registry_path(&registry).unwrap_or_else(|err| {
        eprintln!("failed to load registry {}: {err}", registry.display());
        process::exit(1);
    });

    let started = Instant::now();
    let mut report = scan_fast(&root, &policy);
    let discovery_elapsed = started.elapsed();

    let hash_elapsed = if eager_hash {
        let hash_started = Instant::now();
        report.errors.extend(hydrate_hashes(&mut report.entries, &policy));
        Some(hash_started.elapsed())
    } else {
        None
    };

    let bytes: i64 = report.entries.iter().map(|entry| entry.size.max(0)).sum();
    let hashed = report.entries.iter().filter(|entry| !entry.hash.is_empty()).count();

    println!("root={root}");
    println!("registry={}", registry.display());
    println!("entries={}", report.entries.len());
    println!("bytes={bytes}");
    println!("discovery_ms={:.3}", discovery_elapsed.as_secs_f64() * 1000.0);
    println!("hashed={hashed}");
    if let Some(elapsed) = hash_elapsed {
        println!("hash_ms={:.3}", elapsed.as_secs_f64() * 1000.0);
    } else {
        println!("hash_ms=deferred");
    }
    println!("errors={}", report.errors.len());

    for error in report.errors.iter().take(10) {
        eprintln!("{}: {}", error.path.display(), error.message);
    }
}

fn default_registry_path() -> PathBuf {
    let cwd_registry = Path::new("resource_types.json");
    if cwd_registry.exists() {
        return cwd_registry.to_path_buf();
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resource_types.json")
}

fn print_usage_and_exit() -> ! {
    eprintln!(
        "usage: cargo run --manifest-path rust-core/Cargo.toml --bin ysm-scan-bench -- <root> [--registry <resource_types.json>] [--eager-hash]"
    );
    process::exit(2);
}
