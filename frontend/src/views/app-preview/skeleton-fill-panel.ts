// ===== skeleton-fill-panel.ts — fill3DPanel（从 skeleton-render.ts 拆出，ADR-040 P1）=====
// 填充 3D 信息面板：统计 + 纹理 + 模型选择 + 骨骼列表 + 详情框
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { buildDepthMap } from "./skeleton-utils.ts";
import type { BoneSelectInfo } from "../../utils/3d/model3d.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** fill3DPanel 需要的句柄子集（Model3DHandleX / YsmContentHandle 均满足——结构兼容） */
export interface PanelHandle {
  getModelGroupCount(): number;
  getBoneList(): Array<{ id: string; name: string; parentId?: string | null }>;
  setBoneVisible(name: string, visible: boolean): void;
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  _boneDetailEl: HTMLElement | null;
}

export function fill3DPanel(
  panel: HTMLDivElement,
  model: BedrockGeometry & {
    textures?: string[] | null;
    _modelPath?: string;
    textureNames?: string[];
    textureCategories?: string[];
    boneCount?: number;
    bones?: unknown[];
  },
  texArr: import("three").Texture[],
  spec: import("../../utils/3d/model3d.ts").Spec3D,
  _model3d: PanelHandle,
  modelSel: HTMLSelectElement,
): { boneContainer: HTMLElement | null; boneDetailText: HTMLElement } {
  // 组件化统计 + 纹理（随 modelSel 切换；ADR-114 perComponent 专属/全局双向）
  // 数据源（贴合真实，非猜测）：
  //  - 归属判定 spec.componentTextures[name]（存在=组件专属，否则走全局槽）
  //  - 全局槽 = spec.models[i].meshGroups[].texIdx（Go 真实设置的全局槽；专属组件为本地 0）
  //  - 纹理信息 model.textures[i] / textureNames[i] / texArr[i]（尺寸/加载态）
  const statsBox = document.createElement("div");
  statsBox.dataset.testid = "model-stats";
  panel.appendChild(statsBox);
  const texBox = document.createElement("div");
  texBox.dataset.testid = "tex-box";
  panel.appendChild(texBox);
  const compTex = (spec as { componentTextures?: Record<string, string[]> }).componentTextures;

  const renderComponent = (rawIdx: number): void => {
    // ── 统计（全量汇总 or 单组件） ──
    statsBox.innerHTML = "";
    statsBox.appendChild(sec("📐 模型统计", false));
    let bones = 0;
    let cubes = 0;
    let tw: number | string = "?";
    let th: number | string = "?";
    if (rawIdx < 0) {
      for (const m of spec.models || []) {
        const mm = m as { bones?: Array<{ _cubeCount?: number }>; textureWidth?: number; textureHeight?: number };
        bones += mm.bones?.length || 0;
        for (const b of mm.bones || []) cubes += b._cubeCount || 0;
      }
      const m0 = spec.models?.[0] as { textureWidth?: number; textureHeight?: number } | undefined;
      tw = m0?.textureWidth ?? "?";
      th = m0?.textureHeight ?? "?";
    } else {
      const mm = spec.models?.[rawIdx] as
        | { bones?: Array<{ _cubeCount?: number }>; textureWidth?: number; textureHeight?: number }
        | undefined;
      bones = mm?.bones?.length || 0;
      for (const b of mm?.bones || []) cubes += b._cubeCount || 0;
      tw = mm?.textureWidth ?? "?";
      th = mm?.textureHeight ?? "?";
    }
    statsBox.appendChild(iRow("骨骼", bones + " 根"));
    statsBox.appendChild(iRow("立方体", cubes + " 个"));
    // 声明尺寸 = spec.models[i].textureWidth/Height（模型声明值，非实际加载位图尺寸）
    statsBox.appendChild(iRow("声明尺寸", tw + "×" + th));

    // ── 纹理（只显示当前组件的绑定） ──
    const eff = rawIdx < 0 ? 0 : rawIdx;
    const mg = spec.models?.[eff] as
      | { name?: string; id?: string; textureWidth?: number; textureHeight?: number; meshGroups?: Array<{ texIdx?: number }> }
      | undefined;
    const compName = mg?.name || mg?.id || "main";
    // 当前组件声明尺寸（组件专属/全局共享都可引用；专属组件是独立 model，此字段即其声明）
    const decl =
      typeof mg?.textureWidth === "number" && typeof mg?.textureHeight === "number"
        ? mg.textureWidth + "×" + mg.textureHeight
        : "?";
    texBox.innerHTML = "";

    // 当前组件绑定摘要行
    const cap = document.createElement("div");
    cap.dataset.testid = "tex-binding";
    cap.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.6);padding:1px 0;margin-bottom:2px";
    texBox.appendChild(cap);

    // 组件专属纹理（componentTextures 命中 → 本地槽，不占全局切换）
    const ex = mg ? compTex?.[compName] : undefined;
    if (mg && ex?.length) {
      cap.innerHTML = `<span>当前组件绑定：${esc(compName)}</span><span style="color:rgba(255,255,255,0.9)">组件专属</span>`;
      const secEl = sec(`🎨 专属纹理 (${ex.length})`);
      secEl.dataset.testid = "tex-section";
      texBox.appendChild(secEl);
      ex.forEach((_uri, k) => {
        texBox.appendChild(texRow(compName + (ex.length > 1 ? " #" + (k + 1) : ""), k, null, { ex: true, decl }));
      });
      return;
    }

    // 全局共享：该组件 meshGroups.texIdx 去重；meshGroups 缺失（单组件/稀数据）
    // 回退到全部声明纹理（骨架测试同序断言：skin+tail 都在列，不吞信息）
    const slots: number[] = [];
    for (const msh of mg?.meshGroups || []) {
      const s = msh.texIdx;
      if (typeof s === "number" && s >= 0 && s < texArr.length && !slots.includes(s)) slots.push(s);
    }
    if (mg && slots.length === 0 && texArr.length > 0) {
      for (let i = 0; i < texArr.length; i++) slots.push(i);
    }
    cap.innerHTML = `<span>当前组件绑定：${esc(compName)}</span><span style="color:rgba(255,255,255,0.9)">槽 ${slots.map((s) => "[" + s + "]").join(" ") || "—"}</span>`;
    const secEl = sec(`🎨 纹理 (${slots.length})`);
    secEl.dataset.testid = "tex-section";
    texBox.appendChild(secEl);
    for (const s of slots) {
      const tex = texArr[s];
      const name = model.textureNames?.[s] || model.textures?.[s]?.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "纹理 " + (s + 1);
      const cat = model.textureCategories?.[s] || "";
      texBox.appendChild(texRow(name, s, tex ?? null, { cat, decl }));
    }
  };

  // 初始渲染（modelSel 此刻 value 多为空 → 落 main）；change 再切组件
  const initVal = parseInt(modelSel.value, 10);
  renderComponent(Number.isInteger(initVal) ? initVal : 0);
  modelSel.addEventListener("change", () => renderComponent(parseInt(modelSel.value, 10)));

  // 模型选择器
  const mgCount = _model3d.getModelGroupCount();
  if (mgCount > 1) {
    modelSel.style.display = "";
    const allOpt = document.createElement("option");
    allOpt.value = "-1";
    allOpt.textContent = t("preview.allComponents");
    allOpt.selected = true;
    modelSel.appendChild(allOpt);
    for (let i = 0; i < mgCount; i++) {
      // 防御：spec.models 与 getModelGroupCount 偶发不一致（数据损坏/版本错配）
      // 时不得因 undefined 访问崩溃整个 3D 面板
      const mgItem = (spec.models?.[i] ?? {}) as { name?: string; id?: string; bones?: unknown[] };
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = (mgItem.name || mgItem.id || "model") + " (" + (mgItem.bones?.length || 0) + ")";
      modelSel.appendChild(opt);
    }
  }

  // 骨骼列表
  const boneList = _model3d.getBoneList();
  let boneContainer: HTMLElement | null = null;
  if (boneList.length > 0) {
    const secHdr = document.createElement("div");
    secHdr.className = "bone-section-header";
    secHdr.dataset.testid = "bone-section";
    secHdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-top:12px;margin-bottom:4px";
    secHdr.innerHTML = `<span style="font-weight:600;color:rgba(255,255,255,0.9);font-size:12px">🦴 ${t("preview.bones", { n: boneList.length })}</span>`;
    const btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex;gap:4px";
    Array.of<[string, boolean]>(["👁", true], ["⊘", false]).forEach(([sym, v], i) => {
      const btn = document.createElement("button");
      btn.dataset.testid = v ? "bone-show-all" : "bone-hide-all";
      btn.textContent = sym;
      btn.style.cssText = "font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.6);cursor:pointer;line-height:1";
      btn.onclick = (): void => {
        boneList.forEach((b) => _model3d?.setBoneVisible(b.id, v));
        document.querySelectorAll("#preview-panel input[type=checkbox]").forEach((c) => ((c as HTMLInputElement).checked = v));
      };
      btnGroup.appendChild(btn);
    });
    secHdr.appendChild(btnGroup);
    panel.appendChild(secHdr);

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "bone-search";
    searchInput.dataset.testid = "bone-search";
    searchInput.placeholder = "🔍 过滤骨骼…";
    searchInput.style.cssText = "width:100%;padding:3px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-size:11px;font-family:inherit;box-sizing:border-box;margin-bottom:4px;outline:none";

    const depthMap = buildDepthMap(boneList);
    boneContainer = document.createElement("div");
    boneContainer.className = "bone-list";
    boneContainer.dataset.testid = "bone-list";
    boneContainer.style.cssText = "max-height:300px;overflow-y:auto";

    const renderBones = (filter: string): void => {
      boneContainer!.innerHTML = "";
      for (const b of boneList) {
        if (filter && !b.name.toLowerCase().includes(filter.toLowerCase())) continue;
        const depth = depthMap[b.id] || 0;
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;font-size:11px";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.style.cssText = "accent-color:var(--accent,#7c83ff);width:12px;height:12px;flex-shrink:0";
        cb.dataset.boneId = b.id;
        label.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = b.name;
        span.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        span.style.marginLeft = depth * 12 + "px";
        label.appendChild(span);
        boneContainer!.appendChild(label);
      }
    };
    searchInput.oninput = (): void => renderBones(searchInput.value);
    panel.appendChild(searchInput);
    panel.appendChild(boneContainer);
    renderBones("");
  }

  // 骨骼详情框
  const boneDetail = document.createElement("div");
  boneDetail.className = "bone-detail";
  boneDetail.dataset.testid = "bone-detail";
  boneDetail.style.cssText = "margin-top:6px;border-radius:3px;font-size:10px;color:rgba(255,255,255,0.7);line-height:1.5;display:none;font-family:inherit";
  const boneDetailText = document.createElement("div");
  boneDetailText.className = "bone-detail-text";
  boneDetailText.dataset.testid = "bone-detail-text";
  boneDetailText.style.cssText = "padding:4px 6px;background:rgba(255,255,255,0.05);border-radius:3px 3px 0 0;white-space:pre;max-height:100px;overflow-y:auto";
  const boneDetailCopy = document.createElement("button");
  boneDetailCopy.className = "bone-detail-copy";
  boneDetailCopy.dataset.testid = "bone-detail-copy";
  boneDetailCopy.textContent = "📋 " + t("common.copy");
  boneDetailCopy.style.cssText = "font-size:10px;padding:1px 6px;border:none;background:rgba(124,131,255,0.3);color:#fff;cursor:pointer;border-radius:0 0 3px 3px;width:100%;font-family:inherit";
  boneDetailCopy.onclick = function (): void {
    const txt = boneDetailText.textContent || "";
    navigator.clipboard.writeText(txt)
      .then(() => {
        boneDetailCopy.textContent = "✅ " + t("preview.copied");
        setTimeout(() => { boneDetailCopy.textContent = "📋 " + t("common.copy"); }, 1500);
      })
      .catch(() => { boneDetailCopy.textContent = "📋 " + t("common.copy"); });
  };
  boneDetail.appendChild(boneDetailText);
  boneDetail.appendChild(boneDetailCopy);
  panel.appendChild(boneDetail);
  _model3d._boneDetailEl = boneDetailText;

  return { boneContainer, boneDetailText };
}

