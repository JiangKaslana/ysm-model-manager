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
  // 统计
  const mg = spec.models?.[0] as
    | { bones?: Array<{ _cubeCount?: number }>; textureWidth?: number; textureHeight?: number; name?: string; id?: string }
    | undefined;
  let totalCubes = 0;
  for (const b of mg?.bones || []) totalCubes += b._cubeCount || 0;
  panel.appendChild(sec("📐 模型统计", false));
  panel.appendChild(iRow("骨骼", (mg?.bones?.length || 0) + " 根"));
  panel.appendChild(iRow("立方体", totalCubes + " 个"));
  panel.appendChild(iRow("纹理尺寸", (mg?.textureWidth || "?") + "×" + (mg?.textureHeight || "?")));

  // 纹理列表
  if (texArr.length > 0) {
    // 按 textureCategories 区分可切换皮肤（player）与组件专属纹理
    const cats = model.textureCategories || [];
    const switchableCount = cats.filter((c) => c === "player").length || texArr.length;
    panel.appendChild(sec("🎨 纹理 (" + switchableCount + ")" + (texArr.length > switchableCount ? " / " + texArr.length + " 全量" : "")));
    // 当前组件绑定：显示选中组件声明的纹理（方案 B：声明纹理 vs 实际绑定两层显示）
    const bindingRow = document.createElement("div");
    bindingRow.className = "binding-row";
    bindingRow.dataset.testid = "tex-binding";
    bindingRow.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.6);padding:1px 0;margin-bottom:2px";
    const bindingLabel = document.createElement("span");
    bindingLabel.textContent = "当前组件绑定";
    const bindingValue = document.createElement("span");
    bindingValue.style.color = "rgba(255,255,255,0.9)";
    bindingValue.textContent = "全量";
    bindingRow.appendChild(bindingLabel);
    bindingRow.appendChild(bindingValue);
    panel.appendChild(bindingRow);
    // 组件选择器 onchange 追加更新绑定行（不覆盖已有 showModelGroup）
    // texArrOrder[idx] = 组件 idx 声明的纹理名（Go 端按 texSlot 分配，多组件可共享同一张）。
    // 注意：perComponent 组件（arrow/载具/⊗ 投射物，纹理在 ComponentTextures）texArrOrder 为
    // 空串，不能直接显示「全量」——那会把「组件已绑定专属纹理」的事实藏掉（wine_fox arrow 只读
    // skin 的观感根因）。命中 componentTextures 时按组件名诚实地显示其专属纹理。
    const texArrOrder = (spec as { texArrOrder?: string[] }).texArrOrder;
    const componentTextures = (spec as { componentTextures?: Record<string, string[]> }).componentTextures;
    const updateBinding = (): void => {
      const idx = parseInt(modelSel.value, 10);
      if (isNaN(idx) || idx < 0) {
        bindingValue.textContent = "全量";
        return;
      }
      const declared = texArrOrder?.[idx];
      if (declared) {
        bindingValue.textContent = declared;
        return;
      }
      // perComponent 组件：按 spec.models[idx].name（SourceName）查 componentTextures
      const mgName = (spec.models as Array<{ name?: string; id?: string }> | undefined)?.[idx]?.name;
      if (mgName && componentTextures?.[mgName]?.length) {
        bindingValue.textContent = mgName + "（组件专属）";
        return;
      }
      bindingValue.textContent = "全量";
    };
    modelSel.addEventListener("change", updateBinding);
    for (let i = 0; i < texArr.length; i++) {
      const tex = texArr[i];
      const w = tex?.userData?.imgWidth || (tex?.image as HTMLImageElement | undefined)?.naturalWidth || 0;
      const h = tex?.userData?.imgHeight || (tex?.image as HTMLImageElement | undefined)?.naturalHeight || 0;
      const url = model.textures?.[i] || "";
      const name = model.textureNames?.[i] || url.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "纹理 " + (i + 1);
      const d = document.createElement("div");
      d.className = "tex-row";
      d.dataset.testid = "tex-" + i;
      d.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer";
      const img = document.createElement("canvas");
      img.width = 16;
      img.height = 16;
      img.style.cssText = "width:16px;height:16px;border-radius:2px;flex-shrink:0;border:1px solid rgba(255,255,255,0.1)";
      const tCtx = img.getContext("2d");
      if (tex?.image) tCtx!.drawImage(tex.image as HTMLImageElement, 0, 0, 16, 16);
      d.appendChild(img);
      const cat = cats[i] || "";
      const catLabel = cat && cat !== "player" ? cat : "";
      const catBadge = catLabel ? `<span style="color:rgba(255,255,255,0.35);font-size:9px;padding:0 4px;border:1px solid rgba(255,255,255,0.12);border-radius:3px;flex-shrink:0">${catLabel}</span>` : "";
      d.innerHTML += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(name)}</span>${catBadge}<span style="color:rgba(255,255,255,0.4);font-size:10px;flex-shrink:0">${w}×${h}</span>`;
      panel.appendChild(d);
    }
  }

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
