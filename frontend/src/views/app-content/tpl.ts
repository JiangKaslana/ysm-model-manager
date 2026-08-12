// ===== app-content 页面模板 =====
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { ALL_EXTS } from "../../utils/resource/extensions.ts";
import { t } from "../../core/i18n/t.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";

// P3 修复（审核）：GitHub 仓库 URL 集中为常量——原 repo/releases/docs 三形态
// 散落于 tpl.ts 与 settings/community.ts 四处，仓库迁移时遗漏一处即漂移
// 注：仅 GH_RELEASES 被包外（settings/community.ts）引用，其余为 tpl.ts 内部使用，
// 不导出（deadcode 门禁：无外部消费者的导出会被标死代码）
const GH_REPO = "https://github.com/eghrhegpe/ysm-model-manager";
export const GH_RELEASES = GH_REPO + "/releases";
const GH_DOCS = GH_REPO + "/tree/main/docs";

export function repositoryHTML(): string {
  // 查看器模式（Android/网页版 ADR-049）：回收站/查重/最旧模型依赖本地文件系统
  // 操作（MoveToRecycle/FindDuplicateFiles 等 browser-adapter 未实现），隐藏对应 tab
  const viewerExtras = isViewerMode()
    ? ""
    : '<button class="repo-tab" data-testid="content-tab" data-tab="recycle">♻️ ' +
      t("recycle.tab") +
      "</button>" +
      '<button class="repo-tab" data-testid="content-tab" data-tab="dedup">🔗 ' +
      t("repo.tab.dedup") +
      "</button>" +
      '<button class="repo-tab" data-testid="content-tab" data-tab="oldest">👴 ' +
      t("repo.tab.oldest") +
      "</button>";
  return (
    '<div class="repo-wrap">' +
    // 第一栏：操作
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-testid="content-tab" data-tab="tree">📁 ' + t("repo.tab.tree") + '</button>' +
    '<button class="repo-tab" data-testid="content-tab" data-tab="import">📥 ' + t("import.tab") + '</button>' +
    viewerExtras +
    "</div>" +
    // 第二栏：资源类型（仅在文件树 tab 可见）
    '<div class="repo-subtabs" id="repo-subtabs" style="display:flex;gap:2px;padding:2px 8px;border-bottom:1px solid var(--bd);flex-shrink:0">' +
    '<button class="repo-subtab active" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.YSM + '">💎 YSM</button>' +
    '<button class="repo-subtab" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.MMD + '">🎭 MMD</button>' +
    '<button class="repo-subtab" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.VRC + '">🥽 VRC</button>' +
    '<span style="padding:3px 4px;color:var(--muted)">│</span>' +
    '<button class="repo-subtab" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.PACK + '">🎨 ' + t("rtype.pack") + '</button>' +
    '<button class="repo-subtab" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.SHADER + '">☀️ ' + t("rtype.shader") + '</button>' +
    '<button class="repo-subtab" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.BLUEPRINT + '">⚙️ ' + t("rtype.blueprint") + '</button>' +
    '<button class="repo-subtab" data-testid="content-subtab" data-rtab="' + RESOURCE_TYPES.LITEMATIC + '">📐 ' + t("rtype.litematic") + '</button>' +
    "</div>" +
    '<div class="repo-layout" style="flex:1;display:flex;overflow:hidden">' +
    '<div class="repo-left" style="flex:1;display:flex;flex-direction:column;min-width:0">' +
    '<div class="repo-tab-body" id="repo-tab-tree" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    // 默认 YSM 文件树（预览在外层共享）
    '<app-tree root="' + RESOURCE_TYPES.YSM + '" style="flex:1;min-width:0"></app-tree>' +
    "</div>" +
    '<div class="repo-tab-body" id="repo-tab-import" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-recycle" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-dedup" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>' +
    '<div class="repo-tab-body" id="repo-tab-oldest" style="display:none;flex:1;overflow-y:auto;overflow-x:hidden"></div>' +
    "</div>" +
    '<div class="preview-resize-handle" id="preview-resize-handle" style="width:4px;cursor:col-resize;background:transparent;transition:background var(--tr-fast);flex-shrink:0"></div>' +
    '<app-preview id="app-preview" style="width:var(--preview-width,220px);flex-shrink:0;border-left:1px solid var(--bd)"></app-preview>' +
    "</div>" +
    "</div>"
  );
}

