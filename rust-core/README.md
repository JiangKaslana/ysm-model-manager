# Rust Core Spike

This directory is an isolated Rust experiment for `ysm-model-manager`. It does **not** replace the Wails/Go app yet.

## Why this exists

The current scanner combines recursive discovery, metadata reads, conditional SHA-256 hashing, and cache population in one request path. That preserves simple semantics, but it makes first-render latency scale with work that the UI does not need immediately.

This spike separates the work into two phases:

1. `scan_fast` — parallel directory walking + parallel metadata resolution, returning list-ready entries with an empty hash.
2. `hydrate_hashes` — parallel SHA-256 only for extensions marked `hashable` in the existing root `resource_types.json`.

The existing registry stays the single source of truth for supported/hashable extensions. The Rust code intentionally does not own a second extension table.

## Compatibility contract covered by tests

- `.recycle` is skipped case-insensitively.
- `.github` is skipped.
- directories ending in `.ban` are skipped.
- file suffixes `.ban` / `.disabled` restore the original extension for filtering.
- `.json` only admits `ysm.json`.
- SHA-256 output is compatible with the current Go scanner.
- the 500 MiB hash ceiling remains the default.
- first-level MMD grouping names are preserved.

The next migration step should add the current cache invalidation semantics and a bridge adapter that serializes the Rust entry shape exactly like Go `types.ModelEntry`.

## Run

From the repository root:

```bash
cargo test --manifest-path rust-core/Cargo.toml
cargo run --release --manifest-path rust-core/Cargo.toml --bin ysm-scan-bench -- /path/to/model/root
cargo run --release --manifest-path rust-core/Cargo.toml --bin ysm-scan-bench -- /path/to/model/root --eager-hash
```

Run the second and third commands on the same model tree to see how much first-list latency is currently being spent on hashes.

## What this spike deliberately does not do

- no Tauri shell yet;
- no replacement of the current Go cache;
- no destructive write/import/sync operations;
- no UI rewrite in this directory.

Those should follow only after the scanner contract and benchmark are green. This keeps the rewrite reversible instead of creating a second half-working application.
