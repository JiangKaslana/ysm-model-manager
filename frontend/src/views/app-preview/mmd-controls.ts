// ===== MMD 菜单面板填充（ADR-076 v2 Phase 2：底部导航收编进声明式根菜单）=====
// 旧 buildMmdBottomNav / mkNavBtn / slide-menu 弹窗已删除——mmd 专属面板（模型信息+
// 表情 / 材质 / 播放）由 mmd-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
// 切换模型归 core 根菜单 switch 项（needsSiblings）；相机归 core camera 项（sharedOnly）。
// 材质面板 buildMaterialControls 保留复用（纯渲染层，状态经 bridge 下沉 mmd-materials.ts，ADR-072）。

import * as THREE from "three";
import type { MMD } from "@moeru/three-mmd";
import { t } from "../../core/i18n/t.ts";
import { cardContainer, addFieldRow } from "../../ui/ui-helpers.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
  type MmdMaterialDetail,
  type MmdMaterialListItem,
} from "../../utils/3d/mmd-materials.ts";
import type { CameraControlBridge } from "../../utils/3d/adapters/mount-preview-core.ts";
export type { CameraControlBridge };

export interface MmdBottomNavCtx {
  mmd: MMD;
  mesh: THREE.SkinnedMesh;
  modelName: string;
  /** 当前模型完整路径（切换区「当前」高亮判断；Phase 2 后切换归 core switch 项，本字段保留兼容） */
  modelPath?: string;
  /** shared 模式下核心的相机控制桥（Phase 2 后相机归 core camera 项，本字段保留兼容） */
  cameraControls?: CameraControlBridge;
  /** 切换到另一模型（复用核心外壳重建内容层；Phase 2 后归 core switch 项，本字段保留兼容） */
  switchTo?(path: string): Promise<void>;
}

/** MMD 模型面板：信息卡 + 表情列表（morph 权重 0/1 切换，✓ 高亮当前开启） */
export function fillMmdModelPanel(list: HTMLElement, ctx: MmdBottomNavCtx): void {
  const pmx = ctx.mmd.pmx;
  cardContainer(list, (c) => {
    addFieldRow(c, t("preview.nameLabel"), ctx.modelName);
    addFieldRow(
      c,
      t("preview.modelOverview"),
      `${pmx.bones.length} 骨骼 · ${pmx.materials.length} 材质 · ${pmx.morphs.length} 表情`,
    );
  });
  const morphNames = Object.keys(ctx.mesh.morphTargetDictionary || {});
  if (morphNames.length === 0) return;
  const sec = document.createElement("div");
  sec.className = "slide-sublabel";
  sec.style.cssText = "padding:6px 10px;font-size:12px;color:rgba(255,255,255,0.7)";
  sec.textContent = `😀 ${t("preview.mmdMorph")} (${morphNames.length})`;
  list.appendChild(sec);
  morphNames.forEach((name) => {
    const row = document.createElement("div");
    row.className = "ysm-preview-menu-row";
    row.dataset.testid = "mmd-morph-" + name;
    const dict = ctx.mesh.morphTargetDictionary || {};
    const idx = dict[name];
    const active = idx !== undefined && (ctx.mesh.morphTargetInfluences?.[idx] ?? 0) > 0.5;
    const ic = document.createElement("span");
    ic.textContent = active ? "✓" : "🙂";
    ic.style.cssText = "font-size:15px;width:18px;text-align:center";
    const lb = document.createElement("span");
    lb.textContent = name;
    row.append(ic, lb);
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:13px" +
      (active ? ";background:rgba(124,131,255,0.25)" : "");
    row.onclick = (): void => {
      const d = ctx.mesh.morphTargetDictionary || {};
      const i = d[name];
      if (i === undefined || !ctx.mesh.morphTargetInfluences) return;
      ctx.mesh.morphTargetInfluences[i] = ctx.mesh.morphTargetInfluences[i] > 0.5 ? 0 : 1;
      const now = ctx.mesh.morphTargetInfluences[i] > 0.5;
      ic.textContent = now ? "✓" : "🙂";
      row.style.background = now ? "rgba(124,131,255,0.25)" : "transparent";
    };
    list.appendChild(row);
  });
}

/** MMD 播放/动作控制桥（mmd-adapter 组装，纯逻辑层状态） */
export interface MmdPlayBridge {
  clips: Array<{ label: string }>;
  isPlaying(): boolean;
  toggle(): void;
  currentIndex(): number;
  select(index: number): void;
}

