# Bus 事件映射表

> **自动生成** — 由 `scripts/event-graph.mjs` 生成。
> 改事件名 / payload 时，先看此表定位影响面。

## 总览

| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 |
|------|--------|--------|-----------|--------|
| `avatar:refresh` | 1 | 1 | 0 | 0 |
| `batch:disable` | 0 | 1 | 0 | 0 |
| `batch:disable-all` | 1 | 1 | 0 | 0 |
| `batch:enable` | 0 | 1 | 0 | 0 |
| `batch:enable-all` | 1 | 1 | 0 | 0 |
| `batch:rename` | 1 | 1 | 0 | 0 |
| `config:updated` | 4 | 0 | 0 | 0 |
| `ctx:show` | 4 | 1 | 0 | 0 |
| `dir:batch-rename` | 1 | 1 | 0 | 0 |
| `dir:mkdir` | 1 | 1 | 0 | 0 |
| `dir:recycle` | 1 | 1 | 0 | 0 |
| `dir:rename` | 1 | 1 | 0 | 0 |
| `import:history-changed` | 3 | 0 | 0 | 0 |
| `instance:clear` | 1 | 1 | 0 | 0 |
| `instance:export-list` | 1 | 1 | 0 | 0 |
| `lang:changed` | 2 | 2 | 0 | 0 |
| `menu:show` | 2 | 1 | 0 | 0 |
| `model:select` | 8 | 1 | 0 | 0 |
| `morph:apply` | 1 | 0 | 0 | 0 |
| `nav:changed` | 6 | 3 | 0 | 0 |
| `package:selected` | 2 | 1 | 0 | 0 |
| `repo:rtype-changed` | 3 | 6 | 0 | 0 |
| `repo:search-creator` | 0 | 1 | 0 | 0 |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 |
| `stage:load` | 1 | 0 | 0 | 0 |
| `stats:refresh` | 21 | 2 | 0 | 0 |
| `sync:download:done` | 2 | 2 | 0 | 0 |
| `sync:download:missing` | 1 | 0 | 0 | 0 |
| `sync:toggle:status` | 3 | 1 | 0 | 0 |
| `theme:change` | 1 | 0 | 0 | 0 |
| `toast:show` | 192 | 2 | 0 | 0 |
| `tree:reload` | 11 | 1 | 0 | 0 |
| `tree:set-search` | 1 | 1 | 0 | 0 |

## 事件详情

### `avatar:refresh`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/features/community/download-queue-store.ts` | 261 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-workshop.ts` | 112 |

### `batch:disable`

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 29 |

### `batch:disable-all`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 178 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 20 |

### `batch:enable`

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 24 |

### `batch:enable-all`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 177 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 19 |

### `batch:rename`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 107 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 218 |

### `config:updated`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/settings/path-cards.ts` | 77 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 273 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 301 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 355 |

### `ctx:show`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 126 |
| `frontend/src/views/app-tree/events.ts` | 356 |
| `frontend/src/views/app-tree/events.ts` | 387 |
| `frontend/src/views/app-tree/events.ts` | 400 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 79 |

### `dir:batch-rename`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 13 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 162 |

### `dir:mkdir`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 50 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 69 |

### `dir:recycle`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 51 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 98 |

### `dir:rename`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 36 |

### `import:history-changed`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/features/import-executor.ts` | 46 |
| `frontend/src/features/import-executor.ts` | 54 |
| `frontend/src/features/import-executor.ts` | 60 |

### `instance:clear`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 101 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 101 |

### `instance:export-list`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 96 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 14 |

### `lang:changed`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/i18n/locale.ts` | 82 |
| `frontend/src/core/i18n/locale.ts` | 128 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 112 |
| `frontend/src/views/app-nav/index.ts` | 52 |

### `menu:show`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 80 |
| `frontend/src/features/community/events.ts` | 222 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/context-menu/index.ts` | 25 |

### `model:select`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/features/oldest-models.ts` | 50 |
| `frontend/src/features/recycle-bin.ts` | 108 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 346 |
| `frontend/src/views/app-preview/detail-3d.ts` | 222 |
| `frontend/src/views/app-preview/detail-3d.ts` | 289 |
| `frontend/src/views/app-tree/events.ts` | 165 |
| `frontend/src/views/app-tree/events.ts` | 342 |
| `frontend/src/views/app-tree/index.ts` | 404 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/index.ts` | 111 |

### `morph:apply`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/detail-3d.ts` | 234 |

