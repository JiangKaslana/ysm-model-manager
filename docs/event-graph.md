# Bus 事件契约报告

> **自动生成** — 由 `scripts/event-graph.mjs` 生成。
> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方。

## ⚠️ 异常摘要

### 孤儿发射（emit 了但无 on/once 订阅方）

- `import:history-changed` — emit×3
- `theme:change` — emit×1
- `config:updated` — emit×4
- `morph:apply` — emit×1
- `stage:load` — emit×1
- `sync:download:missing` — emit×1

### 鬼订阅（有 on/once 但从未被 emit）

- `batch:enable` — on×1
- `batch:disable` — on×1

## 事件总览

| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 | 状态 |
|------|--------|--------|-----------|--------|------|
| `avatar:refresh` | 1 | 1 | 0 | 0 | ✅ |
| `batch:disable` | 0 | 1 | 0 | 0 | 👻 鬼订阅 |
| `batch:disable-all` | 1 | 1 | 0 | 0 | ✅ |
| `batch:enable` | 0 | 1 | 0 | 0 | 👻 鬼订阅 |
| `batch:enable-all` | 1 | 1 | 0 | 0 | ✅ |
| `batch:rename` | 1 | 1 | 0 | 0 | ✅ |
| `config:updated` | 4 | 0 | 0 | 0 | 🔇 孤儿发射 |
| `ctx:show` | 4 | 1 | 0 | 0 | ✅ |
| `dir:batch-rename` | 1 | 1 | 0 | 0 | ✅ |
| `dir:mkdir` | 1 | 1 | 0 | 0 | ✅ |
| `dir:recycle` | 1 | 1 | 0 | 0 | ✅ |
| `dir:rename` | 1 | 1 | 0 | 0 | ✅ |
| `import:history-changed` | 3 | 0 | 0 | 0 | 🔇 孤儿发射 |
| `instance:clear` | 1 | 1 | 0 | 0 | ✅ |
| `instance:export-list` | 1 | 1 | 0 | 0 | ✅ |
| `lang:changed` | 2 | 2 | 0 | 0 | ✅ |
| `menu:show` | 2 | 1 | 0 | 0 | ✅ |
| `model:select` | 8 | 1 | 0 | 0 | ✅ |
| `morph:apply` | 1 | 0 | 0 | 0 | 🔇 孤儿发射 |
| `nav:changed` | 7 | 3 | 0 | 0 | ✅ |
| `package:selected` | 2 | 1 | 0 | 0 | ✅ |
| `repo:rtype-changed` | 3 | 6 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stage:load` | 1 | 0 | 0 | 0 | 🔇 孤儿发射 |
| `stats:refresh` | 21 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 0 | 0 | 0 | 🔇 孤儿发射 |
| `sync:toggle:status` | 3 | 1 | 0 | 0 | ✅ |
| `theme:change` | 1 | 0 | 0 | 0 | 🔇 孤儿发射 |
| `toast:show` | 203 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 11 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/community/download-queue-store.ts` | 261 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-workshop.ts` | 132 |

### `batch:disable`

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 31 |

### `batch:disable-all`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 212 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 29 |

### `batch:enable`

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 30 |

### `batch:enable-all`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 211 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 28 |

### `batch:rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 107 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 36 |

### `config:updated`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/settings/path-cards.ts` | 77 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 273 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 301 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 355 |

### `ctx:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 126 |
| `frontend/src/views/app-tree/events.ts` | 303 |
| `frontend/src/views/app-tree/events.ts` | 327 |
| `frontend/src/views/app-tree/events.ts` | 338 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 79 |

### `dir:batch-rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 13 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 35 |

### `dir:mkdir`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 50 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 33 |

### `dir:recycle`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 51 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 34 |

### `dir:rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 32 |

### `import:history-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/import-executor.ts` | 44 |
| `frontend/src/features/import-executor.ts` | 52 |
| `frontend/src/features/import-executor.ts` | 58 |

### `instance:clear`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 101 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 101 |

### `instance:export-list`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 96 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 14 |

### `lang:changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/i18n/locale.ts` | 82 |
| `frontend/src/core/i18n/locale.ts` | 128 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 112 |
| `frontend/src/views/app-nav/index.ts` | 151 |

### `menu:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 80 |
| `frontend/src/features/community/events.ts` | 180 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/context-menu/index.ts` | 25 |

### `model:select`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/oldest-models.ts` | 51 |
| `frontend/src/features/recycle-bin.ts` | 109 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 346 |
| `frontend/src/views/app-preview/detail-3d.ts` | 227 |
| `frontend/src/views/app-preview/detail-3d.ts` | 295 |
| `frontend/src/views/app-tree/events.ts` | 158 |
| `frontend/src/views/app-tree/events.ts` | 269 |
| `frontend/src/views/app-tree/index.ts` | 406 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/index.ts` | 111 |

### `morph:apply`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/detail-3d.ts` | 240 |