export function instancesHTML(): string {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="versions">🎮 ' + t("instances.tab.versions") + '</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="ins-tab-versions">' +
    '<div class="repo-layout">' +
    '<app-sidebar class="ins-sidebar"></app-sidebar>' +
    '<div class="ins-content" id="ins-content" style="display:flex;flex-direction:column;overflow:hidden">' +
    '<div class="dp-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px">' +
    '<div style="font-size:24px">👈</div>' +
    "<div>" + t("instances.emptyHint") + "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

export function settingsHTML(): string {
  // 查看器模式守卫（ADR-046/049）：Android 与网页版均无 Minecraft Java 版/
  // 无整合包概念、无本地文件系统配置（网页版虚拟根 /web 固定），隐藏
  // 「游戏根目录」「链接模式」「文件存储路径」卡片（绑定均有 null 守卫，安全）
  const isViewer = isViewerMode();
  const gameRootCard = isViewer
    ? ""
    : `<div class="stg-card" style="animation-delay:0ms">
      <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">🎮 ${t("settings.paths.gameRoot")}<button class="btn-base sm" id="set-mc-detect">🔍 ${t("settings.paths.autoSearch")}</button></div>
      <div class="stg-card-body">
        <div class="stg-card-val" id="set-mc-path">${t("common.loading")}</div>
        <div class="stg-card-desc">${t("settings.paths.gameRootDesc")}</div>
      </div>
    </div>`;
  const linkCard = isViewer
    ? ""
    : `<div class="stg-card" style="animation-delay:60ms">
      <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">
        <span class="label" style="font-size:13px;font-weight:600">🔗 ${t("settings.links.title")}</span>
        <button id="set-relink" class="btn-base sm">🔄 ${t("settings.links.reapply")}</button>
      </div>
      <div class="stg-card-body">
        <select id="set-link-mode" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="copy">📋 ${t("settings.links.copy")}</option>
          <option value="hardlink" selected>🔗 ${t("settings.links.hardlink")} ✅</option>
          <option value="symlink">🔗 ${t("settings.links.symlink")}</option>
        </select>
        <div id="lm-hint-copy" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">${t("settings.links.copyHint")}</div>
        <div id="lm-hint-hardlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">${t("settings.links.hardlinkHint")}</div>
        <div id="lm-hint-symlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0"><span style="color:#e5534b">${t("settings.links.symlinkHint")}</span></div>
      </div>
    </div>`;
  return `<div class="repo-wrap">
<div class="repo-tabs">
<button class="stg-tab active" data-tab="basic">⚙️ ${t("settings.basic")}</button>
<button class="stg-tab" data-tab="ui">🎨 ${t("settings.appearance")}</button>
<button class="stg-tab" data-tab="about">ℹ️ ${t("settings.about")}</button>
<button class="stg-tab" data-tab="credits">🙏 ${t("settings.credits")}</button>
</div>
<!-- stg-tab-basic -->
<div class="repo-tab-body" id="stg-tab-basic" style="overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">⚙️ ${t("settings.paths.title")}</div>

<div class="stg-grid">
    <!-- Row 1: 三栏 — 游戏根目录 + 链接模式 + 下载镜像源（查看器模式隐藏全部） -->
    ${gameRootCard}
    ${linkCard}
    ${isViewer ? "" : `
    <div class="stg-card" style="animation-delay:120ms">
      <div class="stg-card-hdr">
        <span class="label" style="font-size:13px;font-weight:600">🌐 ${t("settings.mirror.title")}</span>
      </div>
      <div class="stg-card-body">
        <select id="set-mirror" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="">🌍 ${t("settings.mirror.directOption")}</option>
          <option value="jsdelivr">⚡ ${t("settings.mirror.jsdelivrOption")}</option>
          <option value="githubapi">🐙 GitHub API</option>
        </select>
        <div id="mirror-hint-direct" style="font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.directHint")}</div>
        <div id="mirror-hint-jsdelivr" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.jsdelivrHint")}</div>
        <div id="mirror-hint-githubapi" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.githubapiHint")}</div>
      </div>
    </div>
    `}
  </div>

  <!-- Row 2: 文件存储路径（桌面）/ 网页版文件来源（viewer）——查看器模式隐藏本地路径配置，改为 FSA 授权（ADR-049 能力门控缺口补齐） -->
  ${isViewer ? `
  <div class="stg-card" id="stg-web-repo-card" style="margin-top:8px;animation-delay:180ms">
    <div class="stg-card-hdr">📁 ${t("settings.webRepo.title")}</div>
    <div class="stg-card-body">
      <div class="stg-card-desc">${t("settings.webRepo.desc")}</div>
      <button class="btn" id="web-repo-auth-btn" style="margin-top:8px;font-size:11px;padding:4px 12px">📂 ${t("settings.webRepo.authorize")}</button>
      <div id="web-repo-auth-status" style="font-size:10px;color:var(--muted);margin-top:6px;line-height:1.5"></div>
    </div>
  </div>
  ` : `
  <div class="stg-card" id="stg-files-card" style="margin-top:8px;animation-delay:180ms">
    <div class="stg-card-hdr" style="display:flex;align-items:center;justify-content:space-between">📁 ${t("settings.storage.title")}<button class="btn" id="set-advanced-toggle" style="font-size:9px;padding:2px 8px">📂 ${t("settings.storage.expand")} ▸</button></div>
    <div class="stg-card-body">
      <div class="stg-card-val" id="set-files-root">${t("common.loading")}</div>
      <div class="stg-card-desc">${t("settings.storage.desc")}</div>
      <div id="set-advanced-panel" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">
        <div style="font-size:10px;color:var(--muted);margin-bottom:6px">${t("settings.path.customHint")}</div>
        <div class="stg-grid" id="set-advanced-grid"></div>
      </div>
    </div>
  </div>
  `}

<!-- 语言 -->
<div class="section-title stg-title" style="margin-top:12px">🌐 ${t("settings.language")}</div>
<div class="stg-card" style="animation-delay:240ms">
  <div class="stg-card-body" style="display:flex;align-items:center;gap:8px">
    <select id="set-lang" class="stg-select" style="width:auto">
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
      <option value="ja">日本語</option>
    </select>
    <span style="font-size:10px;color:var(--muted)">${t("settings.languageDesc")}</span>
  </div>
</div>

</div>
</div>
<!-- /stg-tab-basic -->

<!-- stg-tab-ui -->
<div class="repo-tab-body" id="stg-tab-ui" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">🌙 ${t("settings.theme.title")}</div>

<!-- 主题卡片：直接展示 -->
<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:0ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">🎨 ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">
      <div class="theme-card" data-theme="warm">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#8b4513"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#a0866a"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#d4a574"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#5d4037">☀️ ${t("settings.theme.warm")}</span>
      </div>
      <div class="theme-card" data-theme="sakura">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#d81b60"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#f48fb1"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#fce4ec"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#5d4037">🌸 ${t("settings.theme.sakura")}</span>
      </div>
      <div class="theme-card" data-theme="mint">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#D5F5E3"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#A2D9CE"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#76D7C4"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#2c3e3a">🍃 ${t("settings.theme.mint")}</span>
      </div>
      <div class="theme-card" data-theme="pro">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#ff8a65"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#b0bec5"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#757575"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#e0e0e0">⚪ ${t("settings.theme.pro")}</span>
      </div>
      <div class="theme-card" data-theme="cyber">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#9575cd"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#66d9ef"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#f1fa8c"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#e0d5f5">🌙 ${t("settings.theme.cyber")}</span>
      </div>
      <div class="theme-card" data-theme="ocean">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#5c6bc0"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#7986cb"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#9fa8da"></span>
        </div>
        <span style="font-size:10px;font-weight:600;color:#c5d8e8">🌊 ${t("settings.theme.ocean")}</span>
      </div>
    </div>
  </div>
</div>

<!-- 自动切换：独立一栏 -->
<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
  <div class="setting-row">
    <span class="label">🕐 ${t("settings.theme.autoTitle")}</span>
    <select id="theme-auto" class="stg-select" style="width:auto">
      <option value="off">${t("settings.theme.autoOff")}</option>
      <option value="system">${t("settings.theme.autoSystem")}</option>
      <option value="time">${t("settings.theme.autoTime")}</option>
    </select>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">📐 ${t("settings.font.title")}</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">📏 ${t("settings.fontSize")}</span>
    </div>
    <select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
      <option value="small">🔹 ${t("settings.fontSize.small")}</option>
      <option value="normal" selected>🔸 ${t("settings.fontSize.normal")}</option>
      <option value="large">🔺 ${t("settings.fontSize.large")}</option>
    </select>
    <div id="set-size-preview" style="display:flex;gap:8px;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">
      <span>${t("settings.ui.body")} <b id="sz-base" style="color:var(--txt)">12px</b></span>
      <span>${t("settings.ui.buttonGap")} <b id="sz-space" style="color:var(--txt)">5px</b></span>
      <span>${t("settings.ui.buttonHeight")} <b id="sz-btn-h" style="color:var(--txt)">23px</b></span>
    </div>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.fontSizeHint")}</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:90ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">🃏 ${t("settings.font.creatorFont")}</span>
    </div>
    <select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="kaiti" selected>🖌️ ${t("settings.font.kaiti")}</option>
      <option value="system">📝 ${t("settings.font.systemFont")}</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.fontHint")}</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:120ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <span class="label" style="font-size:13px;font-weight:600">💳 ${t("settings.density")}</span>
    </div>
    <select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="compact" selected>📦 ${t("settings.density.compact")}</option>
      <option value="normal">📦 ${t("settings.density.normal")}</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.densityHint")}</div>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">⚡ ${t("settings.animation.title")}</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:180ms">
  <div class="setting-row">
    <span class="label">✨ ${t("settings.animation.enable")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-animations" checked> ${t("settings.animation.enableCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.animation.hint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:210ms">
  <div class="setting-row">
    <span class="label">🏠 ${t("settings.defaultPage")}</span>
    <select id="set-default-page" class="stg-select">
      <option value="instances">🎮 ${t("settings.defaultPage.instances")}</option>
      <option value="workshop">🎨 ${t("settings.defaultPage.workshop")}</option>
      <option value="repository">📦 ${t("settings.defaultPage.repository")}</option>
    </select>
  </div>
  <div class="stg-hint">${t("settings.defaultPageHint")}</div>
</div>

<div class="section-title stg-title stg-sub-title">🕹️ ${t("settings.preview3d.title")}</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:240ms">
  <div class="setting-row">
    <span class="label">🎥 ${t("settings.preview3d.camSpeed")}</span>
    <input type="range" id="td-camspeed" min="2" max="200" value="20" style="flex:1;accent-color:var(--accent,#7c83ff)">
    <span id="td-camspeed-val" style="min-width:28px;text-align:right;color:var(--txt)">20</span>
  </div>
  <div class="stg-hint">${t("settings.preview3d.camSpeedHint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:270ms">
  <div class="setting-row">
    <span class="label">🔄 ${t("settings.preview3d.rotMode")}</span>
    <select id="td-rotmode" class="stg-select" style="width:auto">
      <option value="orbit">${t("settings.preview3d.orbit")}</option>
      <option value="free">${t("settings.preview3d.free")}</option>
    </select>
  </div>
  <div class="stg-hint">${t("settings.preview3d.rotModeHint")}</div>
</div>

<div class="settings-group" style="margin-bottom:12px;animation:card-in var(--tr-enter) both;animation-delay:300ms">
  <div class="setting-row" style="align-items:flex-start;flex-direction:column;gap:8px">
    <span class="label">🎮 ${t("settings.preview3d.keymap")}</span>
    <div id="td-keymap-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;width:100%"></div>
  </div>
  <div class="stg-hint">${t("settings.preview3d.keymapHint")}</div>
  <div style="margin-top:8px"><button class="btn-base sm" id="td-keymap-reset">↩️ ${t("settings.preview3d.resetKeys")}</button></div>
</div>

</div>
</div>
<!-- /stg-tab-ui -->

<!-- stg-tab-about -->
<div class="repo-tab-body" id="stg-tab-about" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">ℹ️ ${t("about.title")}</div>

<div class="stg-grid" style="margin-bottom:12px">
  <div class="stg-card">
    <div class="stg-card-hdr" style="display:flex;align-items:center;gap:8px">
      <span>ℹ️ ${t("about.version")}</span>
      <span id="set-version" style="font-size:var(--fs-lg);font-weight:700;color:var(--accent)">${t("common.loading")}</span>
    </div>
    <div class="stg-card-body" style="display:flex;align-items:center;gap:8px">
      <button class="btn-base sm stg-btn" id="set-check-update">🔄 ${t("about.checkUpdate")}</button>
      <button class="btn-base sm" id="set-releases" title="打开 GitHub Releases">📋 ${t("about.releasePage")}</button>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:2;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">🛠️ ${t("about.features")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <b>${t("about.appName")}</b> ${t("about.intro")}
      <br><br>
      ✅ ${t("about.f1")}<br>
      ✅ ${t("about.f2")}<br>
      ✅ ${t("about.f3")}<br>
      ✅ ${t("about.f4")}<br>
      ✅ ${t("about.f5")}<br>
      ✅ ${t("about.f6")}<br>
      ✅ ${t("about.f7")}
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:90ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">💎 ${t("about.techStack")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <div>🔹 ${t("about.tech1")}</div>
      <div>🔹 ${t("about.tech2")}</div>
      <div>🔹 Web Components + Shadow DOM</div>
      <div>🔹 ${t("about.tech4")}</div>
      <div>🔹 ${t("about.tech5")}</div>
      <div>🔹 ${t("about.tech6")}</div>
    </div>
  </div>
</div>

<div style="display:flex;gap:12px;margin-bottom:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:120ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">📦 ${t("about.links")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.8">
      <div>🐙 ${t("about.ghRepo")}：<a href="${GH_REPO}" target="_blank" style="color:var(--accent)">eghrhegpe/ysm-model-manager</a></div>
      <div>📋 ${t("about.releases")}：<a href="${GH_RELEASES}" target="_blank" style="color:var(--accent)">${t("about.releasesLink")}</a></div>
      <div>📖 ${t("about.docs")}：<a href="${GH_DOCS}" target="_blank" style="color:var(--accent)">${t("about.docsLink")}</a></div>
      <div>📄 ${t("about.config")}：<code>${t("about.configPath")}</code></div>
    </div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:150ms">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">💡 ${t("about.quickStart")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7">
      <div>1. ${t("about.qs1")}</div>
      <div>2. ${t("about.qs2")}</div>
      <div>3. ${t("about.qs3")}</div>
      <div>4. ${t("about.qs4")}</div>
      <div>5. ${t("about.qs5")}</div>
    </div>
  </div>
</div>

</div>
</div>
<!-- /stg-tab-about -->

<!-- stg-tab-credits -->
<div class="repo-tab-body" id="stg-tab-credits" style="display:none;overflow-y:auto">
<div class="stg-page" style="padding:16px 20px">

<div class="section-title stg-title">🎯 ${t("credits.inspiration")}</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">⬇️ ${t("credits.download")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      <a href="https://github.com/LaoYutang/lytvpk" target="_blank" style="color:var(--accent)">LaoYutang/lytvpk</a><br>
      ${t("credits.downloadDesc")}
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">🎨 ${t("credits.render3d")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      <a href="https://github.com/DrAbcOfficial/YSMViewer" target="_blank" style="color:var(--accent)">DrAbcOfficial/YSMViewer</a><br>
      ${t("credits.render3dDesc")}
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">🔐 ${t("credits.parse")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      YSMParser.Core<br>
      ${t("credits.parseDesc")}
    </div>
  </div>
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">📦 ${t("credits.repo")}</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      Mod Organizer 2<br>
      ${t("credits.repoDesc")}
    </div>
  </div>
</div>

<div class="section-title stg-title stg-sub-title">🙏 ${t("credits.special")}</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">👤 zuogeren1</div>
    <div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.5">
      ${t("credits.contribute")}<br>
      <a href="https://github.com/zuogeren1" target="_blank" style="color:var(--accent)">@zuogeren1</a>
    </div>
  </div>
</div>

</div>
</div>
<!-- /stg-tab-credits -->

</div>`;
}

