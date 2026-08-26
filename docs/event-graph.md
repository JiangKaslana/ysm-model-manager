# Bus 事件契约报告

> **自动生成** — 由 `scripts/event-graph.mjs` 生成。
> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方（含 html 内联、可选链调用）。

## ✅ 无异常

所有调用均在 BusEvents 契约内，无孤儿发射 / 鬼订阅 / 未声明事件 / 缺参。

## 事件总览

| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 | 状态 |
|------|--------|--------|-----------|--------|------|
| `avatar:refresh` | 1 | 1 | 0 | 0 | ✅ |
| `batch:disable-all` | 1 | 1 | 0 | 0 | ✅ |
| `batch:enable-all` | 1 | 1 | 0 | 0 | ✅ |
| `batch:rename` | 1 | 1 | 0 | 0 | ✅ |
| `ctx:show` | 4 | 1 | 0 | 0 | ✅ |
| `dir:batch-rename` | 1 | 1 | 0 | 0 | ✅ |
| `dir:mkdir` | 1 | 1 | 0 | 0 | ✅ |
| `dir:recycle` | 1 | 1 | 0 | 0 | ✅ |
| `dir:rename` | 1 | 1 | 0 | 0 | ✅ |
| `instance:clear` | 1 | 1 | 0 | 0 | ✅ |
| `instance:export-list` | 1 | 1 | 0 | 0 | ✅ |
| `lang:changed` | 2 | 2 | 0 | 0 | ✅ |
| `menu:show` | 2 | 1 | 0 | 0 | ✅ |
| `model:select` | 8 | 1 | 0 | 0 | ✅ |
| `nav:changed` | 7 | 3 | 0 | 0 | ✅ |
| `package:selected` | 2 | 1 | 0 | 0 | ✅ |
| `repo:rtype-changed` | 3 | 6 | 0 | 0 | ✅ |
| `repo:search-creator` | 2 | 1 | 0 | 0 | ✅ |
| `repo:subdir-changed` | 1 | 1 | 0 | 0 | ✅ |
| `stats:refresh` | 21 | 2 | 0 | 0 | ✅ |
| `sync:download:done` | 2 | 2 | 0 | 0 | ✅ |
| `sync:download:missing` | 1 | 1 | 0 | 0 | ✅ |
| `sync:toggle:status` | 3 | 1 | 0 | 0 | ✅ |
| `toast:show` | 203 | 2 | 0 | 0 | ✅ |
| `tree:reload` | 11 | 1 | 0 | 0 | ✅ |
| `tree:set-search` | 1 | 1 | 0 | 0 | ✅ |

## 调用详情

### `avatar:refresh`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/community/download-queue-store.ts` | 276 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-workshop.ts` | 147 |

### `batch:disable-all`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/toolbar-events.ts` | 212 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 29 |

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
| `frontend/src/core/context-menu-handlers.ts` | 121 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 34 |

### `ctx:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 111 |
| `frontend/src/views/app-tree/events.ts` | 315 |
| `frontend/src/views/app-tree/events.ts` | 339 |
| `frontend/src/views/app-tree/events.ts` | 350 |

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
| `frontend/src/views/app-tree/bus-handlers.ts` | 33 |

### `dir:mkdir`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 50 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 31 |

### `dir:recycle`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 51 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 32 |

### `dir:rename`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-dir-handlers.ts` | 11 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 30 |

### `instance:clear`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 114 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 101 |

### `instance:export-list`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-handlers.ts` | 104 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/instance-ops.ts` | 14 |

### `lang:changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/i18n/locale.ts` | 89 |
| `frontend/src/core/i18n/locale.ts` | 140 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 112 |
| `frontend/src/views/app-nav/index.ts` | 152 |