### `nav:changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 106 |
| `frontend/src/views/app-content/index.ts` | 178 |
| `frontend/src/views/app-content/site/events.ts` | 201 |
| `frontend/src/views/app-nav/index.ts` | 20 |
| `frontend/src/views/app-nav/index.ts` | 161 |
| `frontend/src/views/app-sidebar/events.ts` | 202 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 115 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/page-store.ts` | 55 |
| `frontend/src/views/app-content/index.ts` | 97 |
| `frontend/src/views/app-nav/index.ts` | 137 |

### `package:selected`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 88 |
| `frontend/src/views/app-sidebar/events.ts` | 187 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-pages.ts` | 37 |

### `repo:rtype-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/settings/init.ts` | 346 |
| `frontend/src/views/app-content/settings/init.ts` | 370 |
| `frontend/src/views/app-nav/index.ts` | 81 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/repo-rtype.ts` | 23 |
| `frontend/src/views/app-content/init-pages.ts` | 74 |
| `frontend/src/views/app-content/init-pages.ts` | 183 |
| `frontend/src/views/app-nav/index.ts` | 153 |
| `frontend/src/views/app-sidebar/index.ts` | 399 |
| `frontend/src/views/app-sync-manager/index.ts` | 171 |

### `repo:search-creator`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/site/events.ts` | 169 |
| `frontend/src/views/app-content/site/events.ts` | 310 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 104 |

### `repo:subdir-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-nav/index.ts` | 82 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sync-manager/index.ts` | 194 |

### `stage:load`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/detail-3d.ts` | 306 |

### `stats:refresh`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 17 |
| `frontend/src/core/handlers/android-events.ts` | 65 |
| `frontend/src/core/handlers/instance-ops.ts` | 157 |
| `frontend/src/core/handlers/sync.ts` | 102 |
| `frontend/src/core/handlers/sync.ts` | 211 |
| `frontend/src/features/community/download-queue.ts` | 110 |
| `frontend/src/features/import-executor.ts` | 68 |
| `frontend/src/features/import-executor.ts` | 256 |
| `frontend/src/features/recycle-bin.ts` | 79 |
| `frontend/src/features/recycle-bin.ts` | 192 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 391 |
| `frontend/src/views/app-content/settings/init.ts` | 198 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 78 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 356 |
| `frontend/src/views/app-sidebar/index.ts` | 288 |
| `frontend/src/views/app-sync-manager/index.ts` | 217 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 76 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 145 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 196 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 233 |
| `frontend/src/views/app-tree/events.ts` | 118 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 391 |
| `frontend/src/views/app-sync-manager/index.ts` | 151 |

### `sync:download:done`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 23 |
| `frontend/src/core/handlers/sync.ts` | 119 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 196 |
| `frontend/src/views/app-sidebar/index.ts` | 223 |

### `sync:download:missing`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 215 |

### `sync:toggle:status`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 328 |
| `frontend/src/views/app-tree/events.ts` | 116 |
| `frontend/src/views/app-tree/events.ts` | 460 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 131 |

### `theme:change`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/theme-core.ts` | 34 |