export function downloadsHTML(): string {
  return `<div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
<div id="dl-form" style="margin:4px 12px;display:none;flex-direction:column;gap:4px">
  <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;flex-wrap:wrap">
    <span>${t("import.renameGuide")}</span>
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-from-header"> ${t("downloads.readAuthor")}
    </label>
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-date-auto" checked> ${t("downloads.today")}
    </label>
  </div>
  <div style="display:flex;gap:4px">
    <input id="dl-author" placeholder="${t("import.author")}" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-work" placeholder="${t("import.brand")}" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-chara" placeholder="${t("import.character")}" style="width:80px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-variant" placeholder="${t("import.variant")}" style="width:60px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-date" placeholder="${t("import.date")}" style="width:64px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
  </div>
  <div id="dl-tips" style="display:none;font-size:10px;color:var(--muted);padding:4px 8px;margin:2px 0;border-radius:4px;border-left:3px solid var(--accent);background:var(--surf);line-height:1.5;max-height:60px;overflow-y:auto"></div>
  <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;background:var(--surf);overflow:hidden">
    <span style="color:var(--muted);font-size:9px;white-space:nowrap">${t("import.preview")}</span>
    <span id="dl-preview" style="font-weight:600;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-</span>
    <span id="dl-conflict" style="display:none;font-size:9px;color:#f9a826;white-space:nowrap">⚠️</span>
    <button class="btn-base accent sm" id="dl-import" style="white-space:nowrap">📥 ${t("import.importBtn")}</button>
    <span style="font-size:9px;color:var(--muted);white-space:nowrap">${t("import.queue")} <span id="dl-queue-count">0</span></span>
    <button class="btn-base sm" id="dl-cancel" style="white-space:nowrap">✕</button>
  </div>
</div>
<div style="margin:0 12px 4px;border-top:1px solid var(--bd);padding-top:4px">
  <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--txt);padding:2px 0">
    <span style="font-size:var(--fs-md)">📋 ${t("import.imported")}</span>
    <span id="dl-count" style="font-size:10px;color:var(--muted);font-weight:400">${t("downloads.fileCount", { n: 0 })}</span>
    <button class="btn-base sm" id="dl-clear-list" style="margin-left:auto">🗑️ ${t("common.clear")}</button>
  </div>
  <div id="dl-imported-list" style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto"></div>
</div>
<div id="dl-drop" style="flex:1;margin:4px 12px;border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;transition:all .2s;cursor:pointer;min-height:80px">
  <div style="font-size:28px;opacity:.35">📥</div>
  <div style="font-size:11px;color:var(--muted)">${t("downloads.dropHint", { exts: ALL_EXTS.join(" ") })}</div>
  <div style="display:flex;gap:8px;align-items:center">
    <span style="font-size:9px;color:var(--muted)">📁 ${t("downloads.folderHint")}</span>
  </div>
  <div style="font-size:10px;color:#bd93f9;margin-top:2px">💡 ${t("downloads.mmdHint")}</div>
  <input type="file" id="dl-file-input" accept="${ALL_EXTS.join(",")}" style="display:none">
  <input type="file" id="dl-folder-input" webkitdirectory style="display:none">
</div>
</div>
</div>`;
}

