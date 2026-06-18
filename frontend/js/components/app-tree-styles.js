// ===== app-tree 样式（独立文件，避免 JS 热更新时重编译 CSS） =====
export const treeCSS = `
:host {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.hdr { padding: 10px 14px; border-bottom: 1px solid color-mix(in srgb, var(--accent) 22%, var(--bd)); background: linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--bg) 96%, transparent)); box-shadow: inset 0 -1px 0 rgba(255,255,255,.03); }
.hdr-row { display:flex; align-items:center; gap:8px; }
.hdr-row + .hdr-row { margin-top:4px; }
.hdr-label { font-size:12px;font-weight:600;color:var(--txt);flex-shrink:0; }
.hdr-spacer { flex:1; }
.repo-bar-btn { padding:var(--pad-btn-tool) 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-btn-tool); }
.repo-bar-btn:hover { background:var(--hover);color:var(--txt); }
/* 高级筛选面板 */
.adv-filter { border-top:1px solid var(--bd);padding:6px 8px 4px;background:var(--bg2); }
.adv-filter-row { display:flex;align-items:center;gap:4px;flex-wrap:wrap; }
.adv-filter-row label { font-size:10px;color:var(--muted);white-space:nowrap;margin-left:6px; }
.adv-filter-row label:first-child { margin-left:0; }
.af-inp { width:56px;padding:2px 4px;font-size:10px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--txt);font-family:inherit; }
.af-inp::placeholder { color:var(--muted);font-size:9px; }
.af-sep { font-size:10px;color:var(--muted); }
/* ===== 统一按钮系统 .btn-base ===== */
.btn-base { min-height:34px; padding:7px 12px; border-radius:10px; border:1px solid color-mix(in srgb, var(--accent) 26%, var(--bd)); background:linear-gradient(180deg, color-mix(in srgb, var(--card) 88%, var(--accent)), color-mix(in srgb, var(--card) 96%, transparent)); color:var(--txt); cursor:pointer; font-size:inherit; font-family:inherit; font-weight:650; transition:transform .14s ease, background .14s ease, color .14s ease, border-color .14s ease, box-shadow .14s ease; white-space:nowrap; flex-shrink:0; box-shadow:0 1px 0 rgba(255,255,255,.06) inset, 0 8px 18px rgba(0,0,0,.12); }
.btn-base:hover { transform:translateY(-1px); background:color-mix(in srgb, var(--accent) 14%, var(--card)); border-color:var(--accent); box-shadow:0 10px 26px rgba(0,0,0,.18), 0 0 18px color-mix(in srgb, var(--accent) 20%, transparent); }
.btn-base:focus-visible { box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); outline:none; }
.btn-base.sm { padding:7px 12px; font-size:12px; }
.btn-base.lg { padding:var(--btn-padding-lg); font-size:var(--fs-btn-primary); }
.btn-base.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.btn-base.primary:hover { background:color-mix(in srgb, var(--accent) 88%, #fff); }
.btn-base.accent { background:#7c83ff33;color:#66d9ef;border-color:#7c83ff55; }
.btn-base.accent:hover { background:#7c83ff55; }
.btn-base:disabled { opacity:0.5; cursor:not-allowed; pointer-events:none; }
/* ===== 旧按钮兼容层 ===== */
.hdr-btn { padding:var(--pad-btn-primary) 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-btn-primary);font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.hdr-btn.accent { background:#7c83ff33;color:#66d9ef;border-color:#7c83ff55; }
.hdr-btn.accent:hover { background:#7c83ff55; }
.hdr-btn.flash { background:#a6e3a133;border-color:#a6e3a155; }
.srch-inp { flex:1;padding:8px 11px;border-radius:10px;border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));background:color-mix(in srgb, var(--bg) 82%, transparent);color:var(--txt);font-size:12px;outline:none;min-width:0; box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
.srch-inp:focus { border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent), inset 0 1px 0 rgba(255,255,255,.04); }
.sort-sel { min-height:34px;padding:7px 10px;border-radius:10px;border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));background:color-mix(in srgb, var(--card) 90%, transparent);color:var(--txt);font-size:12px;cursor:pointer;color-scheme:light; }
.hdr-btn { padding:var(--pad-btn-primary) 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-btn-primary);font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.hdr-btn.accent { background:#7c83ff33;color:#66d9ef;border-color:#7c83ff55; }
:host-context(.theme-warm) .hdr-btn.accent { color:#8b4513; }
:host-context(.theme-pro) .hdr-btn.accent { color:#ffffff; }
.hdr-btn.accent:hover { background:#7c83ff55; }
.hdr-btn.flash { background:#a6e3a133;border-color:#a6e3a155; }
.dd-wrap { position:relative;display:inline-block; }
.dd-wrap:hover .dd-menu { display:block; }
.dd-menu { position:absolute;top:calc(100% + 6px);left:0;z-index:100;background:color-mix(in srgb, var(--surf) 94%, var(--accent));border:1px solid color-mix(in srgb, var(--accent) 30%, var(--bd));border-radius:12px;padding:6px;box-shadow:0 16px 44px rgba(0,0,0,.36), 0 0 30px color-mix(in srgb, var(--accent) 14%, transparent);display:none;min-width:156px;max-height:260px;overflow-y:auto; backdrop-filter:blur(14px); }
.dd-menu.show { display:block; }
.dd-item { display:block;width:100%;padding:8px 11px;border:none;background:transparent;color:var(--txt);cursor:pointer;font-size:12px;text-align:left;border-radius:9px; font-weight:600; }
.dd-item:hover { background:color-mix(in srgb, var(--accent) 16%, transparent); }
.batch-dropdown { position: relative; }
.batch-menu { position: absolute; top: 100%; left: 0; z-index: 100; background: var(--card); border: 1px solid var(--bd); border-radius: 6px; padding: 3px; min-width: 120px; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.batch-item { display: block; width: 100%; text-align: left; padding: 4px 10px; border: none; border-radius: 4px; margin-bottom: 1px; font-size: var(--fs-sm); color: var(--txt); cursor: pointer; background: transparent; font-family: inherit; }
.batch-item:hover { background: #7c83ff33; color: var(--accent); }
.srch-row { display: flex; align-items: center; gap: 8px; }
.srch-inp { flex:1;padding:8px 11px;border-radius:10px;border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));background:color-mix(in srgb, var(--bg) 82%, transparent);color:var(--txt);font-size:12px;outline:none;min-width:0;font-family:inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
.srch-inp::placeholder { color: var(--muted); }
.sort-sel { min-height:34px;padding:7px 10px;border-radius:10px;border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));background:color-mix(in srgb, var(--card) 90%, transparent);color:var(--txt);font-size:12px;outline:none;font-family:inherit;cursor:pointer;color-scheme:light; }
.sort-sel { color-scheme:dark; }
.sort-sel option { background:var(--native-option-bg,#0f172a) !important; color:var(--native-option-txt,#f8fafc) !important; }
.sort-sel option:checked { background:var(--native-option-active-bg,#64748b) !important; color:var(--native-option-active-txt,#ffffff) !important; }
.sort-sel option:hover, .sort-sel option:focus { background:var(--native-option-active-bg,#64748b) !important; color:var(--native-option-active-txt,#ffffff) !important; }
.sort-sel option:disabled { background:var(--native-option-bg,#0f172a) !important; color:color-mix(in srgb,var(--native-option-txt,#f8fafc) 58%,transparent) !important; opacity:1; }
:host-context(.theme-warm) .sort-sel { color-scheme:light; }
.tag { font-size: var(--fs-tiny); background: #f9a82633; color: #f9a826; padding: 0 4px; border-radius: 3px; margin-left: 2px; }
.list { flex: 1; overflow-y: auto; padding: 8px 8px; }
/* 虚拟滚动外层容器 */
.vs-wrap { box-sizing: border-box; }
.empty { text-align: center; padding: 40px 16px; font-size: 12px; color: var(--muted); line-height: 1.8; }
.empty .big { font-size: 36px; margin-bottom: 8px; }
.fh { display: flex; align-items: center; gap: 7px; min-height:34px; padding: 4px 8px; border-radius: 10px; cursor: pointer; font-size: var(--fs-base); transition: background .14s ease, border-color .14s ease, transform .14s ease; border:1px solid transparent; border-left: 2px solid transparent; }
.fh:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); border-color:color-mix(in srgb, var(--accent) 22%, transparent); transform:translateX(1px); }
.fh.has-items { border-left-color: #a6e3a166; }
.fh .ar { font-size: var(--fs-sm); color: var(--muted); width: 12px; flex-shrink: 0; text-align: center; transition: transform .12s; }
.fh .ar.open { transform: rotate(90deg); }
.fh .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--txt); }
.fh .nm .tag-author,.fh .nm .tag-work,.fh .nm .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.fh .nm .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.fh .nm .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.fh .nm .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.fh .nm mark { background: #f9a82644; color: #f9a826; border-radius: 2px; padding: 0 2px; }
.fh.locked { opacity: .5; }
.fh.locked .nm { color: var(--muted); }
.fl { display: flex; align-items: center; gap: 8px; min-height:34px; padding: 4px 8px; border-radius: 10px; font-size: var(--fs-base); transition: background .14s ease, outline-color .14s ease, transform .14s ease; cursor: default; user-select: none; -webkit-user-select: none; }
.fl:hover { background: color-mix(in srgb, var(--accent) 9%, transparent); transform:translateX(1px); }
.fl.flash { background: #a6e3a122; }
.fl.selected { background: color-mix(in srgb, var(--accent) 16%, transparent); outline: 1px solid color-mix(in srgb, var(--accent) 34%, transparent); box-shadow:0 0 18px color-mix(in srgb, var(--accent) 10%, transparent); }
.fl .ck, .fh .ck { width: 22px; height: 12px; border-radius: 6px; background: var(--muted); cursor: pointer; flex-shrink: 0; position: relative; transition: background .15s; font-size: 0; line-height: 0; }
.fl .ck::after, .fh .ck::after { content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--txt); transition: left .15s; }
.fl .ck.on, .fh .ck.on { background: #a6e3a1; }
.fl .ck.on::after, .fh .ck.on::after { left: 12px; }
.fh .ck.partial { background: #f9a826; }
.fh .ck.partial::after { left: 7px; }
.fl .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl .nm .tag-author,.fl .nm .tag-work,.fl .nm .tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.fl .nm .nm-tag, .fl .nm .tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.fl .nm .nm-bracket, .fl .nm .tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.fl .nm .tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.fl .nm .tag-ext { color: var(--muted); font-size: 0.85em; }
.fl .nm.ysm { color: var(--txt); }
.fl .sz { font-size: var(--fs-xs); white-space: nowrap; flex-shrink: 0; text-shadow:0 1px 2px rgba(0,0,0,.12); }
.fl .sz.sz-green { color: var(--sz-green,#a6e3a1); }
.fl .sz.sz-red { color: var(--sz-red,#f38ba8); }
.fl .sz:not(.sz-green):not(.sz-red) { color: var(--muted); }
.fl .dt { font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; flex-shrink: 0; }
/* 悬停快捷操作 */
.hover-actions { display: none; gap: 2px; flex-shrink: 0; align-items: center; }
.fl:hover .hover-actions { display: flex; }
.ha-btn { font-size: 13px; min-width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; padding: 0 4px; border-radius: 8px; cursor: pointer; opacity: .72; transition: all .12s; border:1px solid transparent; }
.ha-btn:hover { opacity: 1; background: color-mix(in srgb, var(--accent) 16%, transparent); border-color:color-mix(in srgb, var(--accent) 26%, transparent); }
.ficon { font-size: 14px; width:20px; text-align:center; }
.folder-plain-icon { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; font-size:15px; }
.folder-cover-icon { width:24px; height:24px; border-radius:7px; object-fit:cover; flex-shrink:0; border:1px solid color-mix(in srgb, var(--accent) 28%, var(--bd)); box-shadow:0 0 14px color-mix(in srgb, var(--accent) 14%, transparent); }
.ftr { padding: 8px 12px; border-top: 1px solid var(--bd); display: flex; gap: 6px; align-items: center; }
.ftr .stat { font-size: var(--fs-sm); color: var(--muted); margin-right: auto; }
.type-bar { padding:2px 12px;gap:4px;display:flex;align-items:center;border-bottom:1px solid var(--bd); }

/* ===== 2026 UI pass: repository tree work surface ===== */
:host {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 42%),
    var(--bg);
}
.hdr {
  padding:12px 14px;
  position:relative;
  z-index:2;
}
.hdr-row {
  gap:10px;
  flex-wrap:wrap;
}
.srch-inp {
  min-width:220px;
  min-height:38px;
  font-size:13px;
  font-weight:650;
}
.sort-sel {
  min-width:92px;
  font-weight:700;
}
#btn-adv-filter,
#btn-authors,
#btn-batch,
#btn-more {
  min-height:38px;
}
.dd-wrap {
  flex-shrink:0;
}
#dd-more .dd-menu,
#dd-batch .dd-menu {
  right:0;
  left:auto;
}
.adv-filter {
  margin-top:10px;
  padding:10px !important;
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd));
  border-radius:14px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 48%),
    color-mix(in srgb, var(--surf) 86%, transparent);
  box-shadow:0 12px 30px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.035);
}
.adv-filter-row {
  gap:8px;
}
.adv-filter-row label {
  min-height:30px;
  display:inline-flex;
  align-items:center;
  margin-left:8px;
  padding:0 8px;
  border-radius:9px;
  border:1px solid color-mix(in srgb, var(--accent) 13%, var(--bd));
  background:color-mix(in srgb, var(--bg) 60%, transparent);
  font-size:11px;
  font-weight:750;
  letter-spacing:0;
}
.af-inp {
  width:72px;
  min-height:32px;
  padding:5px 8px;
  border-radius:10px;
  border-color:color-mix(in srgb, var(--accent) 22%, var(--bd));
  background:color-mix(in srgb, var(--bg) 78%, transparent);
  font-size:12px;
  font-weight:650;
}
.af-inp:focus {
  outline:none;
  border-color:var(--accent);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}
.af-sep {
  font-size:12px;
}
.list {
  padding:10px 10px 12px;
}
.fh,
.fl {
  margin-bottom:7px;
  min-height:42px;
  border:1px solid color-mix(in srgb, var(--accent) 14%, var(--bd));
  border-radius:13px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 90%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent));
  box-shadow:0 7px 18px rgba(0,0,0,.1), inset 0 1px 0 rgba(255,255,255,.03);
}
.fh:hover,
.fl:hover {
  border-color:color-mix(in srgb, var(--accent) 34%, var(--bd));
  background:color-mix(in srgb, var(--accent) 10%, var(--card));
  box-shadow:0 11px 26px rgba(0,0,0,.15), 0 0 16px color-mix(in srgb, var(--accent) 9%, transparent);
}
.fh.locked,
.fl.ban {
  opacity:.58;
  filter:saturate(.75);
}
.fl.selected {
  border-color:color-mix(in srgb, var(--accent) 46%, var(--bd));
  border-left:3px solid var(--accent);
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 17%, var(--card)), color-mix(in srgb, var(--card) 92%, transparent));
}
.fh .nm,
.fl .nm {
  font-size:13px;
  font-weight:720;
  min-width:0;
}
.fh .ar {
  width:18px;
  height:26px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:8px;
  background:color-mix(in srgb, var(--bg) 58%, transparent);
}
.folder-plain-icon,
.ficon {
  width:28px;
  height:28px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:10px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
}
.folder-cover-icon {
  width:30px;
  height:30px;
  border-radius:10px;
}
.fl .ck,
.fh .ck {
  width:30px;
  height:16px;
  border-radius:999px;
  background:color-mix(in srgb, var(--muted) 78%, var(--bd));
}
.fl .ck::after,
.fh .ck::after {
  top:3px;
  left:3px;
  width:10px;
  height:10px;
}
.fl .ck.on::after,
.fh .ck.on::after {
  left:17px;
}
.fh .ck.partial::after {
  left:10px;
}
.fl .sz,
.fl .dt {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:9px;
  border:1px solid color-mix(in srgb, currentColor 18%, transparent);
  background:color-mix(in srgb, currentColor 8%, transparent);
  font-weight:700;
}
.hover-actions {
  gap:5px;
}
.ha-btn {
  min-width:30px;
  height:30px;
  border-radius:10px;
  background:color-mix(in srgb, var(--bg) 52%, transparent);
}
.ha-btn:hover {
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(0,0,0,.14);
}
.empty {
  margin:18px;
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd));
  border-radius:16px;
  background:color-mix(in srgb, var(--surf) 82%, transparent);
  box-shadow:0 14px 34px rgba(0,0,0,.12);
}
.ftr {
  padding:10px 12px;
  border-top:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd));
  background:linear-gradient(0deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent));
}
.ftr .stat {
  min-height:32px;
  display:inline-flex;
  align-items:center;
  padding:0 10px;
  border-radius:11px;
  border:1px solid color-mix(in srgb, var(--accent) 15%, var(--bd));
  background:color-mix(in srgb, var(--bg) 68%, transparent);
  color:var(--txt);
  font-size:12px;
  font-weight:750;
}
#btn-repo {
  max-width:min(360px, 48vw) !important;
  min-height:36px;
}

@media (max-width: 920px) {
  .srch-inp {
    flex-basis:100%;
  }
  .sort-sel {
    margin-left:auto;
  }
  #btn-repo {
    max-width:52vw !important;
  }
}
`;