### `toast:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/app-modules.ts` | 72 |
| `frontend/src/app-modules.ts` | 82 |
| `frontend/src/app-modules.ts` | 92 |
| `frontend/src/app-modules.ts` | 123 |
| `frontend/src/core/context-menu-shared.ts` | 22 |
| `frontend/src/core/context-menu-shared.ts` | 48 |
| `frontend/src/core/context-menu-shared.ts` | 58 |
| `frontend/src/core/handlers/android-events.ts` | 24 |
| `frontend/src/core/handlers/android-events.ts` | 41 |
| `frontend/src/core/handlers/instance-ops.ts` | 28 |
| `frontend/src/core/handlers/instance-ops.ts` | 35 |
| `frontend/src/core/handlers/instance-ops.ts` | 74 |
| `frontend/src/core/handlers/instance-ops.ts` | 84 |
| `frontend/src/core/handlers/instance-ops.ts` | 90 |
| `frontend/src/core/handlers/instance-ops.ts` | 114 |
| `frontend/src/core/handlers/instance-ops.ts` | 124 |
| `frontend/src/core/handlers/instance-ops.ts` | 132 |
| `frontend/src/core/handlers/instance-ops.ts` | 148 |
| `frontend/src/core/handlers/instance-ops.ts` | 158 |
| `frontend/src/core/handlers/instance-ops.ts` | 164 |
| `frontend/src/core/handlers/instance-ops.ts` | 171 |
| `frontend/src/core/handlers/require-mcroot.ts` | 13 |
| `frontend/src/core/handlers/sync.ts` | 51 |
| `frontend/src/core/handlers/sync.ts` | 103 |
| `frontend/src/core/handlers/sync.ts` | 112 |
| `frontend/src/core/handlers/sync.ts` | 135 |
| `frontend/src/core/handlers/sync.ts` | 161 |
| `frontend/src/core/handlers/sync.ts` | 170 |
| `frontend/src/core/handlers/sync.ts` | 204 |
| `frontend/src/core/handlers/sync.ts` | 227 |
| `frontend/src/features/community/download-queue.ts` | 268 |
| `frontend/src/features/community/download-queue.ts` | 294 |
| `frontend/src/features/community/events.ts` | 125 |
| `frontend/src/features/community/events.ts` | 137 |
| `frontend/src/features/community/events.ts` | 206 |
| `frontend/src/features/community/events.ts` | 258 |
| `frontend/src/features/community/events.ts` | 295 |
| `frontend/src/features/import-dnd.ts` | 41 |
| `frontend/src/features/import-dnd.ts` | 59 |
| `frontend/src/features/import-dnd.ts` | 98 |
| `frontend/src/features/import-dnd.ts` | 111 |
| `frontend/src/features/import-dnd.ts` | 125 |
| `frontend/src/features/import-dnd.ts` | 204 |
| `frontend/src/features/import-executor.ts` | 63 |
| `frontend/src/features/import-executor.ts` | 247 |
| `frontend/src/features/import-executor.ts` | 260 |
| `frontend/src/features/recycle-bin.ts` | 73 |
| `frontend/src/features/recycle-bin.ts` | 82 |
| `frontend/src/features/recycle-bin.ts` | 194 |
| `frontend/src/features/recycle-bin.ts` | 202 |
| `frontend/src/features/version-updater.ts` | 147 |
| `frontend/src/features/version-updater.ts` | 156 |
| `frontend/src/features/version-updater.ts` | 179 |
| `frontend/src/features/version-updater.ts` | 188 |
| `frontend/src/features/version-updater.ts` | 209 |
| `frontend/src/features/version-updater.ts` | 243 |
| `frontend/src/features/version-updater.ts` | 253 |
| `frontend/src/utils/3d/adapters/mount-preview-core.ts` | 383 |
| `frontend/src/utils/3d/adapters/mount-preview-core.ts` | 976 |
| `frontend/src/utils/3d/adapters/switch-preview.ts` | 97 |
| `frontend/src/utils/3d/adapters/switch-preview.ts` | 166 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 96 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 281 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 298 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 322 |
| `frontend/src/utils/dom/directory-picker.ts` | 23 |
| `frontend/src/utils/dom/directory-picker.ts` | 34 |
| `frontend/src/utils/dom/directory-picker.ts` | 46 |
| `frontend/src/utils/module-loader.ts` | 12 |
| `frontend/src/views/app-content/diagnostics/conflicts.ts` | 21 |
| `frontend/src/views/app-content/diagnostics/conflicts.ts` | 136 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 32 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 43 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 51 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 73 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 92 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 109 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 125 |
| `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 91 |
| `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 282 |
| `frontend/src/views/app-content/index.ts` | 169 |
| `frontend/src/views/app-content/init-pages.ts` | 199 |
| `frontend/src/views/app-content/init-pages.ts` | 254 |
| `frontend/src/views/app-content/settings/init.ts` | 117 |
| `frontend/src/views/app-content/settings/init.ts` | 149 |
| `frontend/src/views/app-content/settings/init.ts` | 184 |
| `frontend/src/views/app-content/settings/init.ts` | 200 |
| `frontend/src/views/app-content/settings/init.ts` | 207 |
| `frontend/src/views/app-content/settings/init.ts` | 213 |
| `frontend/src/views/app-content/settings/init.ts` | 242 |
| `frontend/src/views/app-content/settings/init.ts` | 296 |
| `frontend/src/views/app-content/settings/keymap.ts` | 103 |
| `frontend/src/views/app-content/settings/keymap.ts` | 114 |
| `frontend/src/views/app-content/settings/keymap.ts` | 135 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 79 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 274 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 280 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 302 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 308 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 330 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 357 |
| `frontend/src/views/app-content/settings/store.ts` | 27 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 117 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 128 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 139 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 151 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 161 |
| `frontend/src/views/app-content/settings/worker-prefs.ts` | 43 |
| `frontend/src/views/app-content/site/drag.ts` | 41 |
| `frontend/src/views/app-content/site/drag.ts` | 78 |
| `frontend/src/views/app-content/site/drag.ts` | 101 |
| `frontend/src/views/app-content/site/drag.ts` | 110 |
| `frontend/src/views/app-content/site/edit.ts` | 114 |
| `frontend/src/views/app-content/site/edit.ts` | 142 |
| `frontend/src/views/app-content/site/edit.ts` | 149 |
| `frontend/src/views/app-content/site/edit.ts` | 223 |
| `frontend/src/views/app-content/site/edit.ts` | 230 |
| `frontend/src/views/app-content/site/edit.ts` | 245 |
| `frontend/src/views/app-content/site/events.ts` | 146 |
| `frontend/src/views/app-content/site/events.ts` | 274 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 108 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 118 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 124 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 136 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 147 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 153 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 59 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 107 |
| `frontend/src/views/app-nav/index.ts` | 100 |
| `frontend/src/views/app-preview/detail-3d.ts` | 241 |
| `frontend/src/views/app-preview/detail-3d.ts` | 307 |
| `frontend/src/views/app-preview/index.ts` | 230 |
| `frontend/src/views/app-preview/index.ts` | 250 |
| `frontend/src/views/app-preview/mmd-controls.ts` | 282 |
| `frontend/src/views/app-preview/preview-library.ts` | 75 |
| `frontend/src/views/app-preview/ysm-controls.ts` | 113 |
| `frontend/src/views/app-sidebar/events.ts` | 118 |
| `frontend/src/views/app-sidebar/events.ts` | 123 |
| `frontend/src/views/app-sidebar/index.ts` | 149 |
| `frontend/src/views/app-sidebar/index.ts` | 241 |
| `frontend/src/views/app-sidebar/index.ts` | 243 |
| `frontend/src/views/app-sidebar/index.ts` | 246 |
| `frontend/src/views/app-sidebar/index.ts` | 282 |
| `frontend/src/views/app-sidebar/index.ts` | 284 |
| `frontend/src/views/app-sidebar/index.ts` | 286 |
| `frontend/src/views/app-sidebar/index.ts` | 291 |
| `frontend/src/views/app-sidebar/loader.ts` | 145 |
| `frontend/src/views/app-sync-manager/index.ts` | 148 |
| `frontend/src/views/app-sync-manager/network.ts` | 43 |
| `frontend/src/views/app-sync-manager/network.ts` | 51 |
| `frontend/src/views/app-sync-manager/store.ts` | 27 |
| `frontend/src/views/app-sync-manager/store.ts` | 46 |
| `frontend/src/views/app-toast/index.ts` | 118 |
| `frontend/src/views/app-toast/index.ts` | 137 |
| `frontend/src/views/app-toast/index.ts` | 146 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 78 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 104 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 149 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 155 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 172 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 197 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 204 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 234 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 241 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 276 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 288 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 296 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 331 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 337 |
| `frontend/src/views/app-tree/events.ts` | 89 |
| `frontend/src/views/app-tree/events.ts` | 97 |
| `frontend/src/views/app-tree/events.ts` | 122 |
| `frontend/src/views/app-tree/events.ts` | 182 |
| `frontend/src/views/app-tree/events.ts` | 189 |
| `frontend/src/views/app-tree/events.ts` | 197 |
| `frontend/src/views/app-tree/events.ts` | 214 |
| `frontend/src/views/app-tree/events.ts` | 221 |
| `frontend/src/views/app-tree/events.ts` | 414 |
| `frontend/src/views/app-tree/events.ts` | 422 |
| `frontend/src/views/app-tree/events.ts` | 463 |
| `frontend/src/views/app-tree/events.ts` | 476 |
| `frontend/src/views/app-tree/index.ts` | 199 |
| `frontend/src/views/app-tree/index.ts` | 342 |
| `frontend/src/views/app-tree/index.ts` | 350 |
| `frontend/src/views/app-tree/index.ts` | 451 |
| `frontend/src/views/app-tree/index.ts` | 458 |
| `frontend/src/views/app-tree/loader.ts` | 30 |
| `frontend/src/views/app-tree/loader.ts` | 54 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 43 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 54 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 160 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 311 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 329 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 335 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 346 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 122 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 144 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 178 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 197 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 219 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 225 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 254 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 263 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/error-diary.ts` | 49 |
| `frontend/src/views/app-toast/index.ts` | 58 |

### `tree:reload`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 16 |
| `frontend/src/core/handlers/android-events.ts` | 64 |
| `frontend/src/core/handlers/sync.ts` | 120 |
| `frontend/src/core/handlers/sync.ts` | 234 |
| `frontend/src/features/community/download-queue.ts` | 109 |
| `frontend/src/features/import-executor.ts` | 69 |
| `frontend/src/features/import-executor.ts` | 255 |
| `frontend/src/features/recycle-bin.ts` | 80 |
| `frontend/src/features/recycle-bin.ts` | 193 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 392 |
| `frontend/src/views/app-sidebar/index.ts` | 289 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 37 |

### `tree:set-search`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 108 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/index.ts` | 135 |