export function diagnosticsHTML(): string {
  return `<div class="repo-wrap">
<div class="repo-tabs">
<button class="repo-tab active" data-tab="diagnostics">🛠️ ${t("diagnostics.title")}</button>
</div>
<div class="repo-tab-body">
<div class="diag-wrapper">
<div class="diag-left">
<button class="diag-btn active" data-diag="log">
<span class="diag-btn-icon">📋</span>
<span>${t("diagnostics.opsLog")}</span>
</button>
<button class="diag-btn" data-diag="runtime">
<span class="diag-btn-icon">🕹️</span>
<span>${t("diagnostics.runtimeLog")}</span>
</button>
<button class="diag-btn" data-diag="conflict">
<span class="diag-btn-icon">⚡</span>
<span>${t("diagnostics.conflict")}</span>
</button>
<div class="diag-left-spacer"></div>
<button class="diag-btn diag-btn-action" id="diag-copy" title="${t("diagnostics.copyLog")}">
<span>${t("diagnostics.copyLog")}</span>
</button>
<button class="diag-btn diag-btn-action" id="diag-refresh">
<span>${t("diagnostics.refresh")}</span>
</button>
<button class="diag-btn diag-btn-action" id="diag-clear">
<span>${t("diagnostics.clearLog")}</span>
</button>
</div>
<div class="diag-right">
<div class="diag-panel" id="diag-log">
<div class="diag-log-filter" style="display:flex;gap:4px;padding:3px 12px;overflow:hidden">
<button class="diag-log-fbtn active" data-status="all">${t("diagnostics.all")}</button>
<button class="diag-log-fbtn" data-status="success">✅ ${t("diagnostics.success")}</button>
<button class="diag-log-fbtn" data-status="failed">❌ ${t("diagnostics.failed")}</button>
<button class="diag-log-fbtn" data-status="skipped">⏭️ ${t("diagnostics.skipped")}</button>
<input id="diag-log-search" placeholder="🔍 ${t("diagnostics.searchPlaceholder")}" style="width:130px;font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);margin-left:auto">
</div>
<div id="diag-log-list" style="overflow-y:auto;flex:1"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.noLogs")}</div></div>
</div>
<div class="diag-panel" id="diag-runtime" style="display:none">
<div id="diag-runtime-list" style="overflow-y:auto;flex:1"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.noRuntimeLogs")}</div></div>
</div>
<div class="diag-panel" id="diag-conflict" style="display:none">
<div id="diag-conflict-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.scanHint")}
<button class="btn-base accent" id="diag-scan-conflict" style="margin-top:4px">⚡ ${t("diagnostics.startScan")}</button>
</div></div></div>
<div class="diag-panel" id="diag-oldest" style="display:none">
<div class="diag-panel-header">
<span>👴 ${t("repo.tab.oldest")}</span>
<button class="btn-base" id="diag-oldest-refresh">🔄</button>
</div>
<div id="diag-oldest-list"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.refreshHint")}</div></div>
</div>
</div>
</div>
</div>
</div>`;
}

