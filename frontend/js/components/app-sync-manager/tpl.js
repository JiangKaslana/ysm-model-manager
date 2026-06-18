// ===== app-sync-manager 模板 =====

/**
 * 容器骨架
 */
export function containerHTML() {
  return (
    `<style>
.sm-wrap {
  display:flex !important;
  flex-direction:column !important;
  height:100% !important;
  overflow:hidden !important;
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 38%), var(--bg);
}
.sm-tabs,
.sm-status-tabs,
.sm-summary {
  display:flex !important;
  align-items:center !important;
  flex-shrink:0 !important;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
}
.sm-tabs {
  gap:8px !important;
  padding:10px 12px 0 !important;
  overflow-x:auto !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 90%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent));
}
.sm-status-tabs {
  gap:8px !important;
  padding:9px 12px !important;
  font-size:12px !important;
  overflow-x:auto;
  background:color-mix(in srgb, var(--surf) 82%, transparent);
}
.sm-summary {
  gap:8px !important;
  padding:0 !important;
  min-height:0 !important;
}
.sm-list {
  flex:1 !important;
  overflow-y:auto !important;
  padding:10px 12px !important;
}
.sm-tab,
.sm-status-tab,
.sm-item-btn {
  min-height:34px !important;
  border-radius:11px !important;
  border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 86%, var(--accent)), color-mix(in srgb, var(--card) 96%, transparent)) !important;
  color:var(--txt) !important;
  cursor:pointer !important;
  font-family:inherit !important;
  font-weight:750 !important;
  letter-spacing:0 !important;
  transition:transform .14s ease, background .14s ease, border-color .14s ease, box-shadow .14s ease, color .14s ease !important;
}
.sm-tab {
  padding:8px 14px !important;
  border-radius:12px 12px 0 0 !important;
  border-bottom-color:transparent !important;
}
.sm-status-tab {
  padding:7px 12px !important;
  white-space:nowrap !important;
}
.sm-tab:hover,
.sm-status-tab:hover,
.sm-item-btn:hover {
  transform:translateY(-1px);
  border-color:var(--accent) !important;
  background:color-mix(in srgb, var(--accent) 14%, var(--card)) !important;
  box-shadow:0 10px 26px rgba(0,0,0,.18), 0 0 18px color-mix(in srgb, var(--accent) 16%, transparent);
}
.sm-tab.active,
.sm-status-tab.active {
  background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 58%, var(--tag-vup, #ff6bb5))) !important;
  border-color:color-mix(in srgb, var(--accent) 70%, #fff) !important;
  color:#fff !important;
  box-shadow:0 0 22px color-mix(in srgb, var(--accent) 18%, transparent);
}
.sm-item {
  display:flex !important;
  align-items:center !important;
  gap:10px !important;
  min-height:46px !important;
  padding:8px 10px !important;
  margin-bottom:8px;
  border:1px solid color-mix(in srgb, var(--accent) 17%, var(--bd)) !important;
  border-radius:13px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent)) !important;
  box-shadow:0 8px 22px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.035);
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease, background .14s ease !important;
}
.sm-item:hover {
  transform:translateX(2px);
  border-color:color-mix(in srgb, var(--accent) 38%, var(--bd)) !important;
  background:color-mix(in srgb, var(--accent) 10%, var(--card)) !important;
  box-shadow:0 12px 30px rgba(0,0,0,.18), 0 0 18px color-mix(in srgb, var(--accent) 10%, transparent);
}
.sm-item > span:first-child {
  width:24px !important;
  height:24px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:9px;
  background:color-mix(in srgb, currentColor 13%, transparent);
  font-weight:900;
}
.sm-item > span:nth-child(2) {
  width:28px;
  height:28px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:10px;
  background:color-mix(in srgb, var(--accent) 9%, transparent);
  font-size:15px !important;
}
.sm-item > span:nth-child(3) {
  font-size:13px;
  font-weight:750;
}
.sm-item-btn {
  min-height:30px !important;
  padding:6px 11px !important;
  flex-shrink:0;
  font-size:12px !important;
}
.sm-item[data-status="missing"] .sm-item-btn {
  color:var(--accent) !important;
  border-color:color-mix(in srgb, var(--accent) 46%, var(--bd)) !important;
}
.sm-item[data-status="optional"] .sm-item-btn {
  color:var(--sm-optional) !important;
  border-color:color-mix(in srgb, var(--sm-optional) 46%, var(--bd)) !important;
}
.sm-item[data-status="legacy"] .sm-item-btn {
  color:var(--muted) !important;
  border-color:color-mix(in srgb, var(--muted) 34%, var(--bd)) !important;
}
.sm-empty,
.sm-loading,
.sm-error {
  height:100%;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-direction:column;
  gap:8px;
  color:var(--muted);
  font-size:13px;
  padding:24px;
  text-align:center;
}
.sm-empty,
.sm-error {
  margin:18px;
  height:auto;
  min-height:160px;
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd));
  border-radius:16px;
  background:color-mix(in srgb, var(--surf) 86%, transparent);
  box-shadow:0 14px 34px rgba(0,0,0,.14);
}
.sm-empty-icon {
  font-size:28px;
}
</style>` +
    '<div class="sm-wrap" style="display:flex;flex-direction:column;height:100%;overflow:hidden">' +
    // 类型标签栏
    '<div class="sm-tabs" style="display:flex;gap:2px;padding:2px 8px 0;flex-shrink:0;border-bottom:1px solid var(--bd);overflow-x:auto"></div>' +
    '<div class="sm-status-tabs" style="display:flex;gap:2px;padding:3px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 摘要栏
    '<div class="sm-summary" style="display:flex;align-items:center;gap:8px;padding:2px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 列表容器
    '<div class="sm-list" style="flex:1;overflow-y:auto;padding:2px 0"></div>' +
    "</div>"
  );
}

