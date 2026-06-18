// ===== sidebar Shadow CSS =====
export const sidebarCSS = `
:host {
  display: flex; flex-direction: column;
  background: var(--surf);
  border-right: 1px solid var(--bd);
  flex: 1;
  min-width: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-base);
}
.list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.vc {
  background: var(--bg); border: 1px solid var(--bd);
  border-radius: 6px; margin-bottom: 4px; overflow: hidden;
}
.vc-header {
  padding: 5px 10px; cursor: pointer; transition: background .12s;
}
.vc-header:hover { background: var(--hover); }
.vc-header.active { background: #7c83ff33; border-left: 3px solid var(--accent); padding-left: 7px; box-shadow: inset 0 0 8px rgba(124,131,255,.08); }
.vc-hdr-row1 { display: flex; align-items: center; }
.vc-hdr-row2 { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.vc-header .name { flex: 1; font-size: var(--fs-md); font-weight: var(--fw-semibold); color: var(--txt); white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag { font-size: var(--fs-xs); padding: 1px 4px; border-radius: 3px; min-width:16px;text-align:center; }
.vc-header .tag.green { background: #6bb86b22; color: #6bb86b; }
.vc-header .tag.red { background: #f38ba822; color: #f38ba8; }
.vc-header .tag.orange { background: #f9a82622; color: #f9a826; }
.vc-hdr-row1 .chk { flex-shrink:0; margin:0; cursor:pointer; }
.footer { padding: 8px 12px; border-top: 1px solid var(--bd); }
.footer-stats { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--fs-base) - 2px); color: var(--muted); margin-bottom: 6px; }
/* ===== 统一按钮系统 .btn-base ===== */
.btn-base { padding:var(--btn-padding-md); border-radius:var(--btn-radius,6px); border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:inherit; font-family:inherit; transition:background .12s,color .12s; white-space:nowrap; flex-shrink:0; }
.btn-base:hover { background:var(--hover); }
.btn-base:focus-visible { box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); outline:none; }
.btn-base.sm { padding:var(--btn-padding-sm); font-size:var(--fs-btn-tool); }
.btn-base.lg { padding:var(--btn-padding-lg); font-size:var(--fs-btn-primary); }
.btn-base.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.btn-base.primary:hover { background:color-mix(in srgb, var(--accent) 88%, #fff); }
.btn-base:disabled { opacity:0.5; cursor:not-allowed; pointer-events:none; }

.footer-btn {
  width: 100%; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--bd); background: transparent;
  color: var(--txt); cursor: pointer; font-size: calc(var(--fs-base) - 2px); font-family: var(--font-ui);
  text-align: center; transition: background .12s;
}
.footer-btn:hover { background: var(--hover); }
/* 骨架屏 */
.sk-item { padding: 10px; margin-bottom: 6px; border-radius: 8px; border: 1px solid var(--bd); background: var(--surf); }
.sk-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bd) 25%, var(--hover) 50%, var(--bd) 75%); background-size: 200% 100%; animation: sk-shimmer 1.5s infinite; margin-bottom: 6px; }
.sk-w80 { width: 80%; }
.sk-w40 { width: 40%; }
@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ===== 2026 UI pass: instance sidebar command surface ===== */
:host {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent)),
    var(--surf);
  border-right:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));
  box-shadow:8px 0 28px rgba(0,0,0,.08);
}
:host > div:first-child {
  min-height:44px;
  padding:10px 12px !important;
  gap:10px !important;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 80%, var(--accent)), color-mix(in srgb, var(--surf) 96%, transparent));
}
:host > div:first-child label {
  min-height:32px;
  padding:0 8px;
  border-radius:10px;
  background:color-mix(in srgb, var(--bg) 68%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 14%, var(--bd));
  font-size:12px !important;
  font-weight:700;
}
#sb-select-all {
  width:16px;
  height:16px;
  accent-color:var(--accent);
}
.sidebar-sync-selected {
  min-height:34px;
  padding:7px 12px !important;
  border-radius:11px !important;
  border:1px solid color-mix(in srgb, var(--accent) 36%, var(--bd)) !important;
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--card)), color-mix(in srgb, var(--card) 94%, transparent)) !important;
  color:var(--txt) !important;
  font-size:12px !important;
  font-weight:800;
  box-shadow:0 8px 18px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.05);
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease, background .14s ease;
}
.sidebar-sync-selected:hover {
  transform:translateY(-1px);
  border-color:var(--accent) !important;
  box-shadow:0 12px 28px rgba(0,0,0,.18), 0 0 18px color-mix(in srgb, var(--accent) 16%, transparent);
}
#sidebar-sync-menu {
  min-width:190px !important;
  padding:8px !important;
  border-radius:14px !important;
  border-color:color-mix(in srgb, var(--accent) 28%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 96%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent)) !important;
  box-shadow:0 16px 36px rgba(0,0,0,.24), 0 0 24px color-mix(in srgb, var(--accent) 10%, transparent) !important;
}
#sidebar-sync-menu .dd-item {
  min-height:30px;
  display:flex;
  align-items:center;
  padding:6px 9px !important;
  border-radius:10px !important;
  font-size:12px;
  font-weight:700;
}
#sidebar-sync-menu .dd-item:hover {
  background:color-mix(in srgb, var(--accent) 14%, var(--card));
  color:var(--txt) !important;
}
.list {
  padding:10px;
}
.vc {
  margin-bottom:9px;
  border-radius:14px;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 84%, var(--accent)), color-mix(in srgb, var(--surf) 96%, transparent));
  box-shadow:0 10px 24px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.035);
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease, background .14s ease;
}
.vc:hover {
  transform:translateX(2px);
  border-color:color-mix(in srgb, var(--accent) 42%, var(--bd));
  box-shadow:0 14px 32px rgba(0,0,0,.17), 0 0 18px color-mix(in srgb, var(--accent) 10%, transparent);
}
.vc-header {
  min-height:54px;
  padding:10px 12px;
  border-radius:13px;
}
.vc-header:hover {
  background:color-mix(in srgb, var(--accent) 9%, transparent);
}
.vc-header.active {
  padding-left:10px;
  border-left:3px solid var(--accent);
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--card)), color-mix(in srgb, var(--card) 92%, transparent));
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent), 0 0 20px color-mix(in srgb, var(--accent) 12%, transparent);
}
.vc-header .name {
  font-size:13px;
  font-weight:850;
}
.vc-hdr-row2 {
  gap:6px;
  margin-top:6px;
  color:var(--muted);
}
.vc-hdr-row1 .chk,
.vc-hdr-row2 .chk {
  width:16px;
  height:16px;
  accent-color:var(--accent);
}
.tag {
  min-height:20px;
  min-width:24px;
  padding:2px 7px;
  border-radius:8px;
  border:1px solid color-mix(in srgb, currentColor 22%, transparent);
  font-weight:800;
}
.tag.gray {
  background:color-mix(in srgb, var(--muted) 14%, transparent);
  color:var(--muted);
}
.footer {
  padding:10px 12px 12px;
  border-top:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd));
  background:linear-gradient(0deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent));
}
.footer-stats {
  gap:8px;
  margin-bottom:0;
}
.stat-item {
  min-height:32px;
  display:flex;
  align-items:center;
  padding:0 10px;
  border-radius:11px;
  border:1px solid color-mix(in srgb, var(--accent) 16%, var(--bd));
  background:color-mix(in srgb, var(--bg) 70%, transparent);
  color:var(--txt);
  font-size:12px;
  font-weight:750;
}
.footer-btn,
.btn-mc-dir {
  min-height:36px;
  border-radius:12px;
  border-color:color-mix(in srgb, var(--accent) 22%, var(--bd));
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 88%, var(--accent)), color-mix(in srgb, var(--card) 96%, transparent));
  font-size:12px;
  font-weight:750;
  overflow:hidden;
  text-overflow:ellipsis;
}
.footer-btn:hover,
.btn-mc-dir:hover {
  border-color:var(--accent);
  background:color-mix(in srgb, var(--accent) 12%, var(--card));
}
.sk-item {
  border-radius:14px;
  border-color:color-mix(in srgb, var(--accent) 16%, var(--bd));
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 82%, var(--accent)), color-mix(in srgb, var(--surf) 96%, transparent));
}
.sk-line {
  background:linear-gradient(90deg, color-mix(in srgb, var(--bd) 75%, transparent) 25%, color-mix(in srgb, var(--accent) 16%, var(--hover)) 50%, color-mix(in srgb, var(--bd) 75%, transparent) 75%);
  background-size:200% 100%;
}
`;
