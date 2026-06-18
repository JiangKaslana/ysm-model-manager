# OpenYSM Rendering Migration Status

Last updated: 2026-06-17

## Completed In This Refactor Pass

### Static Geometry

- Added Go-side OpenYSM-style baked geometry output in `go/threejs/openysm_baked.go`.
- Preserved Bedrock cube `inflate` and `mirror` through parsing.
- Emits baked mesh groups per bone and texture bucket instead of relying on one rotated cube mesh per cube.
- Keeps the existing Wails/Three.js preview entry point, so model preview remains explicit and on demand.

### Texture, UV, And Layers

- Added `texIdx` and `renderMode` to the 3D spec mesh payload.
- Parses per-face texture indices from face UV JSON.
- Groups baked mesh output by texture index.
- Frontend now maps render modes to cutout, overlay, and translucent material behavior.

### Bone Pose And Animation Preview

- Static bone rotation now uses OpenYSM/Gecko-style ZYX order.
- 3D animation playback now sends local bone transforms to the Three.js hierarchy, matching OpenYSM's per-bone pose-buffer model more closely.
- Static rotation and sampled animation rotation are combined as Euler values before generating the local ZYX quaternion, instead of multiplying bind and animation quaternions separately.
- The 3D renderer now owns an explicit OpenYSM-style 12-float pose buffer ordered by the baked spec bone list:
  - 0..2 rotation, signed radians
  - 3..5 position
  - 6..8 scale
  - 9 hidden
  - 10 hide children
  - 11 track transform
- Existing `setBoneTransforms()` calls are converted into that pose buffer before being applied to Three.js groups.
- The renderer also exposes `setPoseBuffer()` and `getPoseBuffer()` for the later controller/Molang migration.
- Animation JSON parsing now supports direct channel values, `vector`, `pre`/`post`, `linear`, `step`, and basic `catmullrom`.
- Loop parsing now recognizes OpenYSM/Gecko loop types:
  - `loop`
  - `play_once`
  - `hold_on_last_frame`
- `hold_on_last_frame` keeps the final pose instead of resetting to bind pose.

### Preview UI And Camera

- 3D preview top bar now has:
  - background mode selector: OpenYSM, Studio, Plain
  - texture slot selector
  - action selector
  - play, stop, speed, and timeline controls
  - camera mode and speed controls
- Added an OpenYSM-style action roulette panel for preview actions and nested groups.
- Added shape/config controls derived from OpenYSM config metadata.
- Added variant switching so preview can render one selected model form instead of stacking all forms.
- Added switchable preview entries for OpenYSM vehicles and projectiles.
- Added basic OpenYSM control/query variables for preview playback, including `ctrl.*`, `c.*`, `ysm.*`, `q.is_on_ground`, and animation-finished flags.
- 3D preview defaults to an OpenYSM-like dark studio background.
- Camera framing now uses the actual rendered `Box3` bounds of the model root, then places the floor/grid near the model bottom.

## Validation

The following have passed after the latest completed stage:

```powershell
cd frontend
npm run build
cd ..
go test ./...
wails build
```

Latest build output:

- Frontend Vite production build: passed
- Go tests: passed
- Wails production build: passed
- Generated executable: `build/bin/YSM-Model-Manager.exe`

Vite still reports the existing large chunk warning for the WASM/data bundle. This is not a new failure.

## Guardrails Still Preserved

- Folder entries are not sent to model parsing or 3D rendering.
- 3D rendering still only starts from the explicit preview action.
- Folder icon/cover behavior remains separate from model preview.
- AI organize settings and OpenAI-compatible behavior were not touched in this rendering pass.
- The OpenYSM reference package was only read in targeted source-code paths; resource/model/media directories were not scanned.
- Unencrypted folder-style YSM models are included in the preview pipeline through the same explicit preview path.

## Remaining Rendering Gaps

These are not finished yet and should be migrated in separate, validated stages:

- Full matrix-backed application of the OpenYSM-style pose buffer.
- Matrix application that exactly mirrors OpenYSM:
  `T(pivot + animation position) -> Rz -> Ry -> Rx -> Scale -> T(-pivot)`.
- Hidden and children-hidden flags from pose buffer indices 9 and 10.
- `track transform` flag at pose buffer index 11.
- Full Molang runtime and animation controller semantics.
- OpenYSM render-layer logic for preview animation, extra animation buttons, and controller-selected animations.
- Full player/Steve skeleton binding used by some YSM models.
- Complete attachment, vehicle mount, held item, and projectile transform semantics.
- Exact form switching for every model that encodes shape state through roulette/config variables.
- More exact translucent texture detection from model metadata instead of heuristic material modes.
- Glow/outline/light behavior.
- Visible bounds, width/height scale, and preview-rotation-disable metadata.

## Recommended Next Stage

Next code stage should be the exact OpenYSM matrix and player-state bridge:

1. Keep the current action/variant UI stable.
2. Implement OpenYSM's exact matrix formula behind a feature boundary.
3. Add player skeleton binding and attachment state only after matrix parity is validated.
4. Validate one rendering layer at a time: static geometry, UV/texture layers, bone pose, animation/controller state, then camera/framing.

Do not combine player binding, Molang/controller migration, and UV fixes in one patch. That would make visual regressions hard to isolate.