### `menu:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menus.ts` | 80 |
| `frontend/src/features/community/events.ts` | 195 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/context-menu/index.ts` | 25 |

### `model:select`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/oldest-models.ts` | 61 |
| `frontend/src/features/recycle-bin.ts` | 183 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 366 |
| `frontend/src/views/app-preview/detail-3d.ts` | 227 |
| `frontend/src/views/app-preview/detail-3d.ts` | 294 |
| `frontend/src/views/app-tree/events.ts` | 175 |
| `frontend/src/views/app-tree/events.ts` | 271 |
| `frontend/src/views/app-tree/index.ts` | 406 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-preview/index.ts` | 114 |

### `nav:changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 106 |
| `frontend/src/views/app-content/index.ts` | 178 |
| `frontend/src/views/app-content/site/events.ts` | 201 |
| `frontend/src/views/app-nav/index.ts` | 21 |
| `frontend/src/views/app-nav/index.ts` | 162 |
| `frontend/src/views/app-sidebar/events.ts` | 238 |
| `frontend/src/views/app-tree/toolbar-events.ts` | 115 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/page-store.ts` | 63 |
| `frontend/src/views/app-content/index.ts` | 97 |
| `frontend/src/views/app-nav/index.ts` | 138 |

### `package:selected`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/events.ts` | 66 |
| `frontend/src/views/app-sidebar/events.ts` | 223 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/init-pages.ts` | 36 |

### `repo:rtype-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/settings/init.ts` | 274 |
| `frontend/src/views/app-content/settings/init.ts` | 296 |
| `frontend/src/views/app-nav/index.ts` | 82 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/features/repo-rtype.ts` | 33 |
| `frontend/src/views/app-content/init-pages.ts` | 78 |
| `frontend/src/views/app-content/init-pages.ts` | 254 |
| `frontend/src/views/app-nav/index.ts` | 154 |
| `frontend/src/views/app-sidebar/index.ts` | 428 |
| `frontend/src/views/app-sync-manager/index.ts` | 172 |

### `repo:search-creator`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/site/events.ts` | 169 |
| `frontend/src/views/app-content/site/events.ts` | 307 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 104 |

### `repo:subdir-changed`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-nav/index.ts` | 83 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sync-manager/index.ts` | 195 |

### `stats:refresh`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 17 |
| `frontend/src/core/handlers/android-events.ts` | 65 |
| `frontend/src/core/handlers/instance-ops.ts` | 157 |
| `frontend/src/core/handlers/sync.ts` | 85 |
| `frontend/src/core/handlers/sync.ts` | 206 |
| `frontend/src/features/community/download-queue.ts` | 110 |
| `frontend/src/features/import-executor.ts` | 33 |
| `frontend/src/features/import-executor.ts` | 219 |
| `frontend/src/features/recycle-bin.ts` | 107 |
| `frontend/src/features/recycle-bin.ts` | 167 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 416 |
| `frontend/src/views/app-content/settings/init.ts` | 140 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 77 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 352 |
| `frontend/src/views/app-sidebar/index.ts` | 318 |
| `frontend/src/views/app-sync-manager/index.ts` | 218 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 66 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 135 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 186 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 223 |
| `frontend/src/views/app-tree/events.ts` | 118 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 420 |
| `frontend/src/views/app-sync-manager/index.ts` | 152 |

### `sync:download:done`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 105 |
| `frontend/src/core/handlers/sync.ts` | 132 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 194 |
| `frontend/src/views/app-sidebar/index.ts` | 215 |

### `sync:download:missing`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-sidebar/index.ts` | 208 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 259 |