### `nav:changed`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 106 |
| `frontend/src/views/app-content/index.ts` | 178 |
| `frontend/src/views/app-nav/index.ts` | 62 |
| `frontend/src/views/app-nav/index.ts` | 139 |
| `frontend/src/views/app-sidebar/events.ts` | 202 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 86 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/page-store.ts` | 55 |
| `frontend/src/views/app-content/index.ts` | 97 |
| `frontend/src/views/app-nav/index.ts` | 38 |

### `package:selected`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 88 |
| `frontend/src/views/app-sidebar/events.ts` | 187 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-pages.ts` | 37 |

### `repo:rtype-changed`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/settings/init.ts` | 346 |
| `frontend/src/views/app-content/settings/init.ts` | 370 |
| `frontend/src/views/app-nav/index.ts` | 204 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/features/repo-rtype.ts` | 23 |
| `frontend/src/views/app-content/init-pages.ts` | 74 |
| `frontend/src/views/app-content/init-pages.ts` | 183 |
| `frontend/src/views/app-nav/index.ts` | 54 |
| `frontend/src/views/app-sidebar/index.ts` | 101 |
| `frontend/src/views/app-sync-manager/index.ts` | 171 |

### `repo:search-creator`

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 104 |

### `repo:subdir-changed`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-nav/index.ts` | 207 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sync-manager/index.ts` | 194 |

### `stage:load`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/detail-3d.ts` | 299 |

### `stats:refresh`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 17 |
| `frontend/src/core/handlers/android-events.ts` | 65 |
| `frontend/src/core/handlers/instance-ops.ts` | 157 |
| `frontend/src/core/handlers/sync.ts` | 102 |
| `frontend/src/core/handlers/sync.ts` | 211 |
| `frontend/src/features/community/download-queue.ts` | 122 |
| `frontend/src/features/import-executor.ts` | 70 |
| `frontend/src/features/import-executor.ts` | 258 |
| `frontend/src/features/recycle-bin.ts` | 78 |
| `frontend/src/features/recycle-bin.ts` | 191 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 391 |
| `frontend/src/views/app-content/settings/init.ts` | 198 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 78 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 356 |
| `frontend/src/views/app-sidebar/index.ts` | 345 |
| `frontend/src/views/app-sync-manager/index.ts` | 217 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 57 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 138 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 199 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 242 |
| `frontend/src/views/app-tree/events.ts` | 208 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 93 |
| `frontend/src/views/app-sync-manager/index.ts` | 151 |

### `sync:download:done`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 23 |
| `frontend/src/core/handlers/sync.ts` | 119 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 233 |
| `frontend/src/views/app-sidebar/index.ts` | 271 |

### `sync:download:missing`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 257 |

### `sync:toggle:status`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 360 |
| `frontend/src/views/app-tree/events.ts` | 102 |
| `frontend/src/views/app-tree/events.ts` | 206 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 131 |

### `theme:change`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/theme-core.ts` | 34 |