export function recycleHTML(): string {
  return `<div class="recy-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span id="recy-count" style="font-size:11px;color:#6c7086">${t("common.loading")}</span>
<button class="btn-base sm" id="recy-refresh" style="margin-left:auto">🔄 ${t("common.refresh")}</button>
<button class="btn-base danger sm" id="recy-empty">♻️ ${t("recycle.empty")}</button>
</div>
<div id="recy-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
</div>`;
}

/* ===== GitHub 仓库页面 ===== */

export function githubHTML(): string {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="github">🐙 ' + t("workshop.title") + '</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="gh-tab-repos">' +
    '<div class="gh-page" id="gh-page">' +
    '<div class="gh-left" id="gh-left">' +
    '<div class="gh-left-head">' +
    '<span class="gh-left-head-label">' + t("gh.leftHead") + '</span>' +
    '<span class="gh-left-head-spacer"></span>' +
    "</div>" +
    '<div class="gh-grid" id="gh-grid">' +
    '<div class="gh-loading-placeholder">⏳ ' + t("common.loading") + '</div>' +
    "</div>" +
    '<div class="gh-left-foot">' +
    t("gh.sourceInfo") + ': <span id="gh-source-info">-</span>' +
    "</div>" +
    "</div>" +
    '<div class="gh-right" id="gh-right">' +
    '<div class="gh-right-inner" id="gh-right-inner">' +
    '<div id="gh-results">' +
    '<div id="gh-results-body">' +
    '<div class="gh-initial-hint">' + t("gh.initialHint") + "</div>" +
    "</div></div></div></div></div>" +
    "</div>" +
    "</div>"
  );
}

