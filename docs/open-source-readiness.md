# Open Source Readiness

Last updated: 2026-06-17

Target fork: `JiangKaslana/ysm-model-manager`

## Current Release Shape

This snapshot is ready to be prepared as a source release after validation. It includes:

- Refined desktop UI for repository, model management, preview, and settings pages.
- Custom theme color support.
- Explicit/on-demand model preview.
- Folder-only lightweight rendering: folders must show an icon or selected cover image and must not enter model parsing or 3D rendering.
- Folder cover selection support.
- AI organize settings using an OpenAI-compatible endpoint.
- Custom download mirror configuration for generic HTTPS proxy and GitHub URL templates.
- OpenYSM-inspired preview migration work, including action roulette, animation playback controls, texture slot selection, shape/config controls, and switchable vehicle/projectile preview entries.

## Not Source-Controlled

Do not commit these to the repository:

- `build/bin/` and other release binaries.
- `frontend/dist/`.
- `frontend/node_modules/` or any `node_modules/`.
- `.vite/`, `.vs/`, `.continue/`, `Users/`.
- Local model packs, screenshots, caches, temporary archives, and generated `.exe` files.

Release binaries should be uploaded as GitHub Releases assets.

## Validation Commands

Run these from the project root before tagging or opening a PR:

```powershell
cd frontend
npm run build
cd ..
go test ./...
wails build
```

Expected result:

- Vite production build passes.
- Go tests pass.
- Wails production build passes and writes `build/bin/YSM-Model-Manager.exe`.

The existing Vite large chunk warning is acceptable unless it becomes a hard build failure.

## Known Rendering Limits

The OpenYSM rendering migration is not complete yet. Keep this clear in release notes and PR descriptions.

- Player/Steve skeleton binding is still incomplete.
- Vehicle/attachment mounting semantics are still approximate.
- Full OpenYSM bone matrix order and native pose behavior are still pending.
- Molang runtime and animation controller behavior only cover the current preview subset.
- Some complex models may still need follow-up work for shape switching, layered textures, alpha handling, visible bounds, and preview framing.

## PR Notes

When opening a PR upstream, state the guardrails explicitly:

- Model preview remains user-triggered.
- Folder entries never parse or render models.
- Folder custom cover behavior is preserved.
- AI organize/OpenAI-compatible settings are preserved.
- Rendering changes are staged and documented; this is not a full OpenYSM renderer replacement.

Suggested PR checklist:

- [ ] `npm run build`
- [ ] `go test ./...`
- [ ] `wails build`
- [ ] Manual check: folder click does not start 2D/3D preview.
- [ ] Manual check: model preview opens only after explicit preview action.
- [ ] Manual check: settings page saves custom mirror configuration.