### `toast:show`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/app-modules.ts` | 69 |
| `frontend/src/app-modules.ts` | 79 |
| `frontend/src/app-modules.ts` | 106 |
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
| `frontend/src/features/community/download-queue.ts` | 305 |
| `frontend/src/features/community/download-queue.ts` | 337 |
| `frontend/src/features/community/events.ts` | 165 |
| `frontend/src/features/community/events.ts` | 179 |
| `frontend/src/features/community/events.ts` | 252 |
| `frontend/src/features/community/events.ts` | 296 |
| `frontend/src/features/community/events.ts` | 318 |
| `frontend/src/features/import-dnd.ts` | 41 |
| `frontend/src/features/import-dnd.ts` | 59 |
| `frontend/src/features/import-dnd.ts` | 98 |
| `frontend/src/features/import-dnd.ts` | 111 |
| `frontend/src/features/import-dnd.ts` | 125 |
| `frontend/src/features/import-dnd.ts` | 204 |
| `frontend/src/features/import-executor.ts` | 65 |
| `frontend/src/features/import-executor.ts` | 249 |
| `frontend/src/features/import-executor.ts` | 262 |
| `frontend/src/features/recycle-bin.ts` | 72 |
| `frontend/src/features/recycle-bin.ts` | 81 |
| `frontend/src/features/recycle-bin.ts` | 193 |
| `frontend/src/features/recycle-bin.ts` | 201 |
| `frontend/src/features/version-updater.ts` | 147 |
| `frontend/src/features/version-updater.ts` | 156 |
| `frontend/src/features/version-updater.ts` | 179 |
| `frontend/src/features/version-updater.ts` | 188 |
| `frontend/src/features/version-updater.ts` | 209 |
| `frontend/src/features/version-updater.ts` | 243 |
| `frontend/src/features/version-updater.ts` | 253 |
| `frontend/src/utils/3d/adapters/mount-preview-core.ts` | 970 |
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
| `frontend/src/views/app-content/workshop-site-opener.ts` | 108 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 118 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 124 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 136 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 147 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 153 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 59 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 107 |
| `frontend/src/views/app-nav/index.ts` | 229 |
| `frontend/src/views/app-preview/detail-3d.ts` | 235 |
| `frontend/src/views/app-preview/detail-3d.ts` | 300 |
| `frontend/src/views/app-preview/index.ts` | 230 |
| `frontend/src/views/app-preview/index.ts` | 250 |
| `frontend/src/views/app-preview/mmd-controls.ts` | 282 |
| `frontend/src/views/app-preview/preview-library.ts` | 75 |
| `frontend/src/views/app-preview/ysm-controls.ts` | 113 |
| `frontend/src/views/app-sidebar/events.ts` | 118 |
| `frontend/src/views/app-sidebar/events.ts` | 123 |
| `frontend/src/views/app-sidebar/index.ts` | 209 |
| `frontend/src/views/app-sidebar/index.ts` | 294 |
| `frontend/src/views/app-sidebar/index.ts` | 296 |
| `frontend/src/views/app-sidebar/index.ts` | 299 |
| `frontend/src/views/app-sidebar/index.ts` | 316 |
| `frontend/src/views/app-sidebar/index.ts` | 339 |
| `frontend/src/views/app-sidebar/index.ts` | 341 |
| `frontend/src/views/app-sidebar/index.ts` | 343 |
| `frontend/src/views/app-sidebar/index.ts` | 348 |
| `frontend/src/views/app-sidebar/loader.ts` | 145 |
| `frontend/src/views/app-sync-manager/index.ts` | 148 |
| `frontend/src/views/app-sync-manager/network.ts` | 43 |
| `frontend/src/views/app-sync-manager/network.ts` | 51 |
| `frontend/src/views/app-sync-manager/store.ts` | 27 |
| `frontend/src/views/app-sync-manager/store.ts` | 46 |
| `frontend/src/views/app-toast/index.ts` | 118 |
| `frontend/src/views/app-toast/index.ts` | 137 |
| `frontend/src/views/app-toast/index.ts` | 146 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 59 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 88 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 146 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 152 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 172 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 200 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 207 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 243 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 250 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 300 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 315 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 324 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 363 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 371 |
| `frontend/src/views/app-tree/events.ts` | 50 |
| `frontend/src/views/app-tree/events.ts` | 59 |
| `frontend/src/views/app-tree/events.ts` | 105 |
| `frontend/src/views/app-tree/events.ts` | 121 |
| `frontend/src/views/app-tree/events.ts` | 177 |
| `frontend/src/views/app-tree/events.ts` | 186 |
| `frontend/src/views/app-tree/events.ts` | 212 |
| `frontend/src/views/app-tree/events.ts` | 247 |
| `frontend/src/views/app-tree/events.ts` | 254 |
| `frontend/src/views/app-tree/events.ts` | 262 |
| `frontend/src/views/app-tree/events.ts` | 281 |
| `frontend/src/views/app-tree/events.ts` | 288 |
| `frontend/src/views/app-tree/index.ts` | 204 |
| `frontend/src/views/app-tree/index.ts` | 335 |
| `frontend/src/views/app-tree/index.ts` | 344 |
| `frontend/src/views/app-tree/index.ts` | 455 |
| `frontend/src/views/app-tree/index.ts` | 462 |
| `frontend/src/views/app-tree/loader.ts` | 30 |
| `frontend/src/views/app-tree/loader.ts` | 54 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 126 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 228 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 239 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 280 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 290 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 315 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 333 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 339 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 350 |
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

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 16 |
| `frontend/src/core/handlers/android-events.ts` | 64 |
| `frontend/src/core/handlers/sync.ts` | 120 |
| `frontend/src/core/handlers/sync.ts` | 234 |
| `frontend/src/features/community/download-queue.ts` | 121 |
| `frontend/src/features/import-executor.ts` | 71 |
| `frontend/src/features/import-executor.ts` | 257 |
| `frontend/src/features/recycle-bin.ts` | 79 |
| `frontend/src/features/recycle-bin.ts` | 192 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 392 |
| `frontend/src/views/app-sidebar/index.ts` | 346 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 261 |

### `tree:set-search`

**发射方（emit）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 108 |

**订阅方（on）：**

| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/index.ts` | 135 |