### `sync:toggle:status`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 318 |
| `frontend/src/views/app-tree/events.ts` | 116 |
| `frontend/src/views/app-tree/events.ts` | 472 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/handlers/sync.ts` | 265 |

### `toast:show`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/app-modules.ts` | 67 |
| `frontend/src/app-modules.ts` | 77 |
| `frontend/src/app-modules.ts` | 87 |
| `frontend/src/app-modules.ts` | 118 |
| `frontend/src/core/context-menu-shared.ts` | 22 |
| `frontend/src/core/context-menu-shared.ts` | 52 |
| `frontend/src/core/context-menu-shared.ts` | 62 |
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
| `frontend/src/core/handlers/require-mcroot.ts` | 17 |
| `frontend/src/core/handlers/sync.ts` | 40 |
| `frontend/src/core/handlers/sync.ts` | 86 |
| `frontend/src/core/handlers/sync.ts` | 115 |
| `frontend/src/core/handlers/sync.ts` | 125 |
| `frontend/src/core/handlers/sync.ts` | 156 |
| `frontend/src/core/handlers/sync.ts` | 165 |
| `frontend/src/core/handlers/sync.ts` | 199 |
| `frontend/src/core/handlers/sync.ts` | 214 |
| `frontend/src/core/handlers/sync.ts` | 239 |
| `frontend/src/features/community/download-queue.ts` | 268 |
| `frontend/src/features/community/download-queue.ts` | 294 |
| `frontend/src/features/community/events.ts` | 140 |
| `frontend/src/features/community/events.ts` | 152 |
| `frontend/src/features/community/events.ts` | 221 |
| `frontend/src/features/community/events.ts` | 273 |
| `frontend/src/features/community/events.ts` | 310 |
| `frontend/src/features/import-dnd.ts` | 46 |
| `frontend/src/features/import-dnd.ts` | 64 |
| `frontend/src/features/import-dnd.ts` | 103 |
| `frontend/src/features/import-dnd.ts` | 116 |
| `frontend/src/features/import-dnd.ts` | 130 |
| `frontend/src/features/import-dnd.ts` | 216 |
| `frontend/src/features/import-executor.ts` | 28 |
| `frontend/src/features/import-executor.ts` | 210 |
| `frontend/src/features/import-executor.ts` | 223 |
| `frontend/src/features/recycle-bin.ts` | 240 |
| `frontend/src/features/version-updater.ts` | 147 |
| `frontend/src/features/version-updater.ts` | 156 |
| `frontend/src/features/version-updater.ts` | 182 |
| `frontend/src/features/version-updater.ts` | 191 |
| `frontend/src/features/version-updater.ts` | 214 |
| `frontend/src/features/version-updater.ts` | 248 |
| `frontend/src/features/version-updater.ts` | 258 |
| `frontend/src/utils/3d/adapters/mount-preview-core.ts` | 384 |
| `frontend/src/utils/3d/adapters/mount-preview-core.ts` | 823 |
| `frontend/src/utils/3d/adapters/switch-preview.ts` | 136 |
| `frontend/src/utils/3d/adapters/switch-preview.ts` | 226 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 101 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 391 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 405 |
| `frontend/src/utils/dom/dialogs/batch-rename.ts` | 425 |
| `frontend/src/utils/dom/directory-picker.ts` | 33 |
| `frontend/src/utils/dom/directory-picker.ts` | 44 |
| `frontend/src/utils/dom/directory-picker.ts` | 56 |
| `frontend/src/utils/module-loader.ts` | 16 |
| `frontend/src/views/app-content/diagnostics/conflicts.ts` | 27 |
| `frontend/src/views/app-content/diagnostics/conflicts.ts` | 173 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 39 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 50 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 56 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 74 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 86 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 101 |
| `frontend/src/views/app-content/diagnostics/init.ts` | 109 |
| `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 87 |
| `frontend/src/views/app-content/diagnostics/perf-cli.ts` | 353 |
| `frontend/src/views/app-content/index.ts` | 169 |
| `frontend/src/views/app-content/init-pages.ts` | 167 |
| `frontend/src/views/app-content/init-pages.ts` | 280 |
| `frontend/src/views/app-content/settings/init.ts` | 47 |
| `frontend/src/views/app-content/settings/init.ts` | 82 |
| `frontend/src/views/app-content/settings/init.ts` | 126 |
| `frontend/src/views/app-content/settings/init.ts` | 142 |
| `frontend/src/views/app-content/settings/init.ts` | 149 |
| `frontend/src/views/app-content/settings/init.ts` | 155 |
| `frontend/src/views/app-content/settings/init.ts` | 183 |
| `frontend/src/views/app-content/settings/init.ts` | 230 |
| `frontend/src/views/app-content/settings/keymap.ts` | 103 |
| `frontend/src/views/app-content/settings/keymap.ts` | 114 |
| `frontend/src/views/app-content/settings/keymap.ts` | 135 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 78 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 272 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 278 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 299 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 305 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 327 |
| `frontend/src/views/app-content/settings/path-cards.ts` | 353 |
| `frontend/src/views/app-content/settings/store.ts` | 27 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 122 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 133 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 144 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 156 |
| `frontend/src/views/app-content/settings/ui-prefs.ts` | 166 |
| `frontend/src/views/app-content/settings/worker-prefs.ts` | 43 |
| `frontend/src/views/app-content/site/drag.ts` | 44 |
| `frontend/src/views/app-content/site/drag.ts` | 81 |
| `frontend/src/views/app-content/site/drag.ts` | 104 |
| `frontend/src/views/app-content/site/drag.ts` | 113 |
| `frontend/src/views/app-content/site/edit.ts` | 114 |
| `frontend/src/views/app-content/site/edit.ts` | 142 |
| `frontend/src/views/app-content/site/edit.ts` | 149 |
| `frontend/src/views/app-content/site/edit.ts` | 223 |
| `frontend/src/views/app-content/site/edit.ts` | 230 |
| `frontend/src/views/app-content/site/edit.ts` | 245 |
| `frontend/src/views/app-content/site/events.ts` | 146 |
| `frontend/src/views/app-content/site/events.ts` | 271 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 116 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 126 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 132 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 144 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 155 |
| `frontend/src/views/app-content/workshop-site-opener.ts` | 161 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 89 |
| `frontend/src/views/app-content/workshop-tabs.ts` | 137 |
| `frontend/src/views/app-nav/index.ts` | 101 |
| `frontend/src/views/app-preview/detail-3d.ts` | 240 |
| `frontend/src/views/app-preview/detail-3d.ts` | 306 |
| `frontend/src/views/app-preview/index.ts` | 233 |
| `frontend/src/views/app-preview/index.ts` | 253 |
| `frontend/src/views/app-preview/mmd-controls.ts` | 290 |
| `frontend/src/views/app-preview/preview-library.ts` | 88 |
| `frontend/src/views/app-preview/ysm-controls.ts` | 113 |
| `frontend/src/views/app-sidebar/events.ts` | 63 |
| `frontend/src/views/app-sidebar/events.ts` | 103 |
| `frontend/src/views/app-sidebar/events.ts` | 108 |
| `frontend/src/views/app-sidebar/events.ts` | 219 |
| `frontend/src/views/app-sidebar/index.ts` | 149 |
| `frontend/src/views/app-sidebar/index.ts` | 263 |
| `frontend/src/views/app-sidebar/index.ts` | 265 |
| `frontend/src/views/app-sidebar/index.ts` | 268 |
| `frontend/src/views/app-sidebar/index.ts` | 312 |
| `frontend/src/views/app-sidebar/index.ts` | 314 |
| `frontend/src/views/app-sidebar/index.ts` | 316 |
| `frontend/src/views/app-sidebar/index.ts` | 321 |
| `frontend/src/views/app-sidebar/loader.ts` | 151 |
| `frontend/src/views/app-sync-manager/index.ts` | 149 |
| `frontend/src/views/app-sync-manager/network.ts` | 47 |
| `frontend/src/views/app-sync-manager/network.ts` | 55 |
| `frontend/src/views/app-sync-manager/store.ts` | 30 |
| `frontend/src/views/app-sync-manager/store.ts` | 52 |
| `frontend/src/views/app-toast/index.ts` | 118 |
| `frontend/src/views/app-toast/index.ts` | 137 |
| `frontend/src/views/app-toast/index.ts` | 146 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 68 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 94 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 139 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 145 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 162 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 187 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 194 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 224 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 231 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 266 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 278 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 286 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 321 |
| `frontend/src/views/app-tree/bus-handlers.ts` | 327 |
| `frontend/src/views/app-tree/events.ts` | 89 |
| `frontend/src/views/app-tree/events.ts` | 97 |
| `frontend/src/views/app-tree/events.ts` | 122 |
| `frontend/src/views/app-tree/events.ts` | 150 |
| `frontend/src/views/app-tree/events.ts` | 191 |
| `frontend/src/views/app-tree/events.ts` | 200 |
| `frontend/src/views/app-tree/events.ts` | 216 |
| `frontend/src/views/app-tree/events.ts` | 223 |
| `frontend/src/views/app-tree/events.ts` | 426 |
| `frontend/src/views/app-tree/events.ts` | 434 |
| `frontend/src/views/app-tree/events.ts` | 475 |
| `frontend/src/views/app-tree/events.ts` | 488 |
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
| `frontend/src/views/app-tree/toolbar-search.ts` | 142 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 161 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 191 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 207 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 236 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 242 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 304 |
| `frontend/src/views/app-tree/toolbar-search.ts` | 313 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/error-diary.ts` | 55 |
| `frontend/src/views/app-toast/index.ts` | 58 |

### `tree:reload`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/core/context-menu-shared.ts` | 16 |
| `frontend/src/core/handlers/android-events.ts` | 64 |
| `frontend/src/core/handlers/sync.ts` | 133 |
| `frontend/src/core/handlers/sync.ts` | 246 |
| `frontend/src/features/community/download-queue.ts` | 109 |
| `frontend/src/features/import-executor.ts` | 34 |
| `frontend/src/features/import-executor.ts` | 218 |
| `frontend/src/features/recycle-bin.ts` | 108 |
| `frontend/src/features/recycle-bin.ts` | 168 |
| `frontend/src/views/app-content/diagnostics/dedup.ts` | 417 |
| `frontend/src/views/app-sidebar/index.ts` | 319 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/bus-handlers.ts` | 35 |

### `tree:set-search`

**发射方：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-content/index.ts` | 108 |

**订阅方（on）：**
| 文件 | 行 |
|------|----|
| `frontend/src/views/app-tree/index.ts` | 135 |