/** MMD 播放面板：播放/暂停 + 多动作切换（原 mmd-adapter extraControls 收编，ADR-076 v2 Phase 2） */
export function fillMmdPlayPanel(list: HTMLElement, bridge: MmdPlayBridge): void {
  const playBtn = document.createElement("button");
  playBtn.id = "mmd-play-btn";
  playBtn.textContent = bridge.isPlaying() ? t("preview.mmdPause") : t("preview.mmdPlay");
  playBtn.className = "mode-btn"; // 🥉 ui/ 库透明按钮样式（installUiComponentsStyles 注入）
  playBtn.dataset.testid = "mmd-play"; // §19.1：关键交互元素 data-testid（前缀命名空间）
  playBtn.style.cssText = "align-self:flex-start;margin:2px 0";
  playBtn.onclick = (): void => {
    bridge.toggle();
    playBtn.textContent = bridge.isPlaying() ? t("preview.mmdPause") : t("preview.mmdPlay");
  };
  list.appendChild(playBtn);

  if (bridge.clips.length > 1) {
    const sel = document.createElement("select");
    sel.id = "mmd-motion-sel";
    sel.className = "setting-select"; // 🥉 ui/ 库下拉样式
    sel.dataset.testid = "mmd-motion"; // §19.1
    sel.value = String(bridge.currentIndex());
    bridge.clips.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.label;
      sel.appendChild(opt);
    });
    sel.onchange = (): void => {
      bridge.select(Number(sel.value) || 0);
    };
    list.appendChild(sel);
  }
}

/** 材质控制桥：复用 mmd-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在视图层（ADR-072） */
export interface MaterialControlBridge {
  /** 材质清单（index 与 mesh.material 对齐） */
  list(): MmdMaterialListItem[];
  /** 材质详情（当前可见/透明） */
  getDetail(index: number): MmdMaterialDetail | null;
  /** 设置显隐（Material.visible） */
  setVisible(index: number, visible: boolean): void;
  /** 设置透明度（0-1，联动 transparent） */
  setOpacity(index: number, opacity: number): void;
}

/**
 * 在 container 渲染 MMD 材质面板：每行 = 显隐开关（👁/🚫）+ 名称 + 透明度滑条。
 * 复用 🥉 slide-item 行样式，控件走行内样式（对齐 buildCameraControls 口径）。
 * 纯渲染层——所有状态变更经 bridge 下沉到 mmd-materials.ts，本函数零业务逻辑。
 */
export function buildMaterialControls(container: HTMLElement, bridge: MaterialControlBridge): void {
  const items = bridge.list();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "slide-sublabel";
    empty.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
    empty.textContent = "（无材质）";
    container.appendChild(empty);
    return;
  }
  items.forEach((it) => {
    const detail = bridge.getDetail(it.index);
    const visible = detail?.visible ?? true;
    const opacity = Math.round((detail?.opacity ?? 1) * 100);

    const row = document.createElement("div");
    row.className = "slide-item mmd-mat-row";
    row.setAttribute("data-testid", "mmd-mat-" + it.index);
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "mmd-mat-eye";
    eye.title = visible ? "隐藏" : "显示";
    eye.textContent = visible ? "👁" : "🚫";
    eye.style.cssText =
      "flex:0 0 auto;background:none;border:none;cursor:pointer;font-size:14px;padding:0 6px 0 0;line-height:1";
    eye.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      const cur = bridge.getDetail(it.index)?.visible ?? true;
      bridge.setVisible(it.index, !cur);
      const nv = bridge.getDetail(it.index)?.visible ?? true;
      eye.textContent = nv ? "👁" : "🚫";
      eye.title = nv ? "隐藏" : "显示";
    };

    const label = document.createElement("span");
    label.className = "slide-label";
    label.textContent = it.name;
    label.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0";

    const op = document.createElement("input");
    op.type = "range";
    op.min = "0";
    op.max = "100";
    op.value = String(opacity);
    op.className = "mmd-mat-op";
    op.setAttribute("data-testid", "mmd-mat-op-" + it.index);
    op.style.cssText = "flex:0 0 auto;width:72px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
    op.oninput = (): void => {
      bridge.setOpacity(it.index, Number(op.value) / 100);
    };
    op.onclick = (e: MouseEvent): void => e.stopPropagation();

    row.appendChild(eye);
    row.appendChild(label);
    row.appendChild(op);
    row.onclick = (): void => {
      eye.click();
    };
    container.appendChild(row);
  });
}