export function workshopHTML(): string {
  // 站点 Tab 由 _initWorkshop 动态生成，此处只放容器
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs" id="ws-tabs">' +
    '<span style="padding:4px 12px;font-size:var(--fs-sm);color:var(--muted)">⏳ ' + t("common.loading") + '</span>' +
    "</div>" +
    // 站点配置导入/导出工具栏（index.ts ws-export-btn / ws-import-btn 绑定）
    '<div style="display:flex;gap:6px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-shrink:0">' +
    '<button class="btn-base sm" id="ws-export-btn" title="' + t("workshop.exportSiteTitle") + '">📤 ' + t("workshop.exportSite") + '</button>' +
    '<button class="btn-base sm" id="ws-import-btn" title="' + t("workshop.importSiteTitle") + '">📥 ' + t("workshop.importSite") + '</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="cr-tab-creators">' +
    '<div class="cr-page" id="ws-page">' +
    '<div class="cr-right" style="width:100%;flex:1;display:flex;flex-direction:column;overflow:hidden" id="ws-right">' +
    '<div class="cr-right-inner" id="ws-right-inner">' +
    '<div id="ws-search-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    '<div id="ws-search-results" style="flex:1;overflow-y:auto;padding:0 12px 8px">' +
    '<div style="color:var(--muted);font-size:10px;padding:12px 0;text-align:center">' + t("common.loading") + '</div>' +
    "</div>" +
    "</div>" +
    '<div id="ws-creator-view" style="display:none;flex:1;display:none;flex-direction:column;overflow:hidden">' +
    '<div style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<span style="font-size:12px;font-weight:600;color:var(--txt)" id="ws-cr-title">🎨 ' + t("workshop.activeCreators") + '</span>' +
    '<span style="font-size:9px;color:var(--muted);margin-left:auto">creators/</span>' +
    "</div>" +
    '<div class="ws-creators-list" id="ws-cr-list"></div>' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div id="ws-browser" style="display:none;flex:1;flex-direction:column;overflow:hidden;position:absolute;inset:0;z-index:10;background:var(--bg)">' +
    '<div class="ws-browser-bar">' +
    '<button class="btn-base sm ws-back" id="ws-back">← ' + t("common.back") + '</button>' +
    '<span class="ws-url" id="ws-url"></span>' +
    '<button class="btn-base sm ws-btn-txt" id="ws-win-open" title="' + t("workshop.openWindow") + '">🖥️</button>' +
    '<button class="btn-base sm ws-open-btn" id="ws-open">↗ ' + t("workshop.openBrowser") + '</button>' +
    "</div>" +
    // [ADR-077] allow-same-origin 必需：缺此标记时 iframe origin 被强制为 null（opaque origin），
    // 登录站 SPA（如模之屋 aplaybox）的 fetch/XHR 会被浏览器 CORS 拦截白屏；
    // 父窗口(wails://)与 iframe(外部真实域)本就不同源，补此标记不会让 iframe 反向访问父窗口。
    '<iframe id="ws-iframe" style="flex:1;border:none;background:var(--bg)" sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>' +
    '<div id="ws-blocked" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">' +
    '<div style="font-size:32px">🚫</div>' +
    "<div>" + t("workshop.noEmbed") + "</div>" +
    '<button class="btn-base accent" id="ws-open-fallback">↗ ' + t("workshop.openExternal") + '</button>' +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}