/**
 * 类型标签 HTML
 * @param {string} id
 * @param {string} icon
 * @param {string} label
 * @param {number} count
 * @param {boolean} active
 */
export function tabHTML(id, icon, label, count, active) {
  const cls = active ? " active" : "";
  return (
    '<button class="sm-tab' +
    cls +
    '" data-type="' +
    id +
    '" style="padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:' +
    (active ? "var(--surf)" : "transparent") +
    ";color:" +
    (active ? "var(--accent)" : "var(--muted)") +
    ';cursor:pointer;font-family:inherit;font-size:var(--fs-tab);white-space:nowrap">' +
    icon +
    " " +
    label +
    (count > 0
      ? ' <span style="font-size:var(--fs-tiny);opacity:0.7">(' +
        count +
        ")</span>"
      : "") +
    "</button>"
  );
}

/**
 * 状态筛选标签 HTML
 * @param {string} id - 筛选 ID (all/synced/missing/disabled/optional)
 * @param {string} label - 标签文字
 * @param {number} count - 数量
 * @param {boolean} active - 是否选中
 */
export function statusTabHTML(id, label, count, active) {
  const cls = active ? " active" : "";
  const showCount = count > 0 ? " (" + count + ")" : "";
  return (
    '<button class="sm-status-tab' +
    cls +
    '" data-status="' +
    id +
    '" style="padding:var(--pad-filter) 12px;border-radius:4px;border:1px solid transparent;background:' +
    (active ? "var(--accent)" : "transparent") +
    ";color:" +
    (active ? "#fff" : "var(--muted)") +
    ';cursor:pointer;font-family:inherit;font-size:var(--fs-filter);white-space:nowrap">' +
    label +
    showCount +
    "</button>"
  );
}

/**
 * 统计摘要 HTML
 * @param {{synced:number, missing:number, optional:number, legacy:number}} counts
 */
export function summaryHTML(counts) {
  // 状态标签已展示统计，摘要栏留空
  return "";
}

/**
 * 列表项 HTML
 * @param {{path:string, name:string, status:string, type:string, icon:string, size:number}} item
 */
export function itemHTML(item) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const statusIcon =
    item.status === "synced" ? "✅" : item.status === "legacy" ? "🔗" : "·";
  const statusColor =
    item.status === "synced"
      ? "var(--sz-green)"
      : item.status === "missing"
        ? "var(--accent)"
        : item.status === "legacy"
          ? "var(--muted)"
          : "var(--sm-optional)";
  const sizeStr = item.size > 0 ? formatSize(item.size) : "";
  let actionBtn = "";
  if (item.status === "missing") {
    actionBtn =
      '<button class="sm-item-btn" data-action="push" style="border:1px solid var(--accent);color:var(--accent)">推送</button>';
  } else if (item.status === "optional") {
    actionBtn =
      '<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--sm-optional);color:var(--sm-optional)">拉取</button>';
  } else if (item.status === "legacy") {
    actionBtn =
      '<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--muted);color:var(--muted);font-size:var(--fs-tiny)">拉取到此仓库</button>';
  }
  return (
    '<div class="sm-item" data-path="' +
    esc(item.path) +
    '" data-status="' +
    item.status +
    '" data-type="' +
    item.type +
    '" style="display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default">' +
    '<span style="flex-shrink:0;width:14px;text-align:center;color:' +
    statusColor +
    '">' +
    statusIcon +
    "</span>" +
    '<span style="flex-shrink:0;font-size:var(--fs-base)">' +
    (item.icon || "📦") +
    "</span>" +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
    esc(item.name) +
    "</span>" +
    (sizeStr
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-tiny)">' +
        sizeStr +
        "</span>"
      : "") +
    actionBtn +
    "</div>"
  );
}

/**
 * 空状态 HTML
 * @param {string} msg
 */
export function emptyHTML(msg) {
  return (
    '<div class="sm-empty">' +
    '<div class="sm-empty-icon">📭</div>' +
    "<div>" +
    msg +
    "</div>" +
    "</div>"
  );
}

/**
 * 加载中
 */
export function loadingHTML() {
  return '<div class="sm-loading">⏳ 加载中...</div>';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}
