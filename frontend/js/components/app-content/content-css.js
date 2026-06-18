export const contentCSS = `
:host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:var(--font-ui); font-size:var(--fs-base); line-height:1.4; background:var(--bg); }
/* ===== CSS 变量（标签/标记色） ===== */
:host { --tag-game:#4a9eff; --tag-game-bg:rgba(74,158,255,.13); --tag-vup:#ff6bb5; --tag-vup-bg:rgba(255,107,181,.13); --tag-oc:#a78bfa; --tag-oc-bg:rgba(167,139,250,.13); --tag-amber:#f9a826; --tag-amber-bg:rgba(249,168,38,.2); --accent-btn-bg:#7c83ff33; --accent-btn-color:#66d9ef; --accent-btn-border:#7c83ff55; --sidebar-w:200px; --diag-left-w:120px; --touch-min:44px; }
@keyframes dl-slide-up {
  from { opacity:0; transform:translateY(8px); max-height:0; padding:0 4px }
  to   { opacity:1; transform:translateY(0); max-height:30px; padding:2px 4px }
}
#dl-imported-list > div { animation:dl-slide-up .25s ease-out both; }
.page { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.section-title { font-size:var(--fs-lg); font-weight:600; color:var(--txt); padding:16px 16px 8px; }
.card-row { display:flex; gap:12px; padding:0 16px; }
.stat-card { flex:1; background:var(--surf); border:1px solid var(--bd); border-radius:12px; padding:16px; }
.stat-card .num { font-size:var(--fs-xl); font-weight:700; color:var(--accent); transition:transform .2s cubic-bezier(.34,1.56,.64,1); }
.stat-card .num.bump { transform:scale(1.15); }
.stat-card .label { font-size:var(--fs-base); color:var(--muted); margin-top:2px; }
.stat-card .sub { font-size:var(--fs-sm); color:var(--txt); margin-top:6px; }
.placeholder-box { flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column; color:var(--muted); font-size:var(--fs-md); gap:8px; }
.placeholder-box .big { font-size:48px; }
.ptag { font-size:var(--fs-xs); background:var(--tag-amber-bg); color:var(--tag-amber); padding:2px 8px; border-radius:4px; }
.repo-layout { flex:1; display:flex; overflow:hidden; height:100%; }
.repo-layout-wrap { flex:1; }
.repo-wrap { display:flex;flex-direction:column;flex:1;overflow:hidden; }
.repo-tabs { display:flex;gap:2px;padding:4px 12px 0;border-bottom:1px solid var(--bd);flex-shrink:0;overflow-x:auto;flex-wrap:nowrap; }
.repo-tab { padding:var(--pad-nav) 14px;border-radius:6px 6px 0 0;border:1px solid transparent;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-nav);font-family:inherit;transition:all .15s;white-space:nowrap;min-height:var(--touch-min); }
.repo-tab:hover { color:var(--txt);background:var(--hover); }
.repo-tab.active { color:var(--accent);background:var(--surf);border-color:var(--bd) var(--bd) var(--accent) var(--bd);border-bottom-color:var(--accent);margin-bottom:-1px;font-weight:600; }
.repo-subtab { padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;font-size:var(--fs-tab);transition:all .12s; }
.repo-subtab:hover { color:var(--txt);background:var(--hover); }
.repo-subtab.active { background:var(--surf);color:var(--accent); }
.repo-tab-body { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-sidebar { width:var(--sidebar-w);flex:none; }
.ins-content { flex:1;display:flex;flex-direction:column;overflow:hidden; }
.ins-model-list .sec-title { font-size:var(--fs-sm);color:var(--muted);padding:4px 2px 2px;text-transform:uppercase;letter-spacing:.5px;margin-top:4px; }
.ins-model-list .row { display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:4px;font-size:var(--fs-md);transition:background .12s; }
.ins-model-list .row:hover { background:var(--hover); }
.ins-model-list .row .dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
.ins-model-list .row .rn { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.tag-author,.tag-work,.tag-date { display:inline-block;padding:0 5px;border-radius:3px;font-size:0.9em;text-shadow:0 1px 2px rgba(0,0,0,.12); }
.tag-author { color:var(--meta-author,#66d9ef);background:color-mix(in srgb,var(--meta-author,#66d9ef) 12%,transparent); }
.tag-work { color:var(--meta-work,#bd93f9);background:color-mix(in srgb,var(--meta-work,#bd93f9) 12%,transparent); }
.tag-date { color:var(--meta-date,#f1fa8c);background:color-mix(in srgb,var(--meta-date,#f1fa8c) 12%,transparent); }
.ins-model-list .row.row-prefix .dot { opacity:0.35; }
.ins-model-list .row .status-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .link-icon { font-size:var(--fs-sm);margin-right:4px;flex-shrink:0; }
.ins-model-list .row .sz { font-size:var(--fs-base);color:var(--muted); }
.repo-topbar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-wrap:nowrap;overflow-x:auto; }
.repo-title { font-size:var(--fs-md);font-weight:600;flex-shrink:0; }
.repo-bar { display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--bd); }
.repo-bar:empty { padding:0;border-bottom:none; }
.repo-bar-spacer { flex:1; }
.repo-bar-btn { padding:var(--pad-btn-tool) 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--fs-btn-tool); }
.repo-bar-btn:hover { background:var(--hover);color:var(--txt); }
.repo-spacer { flex:1; }
.repo-btn { font-size:var(--fs-xs);padding:2px 8px; }

.repo-srch { width:160px;padding:4px 8px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-base);outline:none;flex-shrink:0; }
.repo-srch:focus { border-color:var(--accent); }
.repo-sort { padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:var(--fs-sm);cursor:pointer;margin-left:auto; }
.batch-dropdown { position:relative;display:inline-block; }
.batch-menu { position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);min-width:120px; }
.repo-footer { padding:3px 12px;font-size:var(--fs-xs);color:var(--muted);border-top:1px solid var(--bd);flex-shrink:0; }
/* 设置页样式已移至 components.css（全局非 Shadow DOM 区域） */
.settings-group { padding:0 16px; }
.setting-row { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surf); border-radius:6px; margin-bottom:4px; font-size:var(--fs-md); }
.setting-row .label { color:var(--txt); }
.setting-row .value { color:var(--muted); }
/* 诊断页面：左栏按钮 + 右栏信息 */
/* ===== 统一按钮系统 .btn-base ===== */
.btn-base { padding:var(--btn-padding-md); border-radius:var(--btn-radius,6px); border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:inherit; font-family:inherit; transition:background .12s,color .12s; white-space:nowrap; flex-shrink:0; }
.btn-base:hover { background:var(--hover); }
.btn-base:focus-visible { box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); outline:none; }
/* 尺寸变体 */
.btn-base.sm { padding:var(--btn-padding-sm); font-size:var(--fs-btn-tool); }
.btn-base.lg { padding:var(--btn-padding-lg); font-size:var(--fs-btn-primary); }
/* 语义变体 */
.btn-base.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.btn-base.primary:hover { background:color-mix(in srgb, var(--accent) 88%, #fff); }
.btn-base.danger { background:color-mix(in srgb, var(--status-error, #e5534b) 15%, transparent); color:var(--status-error, #e5534b); border-color:color-mix(in srgb, var(--status-error, #e5534b) 40%, transparent); }
.btn-base.danger:hover { background:color-mix(in srgb, var(--status-error, #e5534b) 30%, transparent); }
.btn-base.accent { background:var(--accent-btn-bg); color:var(--accent-btn-color); border-color:var(--accent-btn-border); }
.btn-base.accent:hover { background:color-mix(in srgb, var(--accent) 25%, transparent); }
.btn-base:disabled { opacity:0.5; cursor:not-allowed; pointer-events:none; }

/* ===== 旧按钮兼容层（逐步替换为 .btn-base 后删除） ===== */
.hdr-btn { padding:var(--pad-btn-primary) 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-btn-primary); font-family:inherit; }
.hdr-btn:hover { background:var(--hover); }
.hdr-btn.accent { background:var(--accent-btn-bg); color:var(--accent-btn-color); border-color:var(--accent-btn-border); }
.btn { padding:var(--pad-btn-primary) 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-btn-primary); font-family:inherit; transition:background .12s; }
.btn:hover { background:var(--hover); }
.btn.accent { background:var(--accent-btn-bg); color:var(--accent-btn-color); border-color:var(--accent-btn-border); }
.btn.accent:hover { background:#7c83ff55; }
.btn.danger { background:#e5534b22; color:#e5534b; border-color:#e5534b55; }
.btn.danger:hover { background:#e5534b44; }
.log-row { padding:3px 16px; display:flex; gap:6px; font-size:var(--fs-base); align-items:center; border-bottom:1px solid var(--bd); }
.log-row .log-status { font-size:var(--fs-sm); width:20px; text-align:center; }
.log-row .log-msg { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--txt); }
/* tag-* 颜色已由通用 .tag-* 规则覆盖 */
.log-row .log-time { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
/* 设置页卡片三栏网格 */
.stg-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.stg-card { background:var(--surf); border:1px solid var(--bd); border-radius:8px; overflow:hidden; }
.stg-card-hdr { padding:8px 12px; font-size:var(--fs-sm); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); background:var(--bg2,transparent); }
.stg-card-body { padding:8px 12px; }
.stg-card-val { display:flex; align-items:center; gap:4px; padding:var(--pad-btn-secondary) 10px; border:1px solid var(--bd); border-radius:6px; cursor:pointer; font-size:var(--fs-sm); color:var(--txt); background:var(--bg); transition:border-color .12s, background .12s; width:100%; box-sizing:border-box; min-height:0; }
.stg-card-val:hover { border-color:var(--accent); background:var(--hover); }
.stg-card-val.derived:hover { border-color:var(--accent); background:var(--hover); }
.stg-card-val.derived::before { content:"📁 "; }
.stg-card-hint { font-size:var(--fs-xs); color:var(--muted); margin-bottom:6px; }
.stg-card-acts { display:flex; gap:4px; }
.stg-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:6px; line-height:1.4; }
.conflict-row { padding:3px 16px; display:flex; justify-content:space-between; font-size:var(--fs-base); color:var(--txt); }
.conflict-name { color:#f38ba8; }
.conflict-ver { color:var(--muted); }
.conflict-ins { font-size:var(--fs-sm); color:var(--txt); }
.diag-wrapper { flex:1; display:flex; overflow:hidden; }
.diag-left { width:var(--diag-left-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); padding:8px; gap:4px; background:var(--surf); }
.diag-btn { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; border:none; background:transparent; color:var(--muted); font-size:var(--fs-md); cursor:pointer; font-family:inherit; transition:all .12s; width:100%; text-align:left; }
.diag-btn:hover { background:var(--hover); color:var(--txt); }
.diag-btn.active { background:#7c83ff22; color:var(--accent); }
.diag-btn-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.diag-btn-action { justify-content:center; padding:6px; font-size:var(--fs-md); }
.diag-log-fbtn { font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer; }
.diag-log-fbtn:hover { background:var(--hover);color:var(--txt); }
.diag-log-fbtn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
.diag-left-spacer { flex:1; }
.diag-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.diag-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; font-size:var(--fs-md); font-weight:600; color:var(--txt); border-bottom:1px solid var(--bd); flex-shrink:0; }
.stat-row { font-size:var(--fs-md); color:var(--txt); padding:3px 0; display:flex; justify-content:space-between; }
.diag-stat { padding:12px; font-size:var(--fs-base); display:block; text-align:center; }
.diag-stat-muted { color:var(--muted); }

/* ===== 通用卡片系统（元老页原型 → 全项目复用） ===== */
/* ring-fill 动画已废弃，health-ring 改用 breathe-subtle */

/* 基础卡片 — 所有卡片的基础 */
.model-card {
  background:var(--card);
  border:1px solid var(--bd);
  border-radius:8px;
  padding:var(--card-padding,10px 12px);
  text-align:left;
  cursor:pointer;
  transition:all .15s ease;
  box-shadow:var(--card-shadow, none);
}
.model-card:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:var(--card-shadow-hover, none);
}
.model-card .name {
  font-size:var(--fs-base);
  font-weight:600;
  color:var(--txt);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.model-card .meta {
  font-size:var(--fs-xs);
  color:var(--muted);
  margin-top:2px;
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}

/* 紧凑卡片 — 网格布局（2列/3列） */
.model-card-sm {
  padding:var(--card-padding,6px 10px);
  border-radius:8px;
  border:1px solid var(--bd);
  background:var(--card);
  text-align:left;
  cursor:pointer;
  transition:all .15s ease;
  box-shadow:var(--card-shadow, none);
}
.model-card-sm:hover {
  border-color:var(--accent);
  background:var(--hover);
  box-shadow:var(--card-shadow-hover, none);
}
.model-card-sm .name {
  font-size:var(--fs-base);
  font-weight:600;
  color:var(--txt);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.model-card-sm .meta {
  font-size:var(--fs-xs);
  color:var(--muted);
  margin-top:2px;
  display:flex;
  gap:6px;
}
.model-card .actions,
.model-card-sm .actions {
  display:flex;
  gap:6px;
  margin-top:8px;
}
.model-card .actions button,
.model-card-sm .actions button {
  min-height:30px;
  padding:5px 10px;
  border-radius:9px;
  border:1px solid color-mix(in srgb, var(--accent) 24%, var(--bd));
  background:color-mix(in srgb, var(--accent) 10%, var(--card));
  color:var(--txt);
  cursor:pointer;
  font-size:11px;
  font-weight:700;
}
.model-card .actions button:hover,
.model-card-sm .actions button:hover {
  border-color:var(--accent);
  background:color-mix(in srgb, var(--accent) 18%, var(--card));
}

/* 推荐卡片 — 带悬浮动效 */
.rec-card {
  background:var(--surf);
  border:1px solid var(--bd);
  border-radius:10px;
  padding:14px 16px;
  text-align:left;
  min-width:200px;
  cursor:default;
  transition:transform .25s cubic-bezier(.34,1.56,.64,1);
}
.rec-card:hover {
  transform:scale(1.02) translateY(-2px);
}
.rec-card .name { font-size:var(--fs-base); font-weight:600; color:var(--txt); margin-bottom:2px; }
.rec-card .hint { font-size:var(--fs-xs); color:var(--muted); margin-top:4px; }
.rec-card .actions { display:flex; gap:4px; margin-top:6px; }
.rec-card .actions button { font-size:var(--fs-xs); padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; transition:all .12s; }
.rec-card .actions button:hover { border-color:var(--accent); color:var(--accent); background:var(--hover); }
.health-ring { width:80px; height:80px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; position:relative; }
.health-ring-inner { position:absolute; inset:6px; border-radius:50%; background:var(--bg); display:flex; align-items:center; justify-content:center; flex-direction:column; }
.health-tag { display:inline-block; padding:2px 10px; border-radius:10px; font-size:var(--fs-xs); font-weight:600; }
.health-tag.good { background:#a6e3a122; color:#a6e3a1; }
.health-tag.ok { background:#f9a82622; color:#f9a826; }
.health-tag.bad { background:#f38ba822; color:#f38ba8; }
.stat-pill { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:10px; background:var(--surf); border:1px solid var(--bd); font-size:var(--fs-xs); color:var(--muted); }

/* 热力图 */
.hm-wrap { padding:4px 0; }
.hm-month { font-size:7px; color:var(--muted); padding:0 0 2px 0; display:flex; gap:2px; }
.hm-month span { flex:1; text-align:center; }
.hm-grid { display:flex; gap:2px; }
.hm-col { display:flex; flex-direction:column; gap:2px; }
.hm-cell { width:10px; height:10px; border-radius:2px; background:var(--bd); }
.hm-cell.l1 { background:#0e4429; }
.hm-cell.l2 { background:#006d32; }
.hm-cell.l3 { background:#26a641; }
.hm-cell.l4 { background:#39d353; }
.hm-label { font-size:7px; color:var(--muted); padding-top:2px; display:flex; gap:2px; }
.hm-label span { flex:1; text-align:center; }
.hm-legend { display:flex; align-items:center; gap:2px; font-size:7px; color:var(--muted); justify-content:flex-end; }
/* ===== 创作者标签 (cr-tag) ===== */
.cr-tag { display:inline-flex;align-items:center;gap:2px;font-size:9px;padding:0 5px;border-radius:3px;line-height:16px;font-weight:500;flex-shrink:0; }
.cr-tag-game { background:var(--tag-game-bg);color:var(--tag-game); }
.cr-tag-vup { background:var(--tag-vup-bg);color:var(--tag-vup); }
.cr-tag-oc { background:var(--tag-oc-bg);color:var(--tag-oc); }
.cr-tag-filter-row { display:flex;gap:4px;margin:0 0 8px;flex-wrap:wrap;align-items:center; }
.cr-tag-filter-btn { font-size:var(--fs-xs);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .12s; }
.cr-tag-filter-btn:hover { border-color:var(--accent);color:var(--txt);background:var(--hover); }
.cr-tag-filter-btn.active { border-color:var(--accent);color:var(--accent);background:var(--accent);color:#fff; }
/* ===== 创作者频道 (cr-) ===== */
.cr-page { flex:1; display:flex; overflow:hidden; position:relative; }
.cr-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.cr-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cr-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.cr-scroll { flex:1; overflow-y:auto; padding:8px 12px; }
.cr-preset-area { display:flex; gap:6px; flex-wrap:wrap; padding:4px 0 12px; }
.cr-preset-btn { font-size:var(--fs-sm);padding:3px 10px;border-radius:6px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .12s; }
.cr-preset-btn:hover { border-color:var(--accent);color:var(--accent);background:var(--hover); }
.cr-section { margin-bottom:8px; }
.cr-section-title-lg { font-size:13px;font-weight:600;color:var(--txt); }
.cr-section-sub { font-size:var(--fs-sm);color:var(--muted); }
.cr-action-btn { font-size:var(--fs-sm);padding:3px 8px;border-radius:4px;border:1px solid transparent;background:transparent;cursor:pointer;font-family:inherit;transition:all .12s; }
.cr-action-btn-muted { color:var(--muted);border-color:var(--bd); }
.cr-action-btn-muted:hover { background:var(--hover);color:var(--txt); }
.cr-action-btn-accent { color:var(--accent);border-color:var(--accent); }
.cr-action-btn-accent:hover { background:var(--accent);color:var(--bg); }
.cr-creator-card { display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);cursor:pointer;transition:all .12s; }
.cr-creator-card:hover { border-color:var(--accent);background:var(--hover); }
.cr-creator-card.cr-has-repo { border-left:3px solid var(--accent); }
.cr-creator-icon { font-size:18px;width:28px;text-align:center;flex-shrink:0; }
.cr-creator-body { flex:1;min-width:0; }
.cr-creator-name { font-size:var(--fs-md);font-weight:600;color:var(--txt); }
.cr-creator-desc { font-size:var(--fs-xs);color:var(--muted);margin-top:1px; }
.cr-creator-action { font-size:var(--fs-md);color:var(--muted);flex-shrink:0; }
.cr-browse-repo { font-size:var(--fs-xs);padding:2px 6px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit;white-space:nowrap; }
.cr-browse-repo:hover { background:var(--accent);color:var(--bg); }
.cr-edit-btn { font-size:var(--fs-xs);padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit; }
.cr-edit-btn:hover { background:var(--hover);color:var(--txt); }
.cr-toggle { font-size:var(--fs-xs);padding:2px 8px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .12s; }
.cr-toggle:hover { background:var(--accent);color:var(--bg); }
.cr-mode-switch { display:inline-flex;border:1px solid var(--bd);border-radius:6px 6px 0 0;border-bottom:none;overflow:hidden;cursor:pointer;margin-right:2px;flex-shrink:0;align-self:stretch; }
.cr-mode-opt { padding:2px 6px;font-size:10px;font-family:inherit;transition:all .12s;color:var(--muted);background:var(--bg);cursor:pointer;display:flex;align-items:center; }
.cr-mode-opt:hover { color:var(--txt);background:var(--hover); }
.cr-mode-opt.active { color:var(--accent);background:var(--surf);margin-bottom:-1px; }
.cr-mode-opt:first-child { border-right:1px solid var(--bd); }
.cr-browser-bar { display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--surf);border-bottom:1px solid var(--bd);flex-shrink:0; }
.cr-back { padding:4px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.cr-back:hover { background:var(--hover); }
.ws-back, .cr-back-btn, .cr-back-repo, .ws-btn, .ws-btn-txt,
.ws-back-repo { padding:4px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-base);font-family:inherit; }
.ws-back:hover, .cr-back-btn:hover, .cr-back-repo:hover, .ws-btn:hover, .ws-btn-txt:hover,
.ws-back-repo:hover { background:var(--hover); }
.cr-url { flex:1;font-size:var(--fs-sm);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.ws-open-btn, .cr-open-btn { padding:4px 10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-sm);font-family:inherit; }
.ws-open-btn:hover, .cr-open-btn:hover { background:var(--hover); }
/* 工坊仓库页工具按钮 */
.btn-sm,.ws-btn-sm,.gh-btn-sm { padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-size:var(--fs-xs);font-family:inherit;transition:all .12s;white-space:nowrap; }
.btn-sm:hover,.ws-btn-sm:hover,.gh-btn-sm:hover { background:var(--hover); }
.ws-btn-muted { color:var(--muted); }
.ws-btn-muted:hover { color:var(--txt); }
.ws-btn-accent { color:var(--accent);border-color:#7c83ff55;background:#7c83ff22; }
.ws-btn-accent:hover { background:#7c83ff44; }
.ws-dl-selected[disabled], .ws-btn-sm[disabled], .btn-sm[disabled] { opacity:.4;cursor:default; }
.ws-dl-selected[disabled]:hover, .ws-btn-sm[disabled]:hover, .btn-sm[disabled]:hover { background:transparent; }
.ws-filter-btn { position:relative; }

/* ===== 创意工坊 GitHub (gh-) ===== */
.gh-page { flex:1; display:flex; overflow:hidden; position:relative; }
.gh-left { width:var(--sidebar-w); flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--bd); overflow:hidden; background:var(--surf); }
.gh-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-right-inner { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.gh-grid { flex:1; overflow-y:auto; padding:4px 8px; display:flex; flex-direction:column; gap:4px; }
.gh-card { display:flex; align-items:center; gap:var(--card-gap,8px); padding:var(--card-padding,7px 10px); border-radius:8px; border:1px solid var(--bd); background:var(--card); cursor:pointer; transition:all .15s ease; box-shadow:var(--card-shadow, none); transform:translateZ(0); contain:layout paint style; }
.gh-card:hover { border-color:var(--accent); background:var(--hover); box-shadow:var(--card-shadow-hover, none); margin-top:-1px; }
.gh-card.active { border-color:var(--accent); background:var(--accent); color:#fff; box-shadow:var(--card-shadow-hover, none); }
.gh-card .name { font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--txt); font-family:var(--font-display); overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.gh-card .name + .meta { margin-top:1px; font-size:var(--fs-xs); color:var(--muted); }
.cr-avatar { width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--muted);background:var(--surf);z-index:1;transition:all .25s ease; }
.cr-avatar-container { position:relative;display:inline-flex;flex-shrink:0;align-self:flex-start;width:28px;height:28px;margin:6px; }
.cr-avatar-ring { position:absolute;inset:-2px;border-radius:50%;pointer-events:none;transition:transform .4s ease; }
.cr-avatar-ring[data-spin]:hover { animation:ring-spin .8s linear infinite; }
@keyframes ring-spin { to{transform:rotate(360deg)} }
@keyframes card-in { from{opacity:0;transform:translateY(8px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }
.health-ring { animation:breathe-subtle 4s ease-in-out infinite;will-change:filter; }

/* ===== 创作者详情浮层 (cr-detail) ===== */
.cr-detail-overlay { position:fixed;inset:0;z-index:var(--z-modal);background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;animation:fade-in .15s ease; }
.cr-detail-box { background:var(--bg);border:1px solid var(--bd);border-radius:12px;padding:20px;max-width:420px;width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:12px;animation:detail-in .2s ease; }
@keyframes detail-in { from{opacity:0;transform:scale(.92) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
.cr-detail-header { display:flex;align-items:center;gap:10px; }
.cr-detail-name { font-size:16px;font-weight:700;color:var(--txt); }
.cr-detail-desc { font-size:var(--fs-sm);color:var(--muted);line-height:1.5; }
.cr-detail-row { display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);color:var(--muted); }
.cr-detail-row .cr-tag { font-size:10px; }
.cr-detail-actions { display:flex;gap:6px;flex-wrap:wrap;margin-top:4px; }
.cr-detail-actions button { padding:5px 14px;border-radius:6px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-sm);font-family:inherit;transition:all .12s; }
.cr-detail-actions button:hover { border-color:var(--accent);background:var(--hover); }
.cr-detail-actions .primary { background:var(--accent);color:#fff;border-color:var(--accent); }
.cr-detail-actions .primary:hover { opacity:.85; }
.cr-model-count { font-size:var(--fs-xs);color:var(--muted);display:inline-flex;align-items:center;gap:2px; }
.cr-platform-badge { font-size:8px;padding:1px 4px;border-radius:2px;line-height:12px;display:inline-flex;align-items:center;gap:2px;background:var(--surf);color:var(--muted);border:1px solid var(--bd); }
.gh-card:hover .cr-avatar { transform:rotate(-8deg) scale(1.05); }
.gh-card-icon { font-size:16px; width:24px; text-align:center; flex-shrink:0; }
.gh-card-body { flex:1; min-width:0; }
.gh-card-label { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-card.active .gh-card-label { color:#fff; }
.gh-card-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:0; }
.gh-card.active .gh-card-desc { color:#fffd; }
.gh-card-external { width:32px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted);cursor:pointer;border-left:1px solid var(--bd);transition:all .12s; }
.gh-card-external:hover { color:var(--accent);background:var(--hover); }
.gh-card.active .gh-card-external { border-left-color:var(--accent);color:var(--accent); }
.gh-section-title { font-size:var(--fs-md);font-weight:600;color:var(--txt);padding:8px 12px 4px; }
.gh-header { border-bottom:1px solid var(--bd);flex-shrink:0; }
.gh-header-top { display:flex;align-items:center;gap:8px;padding:8px 12px;flex-wrap:wrap;position:relative; }
.gh-back-repo { font-size:var(--fs-sm);padding:2px 6px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer;font-family:inherit; }
.gh-back-repo:hover { background:var(--hover); }
.gh-btn-txt { border-color:transparent; }
.gh-repo-name { font-size:var(--fs-md);font-weight:600;color:var(--txt);flex:1; }
.gh-model-count { font-size:var(--fs-sm);color:var(--muted); }
.gh-missing-count { font-size:var(--fs-sm);color:var(--free);font-weight:600; }
.gh-empty { padding:24px;text-align:center;color:var(--muted);font-size:var(--fs-base); }
.gh-filter-btn { font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-family:inherit; }
.gh-filter-btn:hover { background:var(--hover);color:var(--txt); }
.gh-filter-dropdown { display:none;position:absolute;top:100%;right:0;z-index:10;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:100px;box-shadow:0 4px 12px rgba(0,0,0,.3); }
/* .gh-btn-sm 已合并到 .btn-sm */
.gh-btn-muted { color:var(--muted); }
.gh-btn-muted:disabled { opacity:.4;cursor:not-allowed;pointer-events:none; }
.gh-btn-accent { color:var(--accent);border-color:var(--accent); }
.gh-btn-accent:hover { background:var(--accent);color:var(--bg); }
.gh-dl-selected { color:var(--accent);border-color:var(--accent); }
.gh-dl-selected:hover { background:var(--accent);color:var(--bg); }

/* ===== 模型名高亮标签（复用 display.js renderDisplayName） */
/* tag-* 颜色已由通用 .tag-* 规则覆盖 */

/* 二级菜单 */
.gh-popup { position:fixed; z-index:var(--z-popover); background:var(--surf,#2a2a3c); border:1px solid var(--bd,#444); border-radius:8px; padding:4px; box-shadow:0 8px 24px rgba(0,0,0,.35); min-width:140px; }
.gh-popup-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; cursor:pointer; transition:background .1s; }
.gh-popup-item:hover { background:var(--hover,#ffffff15); }
.gh-popup-icon { font-size:var(--fs-lg); width:20px; text-align:center; flex-shrink:0; }
.gh-popup-label { font-size:var(--fs-base); color:var(--txt,#cdd6f4); }

/* 创作者列表 */
.gh-creators-list { flex:1; overflow-y:auto; padding:6px 12px; display:flex; flex-direction:column; gap:4px; }
.gh-creator-card { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; border:1px solid var(--bd); background:var(--surf); cursor:pointer; transition:all .12s; }
.gh-creator-card:hover { border-color:var(--accent); background:var(--hover); }
.gh-creator-icon { font-size:var(--fs-lg); width:22px; text-align:center; flex-shrink:0; }
.gh-creator-body { flex:1; min-width:0; }
.gh-creator-name { font-size:var(--fs-base); font-weight:600; color:var(--txt); }
.gh-creator-desc { font-size:var(--fs-xs); color:var(--muted); margin-top:1px; }
.gh-creator-action { font-size:var(--fs-base); color:var(--muted); flex-shrink:0; }

/* ===== 模型列表行 ===== */
.gh-empty { padding:12px; text-align:center; color:var(--muted); font-size:var(--fs-sm); }
.gh-row { display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; border:1px solid var(--bd); font-size:var(--fs-base); margin-bottom:6px; transition:background .15s; cursor:default; }
.gh-row-exists { opacity:.6; background:rgba(166,227,161,.06); }
.gh-row-missing { background:rgba(243,139,168,.04); }
.gh-cb { cursor:pointer; flex-shrink:0; }
.gh-name { flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--txt); font-size:var(--fs-base); }
.gh-badge { padding:2px 8px; border-radius:4px; font-size:var(--fs-sm); color:var(--success,#4caf50); flex-shrink:0; }
.gh-row-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.gh-size { font-size:var(--fs-sm); color:var(--muted); }
.gh-dl-model { padding:3px 10px; border-radius:6px; border:1px solid var(--bd); background:transparent; color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; transition:all .15s; }
.gh-dl-model:hover { border-color:var(--accent); color:var(--accent); }

/* ===== 仓库头部（renderRepoHeaderHTML） ===== */
.gh-header { flex:1; overflow-y:auto; padding:0 12px; }
.gh-header > :last-child { padding-bottom:12px; }
.link-badge { display:inline-block; padding:0 5px; border-radius:3px; font-size:var(--fs-xs); font-weight:600; }
.link-badge-raw { color:#a6e3a1; background:rgba(166,227,161,.12); }
.link-badge-jsd { color:#f9a826; background:rgba(249,168,38,.12); }
.link-badge-api { color:#89b4fa; background:rgba(137,180,250,.12); }
.link-badge-cdn { color:#94e2d5; background:rgba(148,226,213,.12); }
.link-badge-ghapi { color:#cba6f7; background:rgba(203,166,247,.12); }
/* ===== 站点卡片分组标题 ===== */
.gh-section-title { font-size:var(--fs-xs); font-weight:600; color:var(--muted); padding:8px 8px 2px; }

/* ===== 站点视图 ===== */
.gh-scroll { flex:1; overflow-y:auto; }
.gh-section { padding:6px 12px 4px; display:flex; align-items:center; gap:4px; }
.gh-section-title-lg { font-size:var(--fs-sm); font-weight:600; color:var(--txt); }
.gh-section-sub { font-size:var(--fs-xs); color:var(--muted); }
.gh-preset-area { padding:8px 12px 4px; display:flex; gap:4px; flex-wrap:wrap; }
.gh-preset-btn { padding:2px 6px; border-radius:4px; border:1px solid var(--bd); background:var(--surf); color:var(--accent); cursor:pointer; font-size:var(--fs-xs); }
.gh-action-btn { padding:4px 12px; border-radius:6px; border:1px solid var(--bd); background:transparent; cursor:pointer; font-size:var(--fs-base); }
.gh-action-btn-accent { color:var(--accent); }
.gh-action-btn-muted { color:var(--muted); }
.gh-save-btn { padding:4px 14px; border-radius:6px; border:none; background:var(--accent); color:#fff; cursor:pointer; font-size:var(--fs-base); }
.gh-hint-text { font-size:8px; color:var(--muted); padding:0 12px 4px; }

/* ===== 创作者编辑行 ===== */
.gh-cr-row { display:flex; align-items:center; gap:3px; padding:4px 6px; border-radius:4px; border:1px solid var(--bd); font-size:var(--fs-sm); margin:1px 12px; }
.gh-cr-input { flex:2; min-width:30px; padding:2px 4px; border-radius:3px; border:1px solid transparent; background:transparent; font-size:var(--fs-sm); }
.gh-cr-input-name { color:var(--txt); }
.gh-cr-input-desc { color:var(--muted); font-size:var(--fs-xs); }
.gh-cr-input-type { flex:1; min-width:30px; padding:2px 4px; border-radius:3px; border:1px solid transparent; background:transparent; color:var(--accent); font-size:var(--fs-xs); text-align:center; }
.gh-cr-del { padding:1px 4px; border-radius:3px; border:1px solid transparent; background:transparent; color:#e5534b; cursor:pointer; font-size:var(--fs-sm); }
.gh-cr-add-area { padding:4px 12px; }
.gh-cr-add { padding:2px 8px; border-radius:4px; border:1px dashed var(--bd); background:transparent; color:var(--accent); cursor:pointer; font-size:var(--fs-sm); width:100%; }
/* ===== 创作者编辑卡片 ===== */
.cr-edit-card { margin:4px 12px; border-radius:8px; border:1px solid var(--bd); background:var(--surf); overflow:hidden; cursor:default; transition:box-shadow .15s,border-color .15s,margin-top .15s ease,margin-bottom .15s ease; }
.cr-edit-card:active { cursor:grabbing; }
.cr-edit-card-head { display:flex; align-items:center; gap:4px; padding:6px 8px; border-bottom:1px solid var(--bd); background:var(--bg); }
.cr-drag-handle { font-size:14px; color:var(--muted); cursor:grab; user-select:none; line-height:1; }
.cr-edit-card-avatar { width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:var(--surf); font-size:11px; flex-shrink:0; }
.cr-edit-card-body { padding:4px 8px 6px; }
.cr-edit-card-row { display:flex; align-items:center; gap:4px; margin:2px 0; }
.cr-edit-card-row select { flex:1; }
.gh-empty-site { flex:1; overflow-y:auto; padding:12px; color:var(--muted); font-size:var(--fs-sm); }
.gh-site-link { color:var(--accent); }

/* ===== 错误页 ===== */
.gh-error-page { padding:12px; text-align:center; }
.gh-error-msg { color:var(--muted); font-size:var(--fs-sm); line-height:1.6; }
.gh-error-hint { font-size:var(--fs-xs); opacity:.6; }
.gh-back-btn { padding:2px 8px; border-radius:4px; border:1px solid var(--bd); background:transparent; color:var(--txt); cursor:pointer; font-size:var(--fs-sm); }

/* ===== 下载队列 ===== */
.gh-queue-icon { color:var(--accent); }
.gh-queue-error { padding:2px 0; font-size:var(--fs-sm); color:#f38ba8; }
.gh-queue-err-item { font-size:var(--fs-xs); color:var(--muted); padding:0 4px; }
.gh-queue-ellipsis { font-size:var(--fs-xs); color:var(--muted); padding:0 4px; }
.gh-queue-cancel { font-size:var(--fs-sm); color:var(--muted); }
.gh-progress-row { display:flex; align-items:center; gap:4px; }
.gh-progress-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-sm); }
.gh-progress-pct { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-progress-remain { font-size:var(--fs-xs); color:var(--muted); flex-shrink:0; }
.gh-cancel-btn { width:20px; height:20px; border-radius:50%; border:none; background:rgba(128,128,128,.15); color:var(--muted); cursor:pointer; font-size:var(--fs-base); flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:background .15s; }
.gh-cancel-btn:hover { background:rgba(128,128,128,.3); }
.gh-progress-bar-wrap { margin-top:3px; height:4px; border-radius:2px; background:var(--bd); overflow:hidden; }
.gh-progress-fill { height:100%; width:0%; border-radius:2px; background:var(--accent); transition:width .2s; box-shadow:0 0 4px var(--accent); animation:breathe-subtle 4s ease-in-out infinite;will-change:filter,box-shadow; }
.gh-progress-box { padding:24px 12px; text-align:center; }
.gh-progress-label { font-size:var(--fs-sm); color:var(--muted); margin-bottom:8px; }

/* ===== 响应式 ===== */
@media (max-width:768px) {
  .cr-left,.gh-left,.ins-sidebar { width:100%; height:auto; border-right:none; flex-direction:row; flex-wrap:wrap; }
  .cr-scroll,.gh-grid,.diag-right { padding:4px 6px; }
  .diag-left { width:100%; border-right:none; flex-direction:row; flex-wrap:wrap; }
}
/* ===== 鑷畾涔夐厤鑹?+ AI 閰嶇疆 ===== */
.cc-row { flex-wrap:wrap; gap:10px; }
.cc-row .label { flex-shrink:0; }
.cc-swatches { display:flex; gap:7px; flex-wrap:wrap; align-items:center; flex:1; }
.cc-swatch { width:22px; height:22px; border-radius:50%; border:2px solid var(--bd); cursor:pointer; padding:0; transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease; }
.cc-swatch:hover { transform:scale(1.18); }
.cc-swatch.active { border-color:var(--txt); box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent); }
.cc-pick { display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
.cc-color-input { width:30px; height:30px; border:1px solid var(--bd); border-radius:6px; background:none; cursor:pointer; padding:2px; }
.cc-color-input::-webkit-color-swatch-wrapper { padding:0; }
.cc-color-input::-webkit-color-swatch { border:none; border-radius:4px; }
.cc-hex { font-size:var(--fs-sm); color:var(--muted); font-variant-numeric:tabular-nums; min-width:64px; }
.cc-advanced { margin:8px 16px 0; }
.cc-advanced summary { cursor:pointer; font-size:var(--fs-sm); color:var(--muted); user-select:none; padding:4px 0; transition:color .12s; }
.cc-advanced summary:hover { color:var(--accent); }
.cc-adv-row { display:flex; gap:18px; margin-top:8px; flex-wrap:wrap; }
.cc-adv-item { display:flex; align-items:center; gap:7px; font-size:var(--fs-sm); color:var(--muted); }
.cc-adv-item input[type=color] { width:28px; height:28px; border:1px solid var(--bd); border-radius:6px; background:none; cursor:pointer; padding:2px; }
.ai-group { display:flex; flex-direction:column; gap:10px; }
.ai-row { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
.ai-field { display:flex; flex-direction:column; gap:4px; min-width:140px; }
.ai-label { font-size:var(--fs-sm); color:var(--muted); }
.ai-input { background:var(--bg); border:1px solid var(--bd); border-radius:6px; color:var(--txt); padding:6px 9px; font-size:var(--fs-sm); outline:none; transition:border-color .15s, box-shadow .15s; width:100%; box-sizing:border-box; font-family:inherit; }
.ai-input:focus { border-color:var(--accent); box-shadow:var(--focus-ring); }

/* ===== 2026 UI pass: glassy control surface ===== */
.repo-wrap {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 34%),
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--meta-work, #bd93f9) 10%, transparent), transparent 32%),
    var(--bg);
}
.repo-tabs {
  gap:8px;
  padding:10px 14px 0;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 94%, var(--accent)), color-mix(in srgb, var(--bg) 96%, transparent));
}
.repo-tab {
  min-height:38px;
  padding:8px 16px;
  border-radius:12px 12px 0 0;
  border:1px solid transparent;
  color:var(--muted);
  font-size:13px;
  font-weight:700;
  letter-spacing:0;
}
.repo-tab:hover {
  color:var(--txt);
  background:color-mix(in srgb, var(--accent) 10%, transparent);
  border-color:color-mix(in srgb, var(--accent) 18%, transparent);
}
.repo-tab.active {
  color:var(--txt);
  background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 22%, var(--card)), color-mix(in srgb, var(--surf) 92%, transparent));
  border-color:color-mix(in srgb, var(--accent) 34%, var(--bd));
  border-bottom-color:var(--accent);
  box-shadow:0 -6px 24px color-mix(in srgb, var(--accent) 12%, transparent);
}
.repo-subtabs {
  gap:6px !important;
  padding:8px 12px !important;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
  background:color-mix(in srgb, var(--surf) 82%, transparent);
}
.repo-subtab {
  min-height:32px;
  padding:6px 12px;
  border-radius:10px;
  border:1px solid transparent;
  font-size:12px;
  font-weight:650;
}
.repo-subtab:hover {
  background:color-mix(in srgb, var(--accent) 10%, transparent);
  border-color:color-mix(in srgb, var(--accent) 18%, transparent);
}
.repo-subtab.active {
  color:var(--txt);
  background:color-mix(in srgb, var(--accent) 18%, var(--card));
  border-color:color-mix(in srgb, var(--accent) 30%, var(--bd));
  box-shadow:0 0 18px color-mix(in srgb, var(--accent) 10%, transparent);
}
.btn-base,
.btn,
.hdr-btn,
.repo-bar-btn,
.btn-sm,
.ws-btn-sm,
.gh-btn-sm,
.diag-log-fbtn,
.cr-preset-btn,
.gh-filter-btn,
.gh-dl-model {
  min-height:34px;
  padding:7px 12px;
  border-radius:10px;
  border:1px solid color-mix(in srgb, var(--accent) 24%, var(--bd));
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 88%, var(--accent)), color-mix(in srgb, var(--card) 96%, transparent));
  color:var(--txt);
  font-weight:650;
  transition:transform .14s ease, background .14s ease, border-color .14s ease, box-shadow .14s ease, color .14s ease;
  box-shadow:0 1px 0 rgba(255,255,255,.05) inset, 0 8px 18px rgba(0,0,0,.12);
}
.btn-base:hover,
.btn:hover,
.hdr-btn:hover,
.repo-bar-btn:hover,
.btn-sm:hover,
.ws-btn-sm:hover,
.gh-btn-sm:hover,
.diag-log-fbtn:hover,
.cr-preset-btn:hover,
.gh-filter-btn:hover,
.gh-dl-model:hover {
  transform:translateY(-1px);
  background:color-mix(in srgb, var(--accent) 15%, var(--card));
  border-color:var(--accent);
  color:var(--txt);
  box-shadow:0 10px 26px rgba(0,0,0,.18), 0 0 18px color-mix(in srgb, var(--accent) 18%, transparent);
}
.btn-base.sm,
.btn-sm,
.ws-btn-sm,
.gh-btn-sm {
  min-height:32px;
  padding:6px 11px;
  font-size:12px;
}
.btn-base.accent,
.btn.accent,
.ws-btn-accent,
.gh-btn-accent,
.diag-log-fbtn.active {
  background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 58%, var(--meta-work, #bd93f9)));
  border-color:color-mix(in srgb, var(--accent) 70%, #fff);
  color:#fff;
}
.repo-srch,
.main-search-input,
.sidebar-search-input,
.stg-select,
.ai-input,
.gh-cr-input,
.gh-cr-input-type,
input[type="text"],
input[type="password"],
select {
  min-height:34px;
  border-radius:10px !important;
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 82%, transparent) !important;
  color:var(--txt) !important;
  color-scheme:dark;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
}
select option {
  background:var(--native-option-bg, #0f172a) !important;
  color:var(--native-option-txt, #f8fafc) !important;
}
select option:checked {
  background:var(--native-option-active-bg, #64748b) !important;
  color:var(--native-option-active-txt, #ffffff) !important;
}
select option:hover,
select option:focus {
  background:var(--native-option-active-bg, #64748b) !important;
  color:var(--native-option-active-txt, #ffffff) !important;
}
select option:disabled {
  background:var(--native-option-bg, #0f172a) !important;
  color:color-mix(in srgb, var(--native-option-txt, #f8fafc) 58%, transparent) !important;
  opacity:1;
}
:host-context(.theme-warm) select {
  color-scheme:light;
  background:var(--card);
  color:var(--txt);
}
.repo-srch:focus,
.main-search-input:focus,
.sidebar-search-input:focus,
.stg-select:focus,
.ai-input:focus,
input[type="text"]:focus,
input[type="password"]:focus,
select:focus {
  border-color:var(--accent) !important;
  box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), inset 0 1px 0 rgba(255,255,255,.04) !important;
}
.stg-page {
  padding:4px 16px 18px;
  overflow:auto;
}
.section-title,
.stg-title {
  padding:16px 0 10px;
  font-size:15px;
  font-weight:800;
  letter-spacing:0;
  color:var(--txt);
}
.stg-sub-title {
  margin-top:8px;
}
.stg-grid {
  gap:14px;
}
.stg-card,
.settings-group,
.model-card,
.model-card-sm,
.rec-card,
.cr-edit-card,
.gh-card,
.gh-row,
.dp-placeholder,
.diag-left,
.cr-left,
.gh-left,
.ins-sidebar,
[style*="background:var(--surf)"] {
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  border-radius:12px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 94%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent)) !important;
  box-shadow:0 10px 28px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.035);
}
.stg-card {
  overflow:hidden;
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease;
}
.stg-card:hover {
  transform:translateY(-1px);
  border-color:color-mix(in srgb, var(--accent) 44%, var(--bd)) !important;
  box-shadow:0 14px 34px rgba(0,0,0,.18), 0 0 22px color-mix(in srgb, var(--accent) 12%, transparent);
}
.stg-card-hdr {
  padding:11px 14px;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  background:color-mix(in srgb, var(--card) 74%, transparent);
  font-size:13px;
  font-weight:800;
}
.stg-card-body {
  padding:12px 14px;
}
.stg-card-val {
  min-height:38px;
  border-radius:10px;
  border-color:color-mix(in srgb, var(--accent) 22%, var(--bd));
  background:color-mix(in srgb, var(--bg) 70%, transparent);
  font-size:12px;
}
.stg-card-val:hover {
  box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}
.setting-row {
  min-height:42px;
  gap:12px;
  padding:10px 12px;
  border:1px solid color-mix(in srgb, var(--accent) 14%, var(--bd));
  border-radius:10px;
  background:color-mix(in srgb, var(--bg) 72%, transparent);
}
.stg-hint,
.stg-card-hint,
.stg-card-desc {
  color:color-mix(in srgb, var(--muted) 82%, var(--txt));
  line-height:1.55;
}
.cc-swatch {
  width:26px;
  height:26px;
  border-radius:9px;
}
.cc-color-input,
.cc-adv-item input[type=color] {
  width:34px;
  height:34px;
  border-radius:9px;
}
.ai-group {
  padding:14px 16px;
}
.ai-field {
  gap:6px;
}
.ai-label {
  font-size:12px;
  font-weight:700;
}
.ai-input {
  padding:8px 10px;
  font-size:12px;
}
.placeholder-box {
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  border-radius:14px;
  background:color-mix(in srgb, var(--surf) 72%, transparent);
}
.recy-page {
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 42%);
}
.dl-page {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 44%),
    var(--bg);
}
#dl-form {
  margin:12px !important;
  padding:12px;
  border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));
  border-radius:14px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 94%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent));
  box-shadow:0 14px 36px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.04);
}
#dl-form > div {
  gap:8px !important;
}
.dl-form-head {
  min-height:30px;
  color:color-mix(in srgb, var(--muted) 82%, var(--txt)) !important;
  font-size:12px !important;
}
.dl-check {
  min-height:26px;
  padding:3px 8px;
  border-radius:9px;
  border:1px solid color-mix(in srgb, var(--accent) 14%, var(--bd));
  background:color-mix(in srgb, var(--bg) 58%, transparent);
}
.dl-check input[type="checkbox"] {
  width:15px;
  height:15px;
  accent-color:var(--accent);
}
.dl-fields {
  display:grid !important;
  grid-template-columns:1.05fr 1.05fr 1fr .75fr .78fr;
  gap:8px !important;
}
#dl-form input[type="text"],
#dl-form input:not([type]),
.dl-input {
  min-height:36px;
  padding:8px 10px !important;
  font-size:12px !important;
  border-radius:10px !important;
  width:100% !important;
  min-width:0;
  box-sizing:border-box;
  border-color:color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 70%, transparent) !important;
}
.dl-input:focus {
  border-color:var(--accent) !important;
  outline:none;
  box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}
#dl-tips {
  max-height:88px !important;
  border-radius:11px !important;
  border-left:3px solid var(--accent) !important;
  background:color-mix(in srgb, var(--accent) 8%, var(--bg)) !important;
}
.dl-preview-row {
  min-height:44px;
  padding:7px 9px !important;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  border-radius:13px !important;
  background:color-mix(in srgb, var(--bg) 66%, transparent) !important;
}
.dl-preview-label,
.dl-queue-chip {
  min-height:26px;
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:9px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 12%, transparent);
  font-weight:750;
}
#dl-preview {
  min-height:30px;
  display:flex;
  align-items:center;
  color:var(--txt);
  font-size:13px !important;
  font-weight:850 !important;
}
#dl-preview-model,
#dl-import,
#dl-cancel,
#dl-clear-list {
  min-height:34px !important;
  padding:7px 11px !important;
  border-radius:11px !important;
  font-weight:800;
}
.dl-list-panel {
  margin:0 12px 8px !important;
  padding:10px 12px 12px !important;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
  border-radius:14px;
  background:color-mix(in srgb, var(--surf) 72%, transparent);
}
.dl-list-head {
  min-height:34px;
  padding:0 0 8px !important;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 14%, var(--bd));
}
#dl-count {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:9px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 12%, transparent);
}
#dl-imported-list {
  gap:8px !important;
  max-height:230px !important;
  padding-top:8px;
}
#dl-drop {
  margin:12px !important;
  border-radius:18px !important;
  border:1px dashed color-mix(in srgb, var(--accent) 38%, var(--bd)) !important;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 42%),
    color-mix(in srgb, var(--surf) 88%, transparent);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.025), 0 18px 42px rgba(0,0,0,.14);
  text-align:center;
  padding:20px !important;
}
#dl-drop:hover {
  border-color:var(--accent) !important;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 46%),
    color-mix(in srgb, var(--surf) 92%, var(--accent));
  box-shadow:0 0 28px color-mix(in srgb, var(--accent) 14%, transparent), inset 0 0 0 1px rgba(255,255,255,.035);
}
.dl-drop-icon {
  width:64px;
  height:64px;
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:18px;
  background:color-mix(in srgb, var(--accent) 10%, transparent);
  opacity:1 !important;
  font-size:34px !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
}
.dl-drop-title {
  max-width:720px;
  font-size:13px !important;
  line-height:1.6;
  color:color-mix(in srgb, var(--muted) 78%, var(--txt)) !important;
}
.dl-drop-title b {
  color:var(--txt);
  font-weight:850;
}
.dl-drop-sub span,
.dl-drop-hint {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:2px 9px;
  border-radius:9px;
  background:color-mix(in srgb, var(--bg) 58%, transparent);
}
#dl-imported-list > div,
.dl-q-item,
.recy-item {
  min-height:38px;
  padding:8px 10px !important;
  border-radius:12px !important;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 82%, transparent), color-mix(in srgb, var(--surf) 96%, transparent)) !important;
  box-shadow:0 8px 22px rgba(0,0,0,.12);
}
.dl-q-item:hover,
#dl-imported-list > div:hover,
.recy-item:hover {
  border-color:color-mix(in srgb, var(--accent) 40%, var(--bd)) !important;
  background:color-mix(in srgb, var(--accent) 10%, var(--card)) !important;
}
.dl-imported-item,
.dl-q-item {
  gap:9px !important;
  transition:transform .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease;
}
.dl-imported-item:hover,
.dl-q-item:hover {
  transform:translateX(2px);
  box-shadow:0 12px 28px rgba(0,0,0,.16), 0 0 20px color-mix(in srgb, var(--accent) 10%, transparent);
}
.dl-q-status {
  width:28px;
  height:28px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:10px;
  background:color-mix(in srgb, var(--accent) 9%, transparent);
  flex-shrink:0;
}
.dl-item-name {
  font-size:12px;
  font-weight:750;
  min-width:0;
}
.dl-item-time {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:2px 7px;
  border-radius:8px;
  background:color-mix(in srgb, var(--bg) 64%, transparent);
}
.dl-reimport,
.dl-remove-q,
.recy-preview,
.recy-restore,
.recy-del {
  min-height:28px;
  padding:5px 9px !important;
  border-radius:9px !important;
  font-size:11px !important;
  font-weight:650;
}
.recy-page {
  padding:14px !important;
}
#recy-list {
  gap:8px !important;
}
.recy-item {
  gap:7px !important;
}
.recy-row {
  gap:8px !important;
  min-width:0;
}
.recy-name {
  font-size:13px;
  font-weight:750;
}
.recy-size {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:9px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 14%, transparent);
}
.recy-path {
  padding:2px 4px 0 0 !important;
  line-height:1.45;
  color:color-mix(in srgb, var(--muted) 84%, var(--txt)) !important;
}
.recy-preview,
.recy-restore,
.recy-del {
  border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd)) !important;
  background:color-mix(in srgb, var(--card) 88%, transparent) !important;
  color:var(--txt) !important;
  transition:transform .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease;
}
.recy-preview:hover,
.recy-restore:hover {
  transform:translateY(-1px);
  border-color:var(--accent) !important;
  background:color-mix(in srgb, var(--accent) 14%, var(--card)) !important;
  box-shadow:0 8px 20px rgba(0,0,0,.16);
}
.recy-del {
  color:var(--paid) !important;
  border-color:color-mix(in srgb, var(--paid) 40%, var(--bd)) !important;
}
.recy-del:hover {
  transform:translateY(-1px);
  background:color-mix(in srgb, var(--paid) 13%, var(--card)) !important;
  box-shadow:0 8px 20px rgba(0,0,0,.16);
}
.oldest-page {
  gap:18px !important;
  padding:16px !important;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 42%),
    linear-gradient(315deg, color-mix(in srgb, var(--tag-amber) 6%, transparent), transparent 48%),
    var(--bg);
}
.oldest-hero {
  gap:14px !important;
  align-items:stretch;
}
.oldest-health,
.oldest-panel {
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  border-radius:16px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent)) !important;
  box-shadow:0 14px 34px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.035);
}
.oldest-health {
  min-height:70px;
  padding:12px 14px !important;
}
.oldest-health .health-ring {
  width:38px !important;
  height:38px !important;
  box-shadow:0 0 20px color-mix(in srgb, var(--accent) 14%, transparent);
}
.oldest-health .health-ring-inner {
  width:30px !important;
  height:30px !important;
  top:4px !important;
  left:4px !important;
}
.oldest-health .health-ring-inner span {
  font-size:13px !important;
}
.oldest-health .health-tag {
  min-height:26px;
  display:inline-flex;
  align-items:center;
  padding:3px 9px;
  border-radius:10px;
  font-weight:800;
}
.oldest-pills {
  gap:8px !important;
  align-content:flex-start;
  flex:1 1 220px;
}
.oldest-pills > span {
  min-height:34px;
  display:inline-flex;
  align-items:center;
  padding:6px 11px !important;
  border-radius:12px !important;
  border-color:color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 68%, transparent) !important;
  font-weight:800;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.035);
}
.oldest-panel {
  padding:14px 16px !important;
}
.oldest-panel > div:first-child {
  font-size:12px !important;
  font-weight:850;
  color:color-mix(in srgb, var(--muted) 82%, var(--txt)) !important;
  letter-spacing:0 !important;
}
.oldest-ancient {
  flex:3 1 320px !important;
}
.oldest-heatmap {
  overflow:hidden;
}
.oldest-heatmap [title] {
  border-radius:7px !important;
  box-shadow:0 0 12px color-mix(in srgb, var(--accent) 8%, transparent);
}
.oldest-picks .model-card,
.oldest-ancient .model-card-sm {
  min-height:92px;
  border-radius:14px !important;
  padding:12px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--card) 88%, var(--accent)), color-mix(in srgb, var(--surf) 96%, transparent)) !important;
  border-color:color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
  box-shadow:0 10px 26px rgba(0,0,0,.12);
}
.oldest-picks .model-card:hover,
.oldest-ancient .model-card-sm:hover {
  transform:translateY(-2px);
  border-color:color-mix(in srgb, var(--accent) 44%, var(--bd)) !important;
  box-shadow:0 16px 36px rgba(0,0,0,.18), 0 0 24px color-mix(in srgb, var(--accent) 12%, transparent);
}
.oldest-picks .model-card .actions button,
.oldest-ancient .model-card-sm .actions button {
  min-height:32px;
  border-radius:10px;
  font-weight:800;
}
.diag-wrapper {
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 42%);
}
.diag-left {
  gap:8px;
  padding:10px;
}
.diag-btn {
  min-height:38px;
  padding:9px 11px;
  border-radius:11px;
  border:1px solid transparent;
  font-weight:700;
}
.diag-btn:hover {
  border-color:color-mix(in srgb, var(--accent) 22%, var(--bd));
  background:color-mix(in srgb, var(--accent) 10%, transparent);
}
.diag-btn.active {
  border-color:color-mix(in srgb, var(--accent) 34%, var(--bd));
  background:color-mix(in srgb, var(--accent) 18%, var(--card));
  box-shadow:0 0 18px color-mix(in srgb, var(--accent) 10%, transparent);
}
.diag-log-filter {
  gap:8px !important;
  padding:10px 12px !important;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 16%, var(--bd));
}
#diag-log-search {
  min-height:32px;
  border-radius:10px !important;
}
.diag-right {
  background:color-mix(in srgb, var(--bg) 82%, transparent);
}
.diag-panel {
  min-width:0;
}
.diag-log-fbtn {
  min-height:32px;
  padding:6px 11px !important;
  border-radius:10px !important;
  font-weight:750;
}
#diag-log-search {
  width:180px !important;
  padding:7px 11px !important;
  border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 76%, transparent) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
}
#diag-log-search:focus {
  border-color:var(--accent) !important;
  box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), inset 0 1px 0 rgba(255,255,255,.04);
}
#diag-log-list,
#diag-conflict-list,
.dedup-result-list {
  padding:10px 12px !important;
  display:flex;
  flex-direction:column;
  gap:8px;
}
.log-row,
.conflict-row,
.dedup-group,
.dedup-summary,
.dedup-type-head {
  border:1px solid color-mix(in srgb, var(--accent) 16%, var(--bd)) !important;
  border-radius:13px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 93%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent)) !important;
  box-shadow:0 10px 26px rgba(0,0,0,.11), inset 0 1px 0 rgba(255,255,255,.035);
}
.log-row {
  min-height:44px;
  padding:9px 11px !important;
  gap:10px !important;
  border-bottom:none !important;
  transition:transform .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease;
}
.log-row:hover {
  transform:translateX(2px);
  border-color:color-mix(in srgb, var(--accent) 38%, var(--bd)) !important;
  background:color-mix(in srgb, var(--accent) 10%, var(--card)) !important;
  box-shadow:0 14px 32px rgba(0,0,0,.16), 0 0 20px color-mix(in srgb, var(--accent) 10%, transparent);
}
.log-row .log-status {
  width:28px !important;
  height:28px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:10px;
  background:color-mix(in srgb, var(--accent) 9%, transparent);
  font-size:13px !important;
}
.log-row .log-msg {
  line-height:1.45;
  white-space:normal !important;
}
.log-row .log-time {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:9px;
  background:color-mix(in srgb, var(--bg) 70%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 12%, transparent);
}
.conflict-row {
  min-height:42px;
  align-items:center;
  padding:9px 11px !important;
}
.conflict-name {
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-weight:800;
}
.conflict-ver,
.dedup-type-count,
.dedup-group-meta,
.dedup-file-size,
.dedup-file-date {
  display:inline-flex;
  align-items:center;
  min-height:22px;
  padding:2px 7px;
  border-radius:8px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 12%, transparent);
}
.conflict-ins {
  margin:-4px 8px 2px 18px;
  padding:7px 10px;
  border-left:2px solid color-mix(in srgb, var(--accent) 36%, var(--bd));
  color:color-mix(in srgb, var(--muted) 82%, var(--txt)) !important;
}
.dedup-page {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 40%),
    var(--bg);
}
.dedup-toolbar {
  min-height:54px;
  gap:12px !important;
  padding:10px 14px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent));
  border-bottom-color:color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
}
.dedup-hint {
  line-height:1.45;
  color:color-mix(in srgb, var(--muted) 82%, var(--txt)) !important;
}
.dedup-start {
  min-height:36px;
  padding:8px 13px;
  border-radius:11px;
  font-weight:800;
}
.dedup-summary {
  padding:12px 14px !important;
  font-size:12px !important;
  line-height:1.55;
}
.dedup-summary strong {
  color:var(--accent);
}
.dedup-summary-note {
  margin-top:4px !important;
  font-size:11px !important;
}
.dedup-type-head {
  margin-top:4px;
  padding:9px 11px !important;
  font-size:12px !important;
}
.dedup-type-rule {
  border-bottom-color:color-mix(in srgb, var(--accent) 22%, var(--bd)) !important;
}
.dedup-group {
  margin:0 !important;
  overflow:hidden;
}
.dedup-group-head {
  min-height:38px;
  padding:8px 10px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 12%, var(--surf)), color-mix(in srgb, var(--surf) 95%, transparent)) !important;
  border-bottom-color:color-mix(in srgb, var(--accent) 16%, var(--bd)) !important;
}
.dedup-file-row {
  min-height:42px;
  gap:9px !important;
  padding:8px 10px !important;
  border-top:1px solid color-mix(in srgb, var(--accent) 10%, var(--bd));
  background:transparent !important;
  transition:background .14s ease, transform .14s ease;
}
.dedup-file-row:hover {
  transform:translateX(2px);
  background:color-mix(in srgb, var(--accent) 9%, transparent) !important;
}
.dedup-file-row.is-recommended {
  background:color-mix(in srgb, var(--success, #4caf50) 9%, transparent) !important;
}
.dedup-radio {
  width:16px;
  height:16px;
}
.dedup-file-name {
  display:block;
  font-size:12px !important;
  font-weight:800;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dedup-file-path {
  margin-top:2px;
  font-size:10px !important;
}
.dedup-badge {
  min-height:22px;
  display:inline-flex;
  align-items:center;
  padding:2px 7px !important;
  border-radius:8px !important;
  background:color-mix(in srgb, var(--success, #4caf50) 14%, transparent) !important;
  color:var(--success, #4caf50) !important;
  font-weight:800;
}
.dedup-keep-all {
  border-top-color:color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 58%, transparent) !important;
}
.dedup-keep-text {
  font-weight:750;
}
.dedup-actions {
  position:sticky;
  bottom:0;
  gap:10px !important;
  padding:10px 12px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 86%, transparent), var(--surf));
  backdrop-filter:blur(12px);
}
.dedup-exec,
.dedup-cancel {
  min-height:38px;
  border-radius:11px !important;
  font-weight:800;
}

/* ===== 2026 UI pass: community and creator workbench ===== */
.cr-page,
.gh-scroll,
.gh-header {
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 36%),
    linear-gradient(315deg, color-mix(in srgb, var(--meta-game, #4a9eff) 6%, transparent), transparent 42%),
    var(--bg);
}
.cr-left,
.gh-left {
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 90%, var(--accent)), color-mix(in srgb, var(--bg) 96%, transparent)) !important;
}
.cr-grid {
  gap:8px;
  padding:10px;
}
.cr-scroll {
  padding:14px 16px;
}
.cr-section {
  gap:10px !important;
  margin:0 0 12px;
  padding:8px 2px;
}
.cr-section-title-lg,
.gh-section-title-lg {
  font-size:14px;
  font-weight:800;
}
.cr-section-sub,
.gh-section-sub {
  color:color-mix(in srgb, var(--muted) 82%, var(--txt));
}
.cr-preset-area {
  gap:8px;
  padding:4px 0 16px;
}
.cr-preset-btn,
.cr-tag-filter-btn {
  min-height:34px;
  padding:7px 12px;
  border-radius:11px;
  font-weight:700;
}
.cr-tag-filter-row {
  gap:8px;
  margin:0 0 14px;
}
.cr-tag-filter-btn.active {
  background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--tag-vup, #ff6bb5)));
  border-color:color-mix(in srgb, var(--accent) 76%, #fff);
  box-shadow:0 0 20px color-mix(in srgb, var(--accent) 18%, transparent);
}
#ws-cr-search {
  min-width:180px !important;
  max-width:240px !important;
  min-height:34px !important;
  padding:7px 11px !important;
  border-radius:11px !important;
}
.cr-mode-switch {
  min-height:34px;
  border-radius:11px !important;
  border:1px solid color-mix(in srgb, var(--accent) 26%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 76%, transparent) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
}
.cr-mode-opt {
  min-height:32px;
  padding:0 10px;
  border-radius:9px;
  font-weight:700;
}
.cr-mode-opt.active {
  background:color-mix(in srgb, var(--accent) 18%, var(--card));
  color:var(--txt);
}
.cr-creator-grid {
  display:grid !important;
  grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));
  gap:10px !important;
  align-items:stretch;
}
.cr-creator-grid .gh-card {
  min-width:0 !important;
  max-width:none !important;
  flex:auto !important;
  min-height:94px;
  padding:12px !important;
  border-radius:14px !important;
  display:flex;
  align-items:flex-start;
  gap:10px;
  overflow:hidden;
  position:relative;
  transition:transform .16s ease, border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
.cr-creator-grid .gh-card::after {
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  border-radius:inherit;
  background:linear-gradient(120deg, rgba(255,255,255,.08), transparent 36%, color-mix(in srgb, var(--accent) 10%, transparent));
  opacity:.65;
}
.cr-creator-grid .gh-card:hover {
  transform:translateY(-2px);
  border-color:color-mix(in srgb, var(--accent) 48%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 14%, var(--card)), color-mix(in srgb, var(--surf) 94%, transparent)) !important;
  box-shadow:0 16px 38px rgba(0,0,0,.2), 0 0 26px color-mix(in srgb, var(--accent) 14%, transparent);
}
.cr-creator-grid .gh-card-body {
  position:relative;
  z-index:1;
}
.cr-creator-grid .gh-card-label {
  font-size:13px;
  font-weight:800;
}
.cr-creator-grid .gh-card-desc {
  margin-top:4px;
  line-height:1.45;
  color:color-mix(in srgb, var(--muted) 82%, var(--txt));
}
.cr-avatar-container {
  width:36px !important;
  height:36px !important;
  margin:2px 0 0 !important;
  position:relative;
  z-index:1;
}
.cr-avatar,
.cr-avatar-container .cr-avatar {
  width:36px !important;
  height:36px !important;
  border-radius:12px !important;
  background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--card)), color-mix(in srgb, var(--surf) 92%, transparent));
  color:var(--txt);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
}
.cr-avatar-ring {
  inset:-3px !important;
  border-radius:14px !important;
}
.cr-star-btn {
  min-width:24px;
  min-height:24px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:8px;
  color:var(--accent);
  background:color-mix(in srgb, var(--accent) 10%, transparent);
}
.cr-tag {
  min-height:20px;
  padding:2px 7px;
  border-radius:8px;
  font-weight:750;
}
.cr-edit-card {
  margin:8px 0;
  border-radius:14px !important;
}
.cr-edit-card-head {
  min-height:42px;
  gap:8px;
  padding:8px 10px;
}
.cr-edit-card-body {
  padding:8px 10px 10px;
}
.cr-edit-card-row {
  gap:8px;
  margin:6px 0;
}
.cr-drag-handle {
  width:28px;
  height:28px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:9px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
}
.cr-add-area {
  padding:10px 0;
}
.cr-add,
.cr-add-preset {
  width:100%;
  min-height:38px;
  border-radius:12px;
  border:1px dashed color-mix(in srgb, var(--accent) 38%, var(--bd));
  background:color-mix(in srgb, var(--accent) 8%, transparent);
  color:var(--txt);
  font-weight:750;
  cursor:pointer;
}
.gh-header {
  padding:0 16px 16px;
}
.gh-header-top {
  position:sticky;
  top:0;
  z-index:5;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:12px 0 10px;
  background:linear-gradient(180deg, var(--bg), color-mix(in srgb, var(--bg) 84%, transparent));
  backdrop-filter:blur(12px);
}
.gh-repo-name {
  font-size:14px;
  font-weight:850;
  color:var(--txt);
}
.gh-model-count,
.gh-missing-count,
.gh-badge,
.gh-size {
  min-height:24px;
  display:inline-flex;
  align-items:center;
  border-radius:9px;
  padding:3px 8px;
  background:color-mix(in srgb, var(--accent) 9%, transparent);
  border:1px solid color-mix(in srgb, var(--accent) 18%, transparent);
}
.gh-missing-count {
  color:var(--tag-vup, #ff6bb5);
  background:color-mix(in srgb, var(--tag-vup, #ff6bb5) 10%, transparent);
}
.gh-search {
  width:100%;
  min-height:38px !important;
  padding:8px 12px !important;
  border-radius:12px !important;
}
.gh-filter-dropdown {
  min-width:190px !important;
  padding:8px !important;
  border-radius:14px !important;
  border-color:color-mix(in srgb, var(--accent) 28%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 96%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent)) !important;
  box-shadow:0 16px 36px rgba(0,0,0,.24), 0 0 24px color-mix(in srgb, var(--accent) 10%, transparent) !important;
}
.gh-filter-dropdown button {
  width:100%;
  justify-content:flex-start;
  margin:2px 0;
}
.gh-row {
  min-height:46px;
  gap:10px;
  padding:8px 10px;
  border-radius:13px !important;
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease, background .14s ease;
}
.gh-row:hover {
  transform:translateX(2px);
  border-color:color-mix(in srgb, var(--accent) 34%, var(--bd)) !important;
  background:color-mix(in srgb, var(--accent) 10%, var(--card)) !important;
  box-shadow:0 10px 26px rgba(0,0,0,.16);
}
.gh-row-exists {
  opacity:.78;
}
.gh-row-exists:hover {
  background:color-mix(in srgb, var(--success, #4caf50) 11%, var(--card)) !important;
}
.gh-row-missing:hover {
  background:color-mix(in srgb, var(--tag-vup, #ff6bb5) 10%, var(--card)) !important;
}
.gh-search-bili {
  width:32px !important;
  min-width:32px !important;
  height:32px !important;
  padding:0 !important;
  border-radius:10px !important;
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  background:color-mix(in srgb, var(--accent) 8%, transparent) !important;
  color:var(--muted) !important;
  display:inline-flex;
  align-items:center;
  justify-content:center;
}
.gh-search-bili:hover {
  color:var(--txt) !important;
  border-color:var(--accent) !important;
  background:color-mix(in srgb, var(--accent) 18%, var(--card)) !important;
}
.gh-dl-model {
  min-width:38px;
  justify-content:center;
}
.gh-queue-status {
  margin:0 0 8px;
  border-radius:13px;
  overflow:hidden;
}
.gh-progress-row {
  min-height:34px;
  gap:8px;
  padding:4px 2px;
}
.gh-progress-bar-wrap {
  height:6px;
  border-radius:999px;
  background:color-mix(in srgb, var(--accent) 12%, var(--bd));
}
.gh-progress-fill {
  border-radius:999px;
}
.gh-cancel-btn {
  width:28px;
  height:28px;
  border-radius:10px;
}
.gh-empty,
.cr-empty-site,
.cr-error-page {
  margin:18px auto;
  max-width:520px;
  border:1px solid color-mix(in srgb, var(--accent) 22%, var(--bd));
  border-radius:16px;
  background:color-mix(in srgb, var(--surf) 86%, transparent);
  box-shadow:0 14px 34px rgba(0,0,0,.14);
}

/* ===== 2026 UI pass: resource manager panels ===== */
app-resource-manager {
  min-width:0;
}
app-resource-manager .repo-layout {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 40%),
    var(--bg);
}
app-resource-manager .rm-sidebar {
  width:248px !important;
  padding:12px !important;
  border-right:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--bg) 98%, transparent));
  box-shadow:10px 0 30px rgba(0,0,0,.08);
}
app-resource-manager .rm-sidebar > div:first-child {
  margin-bottom:10px;
  padding:10px !important;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  border-radius:13px;
  background:color-mix(in srgb, var(--bg) 72%, transparent);
  color:color-mix(in srgb, var(--muted) 86%, var(--txt)) !important;
  line-height:1.45;
}
app-resource-manager .rm-sidebar > div:nth-child(2) {
  gap:8px !important;
  padding:0 0 10px !important;
  margin-bottom:10px !important;
  border-bottom:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd)) !important;
}
app-resource-manager .rm-import-btn,
app-resource-manager .rm-open-btn {
  min-height:36px !important;
  border-radius:11px !important;
  font-weight:750;
}
app-resource-manager .rm-search {
  min-height:38px !important;
  margin-bottom:10px !important;
  padding:8px 11px !important;
  border-radius:12px !important;
  border-color:color-mix(in srgb, var(--accent) 22%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 76%, transparent) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
}
app-resource-manager .rm-list {
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:2px 0 12px;
}
app-resource-manager .rm-item {
  min-height:44px;
  gap:10px !important;
  padding:8px 10px !important;
  border:1px solid color-mix(in srgb, var(--accent) 16%, var(--bd));
  border-radius:13px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent));
  box-shadow:0 8px 22px rgba(0,0,0,.1), inset 0 1px 0 rgba(255,255,255,.035);
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease, background .14s ease, opacity .14s ease !important;
}
app-resource-manager .rm-item:hover,
app-resource-manager .rm-item.active {
  transform:translateX(2px);
  border-color:color-mix(in srgb, var(--accent) 42%, var(--bd));
  background:color-mix(in srgb, var(--accent) 11%, var(--card)) !important;
  box-shadow:0 12px 30px rgba(0,0,0,.16), 0 0 18px color-mix(in srgb, var(--accent) 10%, transparent);
}
app-resource-manager .rm-item.active {
  border-left:3px solid var(--accent);
}
app-resource-manager .rm-toggle {
  width:26px;
  height:26px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:9px;
  background:color-mix(in srgb, var(--accent) 10%, transparent);
  font-weight:850;
}
app-resource-manager .rm-item > span:nth-child(2) {
  width:28px;
  height:28px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:10px;
  background:color-mix(in srgb, var(--accent) 8%, transparent);
}
app-resource-manager .rm-item > span:last-child {
  min-width:0;
  flex:1;
  color:var(--txt);
  font-size:13px;
  font-weight:750;
}
app-resource-manager .rm-content {
  padding:16px !important;
  background:linear-gradient(315deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 42%);
}
app-resource-manager .rm-content > div:not(.dp-placeholder) {
  max-width:760px;
  min-height:100%;
  margin:0 auto;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  border-radius:16px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 92%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent));
  box-shadow:0 16px 38px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.035);
}
app-resource-manager .rm-content img {
  width:148px !important;
  height:148px !important;
  border-radius:18px !important;
  border-color:color-mix(in srgb, var(--accent) 28%, var(--bd)) !important;
  background:color-mix(in srgb, var(--bg) 74%, transparent);
  box-shadow:0 12px 28px rgba(0,0,0,.14);
}
app-resource-manager .rm-del-btn {
  min-height:34px !important;
  border-radius:11px !important;
  font-weight:750;
}
app-resource-manager .dp-placeholder {
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  border-radius:16px !important;
  background:color-mix(in srgb, var(--surf) 82%, transparent) !important;
  box-shadow:0 14px 34px rgba(0,0,0,.12);
}

/* ===== 2026 UI pass: settings and about pages ===== */
.stg-page {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 42%),
    var(--bg);
}
.stg-page > .section-title:first-child {
  padding-top:10px;
}
.stg-page > div[style*="display:flex;gap:12px"] {
  gap:14px !important;
  margin:0 16px 14px !important;
}
.stg-page > div[style*="display:flex;gap:12px"] > div {
  min-width:220px;
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  border-radius:14px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 94%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent)) !important;
  box-shadow:0 12px 30px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.035);
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease;
}
.stg-page > div[style*="display:flex;gap:12px"] > div:hover {
  transform:translateY(-1px);
  border-color:color-mix(in srgb, var(--accent) 42%, var(--bd)) !important;
  box-shadow:0 16px 36px rgba(0,0,0,.18), 0 0 22px color-mix(in srgb, var(--accent) 10%, transparent);
}
.stg-page > div[style*="display:flex;gap:12px"] > div > div:first-child {
  color:var(--txt);
  font-size:13px !important;
  font-weight:850 !important;
  letter-spacing:0;
}
.stg-select {
  min-height:38px;
  padding:8px 11px;
  font-weight:700;
}
.stg-label {
  display:inline-flex;
  align-items:center;
  min-height:34px;
  padding:0 10px;
  border-radius:11px;
  border:1px solid color-mix(in srgb, var(--accent) 16%, var(--bd));
  background:color-mix(in srgb, var(--bg) 70%, transparent);
  color:var(--txt);
  font-weight:700;
}
.stg-label input[type="checkbox"] {
  width:16px;
  height:16px;
  accent-color:var(--accent);
}
.stg-card-val {
  word-break:break-all;
  line-height:1.45;
}
.stg-card-hdr .btn,
.stg-card-hdr .btn-base {
  min-height:30px;
  padding:5px 9px;
  border-radius:10px;
  font-size:11px;
}
.settings-group {
  margin-left:16px !important;
  margin-right:16px !important;
  padding:14px 16px !important;
}
.settings-group .setting-row:first-child:last-child {
  margin-bottom:0;
}
.cc-group,
.ai-group {
  border:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  border-radius:14px !important;
  background:linear-gradient(180deg, color-mix(in srgb, var(--surf) 94%, var(--accent)), color-mix(in srgb, var(--surf) 98%, transparent)) !important;
  box-shadow:0 12px 30px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.035);
}
.cc-row {
  align-items:center;
}
.cc-swatches {
  gap:9px;
}
.cc-swatch {
  box-shadow:0 8px 18px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.08);
}
.cc-swatch.active {
  transform:scale(1.08);
}
.cc-advanced {
  border-top:1px solid color-mix(in srgb, var(--accent) 14%, var(--bd));
  padding-top:8px;
}
.cc-advanced summary {
  font-weight:750;
}
.ai-row {
  align-items:flex-end;
}
.ai-input {
  min-height:38px;
  padding:9px 11px;
}
#set-ai-test {
  min-height:38px !important;
}
#set-version {
  min-height:28px;
  display:inline-flex;
  align-items:center;
  padding:3px 9px;
  border-radius:9px;
  border:1px solid color-mix(in srgb, var(--accent) 16%, var(--bd));
  background:color-mix(in srgb, var(--bg) 68%, transparent);
  color:var(--txt) !important;
  font-weight:750;
}
.stg-page a {
  color:var(--accent) !important;
  font-weight:750;
  text-decoration:none;
}
.stg-page a:hover {
  text-decoration:underline;
}
.stg-page code {
  padding:2px 7px;
  border-radius:8px;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  background:color-mix(in srgb, var(--bg) 74%, transparent);
  color:var(--txt);
  font-family:var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
}
.stg-page br {
  line-height:1.8;
}
.mirror-custom-fields {
  padding:10px;
  border:1px solid color-mix(in srgb, var(--accent) 18%, var(--bd));
  border-radius:13px;
  background:color-mix(in srgb, var(--bg) 62%, transparent);
}
.mirror-input {
  min-height:36px;
  padding:8px 10px;
  border-radius:11px;
  font-size:12px;
  box-sizing:border-box;
}
#set-mirror-save {
  align-self:flex-end;
  min-height:34px;
  border-radius:11px;
  font-weight:800;
}

@media (max-width: 900px) {
  .stg-grid {
    grid-template-columns:1fr;
  }
  .stg-card[style*="grid-column"] {
    grid-column:auto !important;
  }
  .repo-tab {
    min-height:36px;
    padding:8px 12px;
  }
  .cr-creator-grid {
    grid-template-columns:1fr;
  }
  .gh-header {
    padding:0 10px 12px;
  }
  app-resource-manager .repo-layout {
    flex-direction:column;
  }
  app-resource-manager .rm-sidebar {
    width:auto !important;
    max-height:42vh;
    border-right:none !important;
    border-bottom:1px solid color-mix(in srgb, var(--accent) 20%, var(--bd)) !important;
  }
  .stg-page > div[style*="display:flex;gap:12px"] {
    flex-direction:column;
  }
}
`;