// ===== 内部辅助（从 skeleton-render.ts 复用）=====
function sec(label: string, border = true): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "stat-section";
  d.dataset.testid = "stat-section";
  d.style.cssText = `font-weight:600;color:rgba(255,255,255,0.9);font-size:11px;margin-top:${border ? "12px" : "0"};margin-bottom:4px;border-top:${border ? "1px solid rgba(255,255,255,0.1)" : "none"};padding-top:${border ? "6px" : "0"}`;
  d.textContent = label;
  return d;
}
function iRow(k: string, v: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "stat-row";
  d.dataset.testid = "stat-" + k.toLowerCase();
  d.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.6);padding:1px 0";
  d.innerHTML = `<span>${k}</span><span style="color:rgba(255,255,255,0.9)">${v}</span>`;
  return d;
}
// 纹理归一行：左侧名称（截断）；右侧区分「声明尺寸」与「加载尺寸」/
// 组件专属徽标。声明 = spec.models[i].textureWidth/Height（opt.decl），
// 加载 = tex.userData.imgWidth/imgHeight（实际位图；专属纹理无加载对象时只显示声明）。
function texRow(
  name: string,
  _slot: number,
  tex: import("three").Texture | null,
  opt: { cat?: string; ex?: boolean; decl?: string } = {},
): HTMLDivElement {
  const d = document.createElement("div");
  d.dataset.testid = "tex-row";
  d.style.cssText = "display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:10px;color:rgba(255,255,255,0.7);padding:1px 0";
  const left = document.createElement("span");
  left.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0";
  left.textContent = name;
  d.appendChild(left);
  const right = document.createElement("span");
  right.style.cssText = "flex-shrink:0;color:rgba(255,255,255,0.5)";
  const declT = opt.decl ?? "?";
  if (opt.ex) {
    // 专属纹理无单独加载位图句柄 → 只给声明尺寸，避免「专属」看不出大小
    right.textContent = "专属 · 声明 " + declT;
  } else {
    const ud = (tex as unknown as { userData?: { imgWidth?: unknown; imgHeight?: unknown } })?.userData;
    const w = typeof ud?.imgWidth === "number" ? ud.imgWidth : null;
    const h = typeof ud?.imgHeight === "number" ? ud.imgHeight : null;
    const size = w !== null && h !== null ? w + "×" + h : "?";
    const catPart = opt.cat ? opt.cat + " · " : "";
    right.textContent = `${catPart}声明 ${declT} · 加载 ${size}`;
  }
  d.appendChild(right);
  return d;
}
