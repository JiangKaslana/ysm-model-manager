// ===== YSM 3D 专属控件（ADR-066 §5.6 方案 A + §5.7 查看器范式）=====
// adapter 保持「内容构建 + 装配」单一职责；YSM 专属 UI（纹理选择 / 截图 /
// 模型组选择 / 骨骼面板接线）集中于此。
//
// §5.7 交互范式（对齐 MikuMikuAR 玻璃 HUD）：3D 全屏沉浸、无常驻侧栏——
// 功能经「底部悬浮导航」按域分组，点击弹出 280px 毛玻璃弹窗，用完即关：
//   - 模型菜单：统计 / 纹理列表 / 骨骼列表（搜索+显隐）/ 骨骼详情 / 多组件切换
//   - 视图菜单：相机控件（旋转/速度/重置，复用 core buildCameraControls）+ 截图
// 截图属视图域子项，不当根菜单；顶部仅保留 core 的 ✕ 关闭。

import * as THREE from "three";
import { ensureFabStyles } from "../../utils/dom/fab.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { saveScreenshot } from "./skeleton-render.ts";
import { fill3DPanel } from "./skeleton-fill-panel.ts";
import { buildCameraControls, type CameraControlBridge } from "../../utils/3d/adapters/mount-preview-core.ts";
import type { Spec3D, BoneSelectInfo } from "../../utils/3d/model3d.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** 模型对象（对齐 fill3DPanel / saveScreenshot 的字段需求；ysm-adapter 复用此类型） */
export type YsmModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  boneCount?: number;
  bones?: unknown[];
};

/** YSM 内容层句柄（shared 化：相机操作走核心 cameraControls，本句柄只管内容/骨骼） */
export interface YsmContentHandle {
  showModelGroup(i: number): void;
  getModelGroupCount(): number;
  setBoneVisible(name: string, visible: boolean): void;
  toggleBone(name: string): void;
  getBoneList(): Array<{ id: string; name: string; parentId?: string | null }>;
  /** 骨骼拾取回调（由控件层设置，适配器转发到 raycast state） */
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  /** 骨骼详情框（fill3DPanel 写入） */
  _boneDetailEl: HTMLElement | null;
}

/** 控件装配上下文：由 ysm-adapter 在 buildYsmScene 内组装传入 */
export interface YsmControlsContext {
  model: YsmModel;
  /** 当前纹理下标（纹理选择器初始值） */
  texIdx: number;
  /** preloadModel 返回的纹理数组（可能含 null——缺失纹理占位，fill3DPanel 内断言） */
  texArr: (THREE.Texture | null)[];
  spec: Spec3D;
  /** YSM 内容层句柄（模型组/骨骼显隐/拾取回调） */
  handle: YsmContentHandle;
  /** shared 模式下核心的相机控制桥（视图菜单旋转/速度/重置复用） */
  cameraControls?: CameraControlBridge;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
}

/** 底部导航按钮 */
function mkNavBtn(icon: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ysm-3d-navbtn";
  const ic = document.createElement("span");
  ic.className = "ysm-ic";
  ic.textContent = icon;
  const lb = document.createElement("span");
  lb.className = "ysm-3d-navlabel";
  lb.textContent = label;
  b.appendChild(ic);
  b.appendChild(lb);
  b.setAttribute("aria-label", label);
  return b;
}

/** 弹窗区块标题（对齐 MikuMikuAR section-title 分组） */
function popupSection(title: string, popup: HTMLElement): void {
  const s = document.createElement("div");
  s.className = "ysm-3d-popsec";
  s.textContent = title;
  popup.appendChild(s);
}

/** 弹窗行（label + 控件） */
function popupRow(label: string, popup: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "ysm-3d-poprow";
  if (label) {
    const lb = document.createElement("span");
    lb.className = "ysm-3d-poplabel";
    lb.textContent = label;
    row.appendChild(lb);
  }
  popup.appendChild(row);
  return row;
}

/** 连点/多菜单触发时忽略并发（防重复保存文件）——对齐原 skeleton.ts makeShotGuard */
function makeShotGuard(): { saving: boolean; setSaving: (v: boolean) => void } {
  let _saving = false;
  return {
    get saving() {
      return _saving;
    },
    setSaving: (v: boolean) => {
      _saving = v;
    },
  };
}

/**
 * 在统一外壳（overlay）挂载底部悬浮导航 + 分类弹窗（§5.7 范式）。
 * 无常驻侧栏：模型菜单（fill3DPanel 内容）与视图菜单（相机控件 + 截图）按需弹出。
 * 弹窗容器复用 id `ysm-3d-panel`——fill3DPanel 内部「全显/全隐」选择器依赖此 id。
 */
export function buildYsmBottomNav(
  overlay: HTMLElement,
  ctx: YsmControlsContext,
): void {
  ensureFabStyles();

  const nav = document.createElement("div");
  nav.className = "ysm-3d-nav";
  const modelBtn = mkNavBtn("🧍", t("preview.modelInfo"));
  const viewBtn = mkNavBtn("🎥", t("preview.cameraView"));
  nav.appendChild(modelBtn);
  nav.appendChild(viewBtn);
  overlay.appendChild(nav);

  const popup = document.createElement("div");
  popup.id = "ysm-3d-panel"; // fill3DPanel 全显/全隐选择器依赖
  popup.className = "ysm-3d-popup";
  popup.style.display = "none";
  overlay.appendChild(popup);

  // 多模型组选择器（模型菜单内按需显示，fill3DPanel 消费）
  const modelSel = document.createElement("select");
  modelSel.className = "ysm-3d-popselect";
  modelSel.style.display = "none";
  modelSel.onchange = (): void => {
    ctx.handle.showModelGroup(parseInt(modelSel.value, 10));
  };

  /** 关闭弹窗（nav 激活态同步） */
  const closePopup = (): void => {
    popup.style.display = "none";
    popup.innerHTML = "";
    nav
      .querySelectorAll<HTMLElement>(".ysm-3d-navbtn--on")
      .forEach((b) => b.classList.remove("ysm-3d-navbtn--on"));
  };

  /** 切换弹窗：同菜单再点收起，跨菜单切换内容 */
  const togglePopup = (fill: () => void, btn: HTMLElement): void => {
    const wasOpen = popup.style.display !== "none";
    const isSame = btn.classList.contains("ysm-3d-navbtn--on");
    closePopup();
    if (wasOpen && isSame) return;
    btn.classList.add("ysm-3d-navbtn--on");
    fill();
    popup.style.display = "flex";
  };

  // ── 模型菜单：统计 / 纹理 / 骨骼列表 / 骨骼详情 / 多组件切换 ──
  const fillModelMenu = (): void => {
    popup.innerHTML = "";
    if (ctx.handle.getModelGroupCount() > 1) {
      modelSel.style.display = "";
      popup.appendChild(modelSel);
    }
    fill3DPanel(
      popup as HTMLDivElement,
      ctx.model,
      ctx.texArr as THREE.Texture[],
      ctx.spec as Spec3D,
      ctx.handle,
      modelSel,
    );
  };

  // ── 视图菜单：相机控件（旋转/速度/重置）+ 截图 ──
  const fillViewMenu = (): void => {
    popup.innerHTML = "";
    popupSection(t("preview.cameraRotation"), popup);
    popupRow("", popup);

    // 相机控件（旋转模式 / 速度 / 重置视角）复用 core 通用构建器——
    // §5.7 shared 化：bridge 操作核心 cameraControls（统一相机状态），
    // 不再经内容句柄（内容层只管模型/骨骼）。
    buildCameraControls(popup, {
      getOrbit: () => ctx.cameraControls?.getOrbit() ?? safeGet("td-rot-mode") !== "free",
      setOrbit: (v: boolean) => ctx.cameraControls?.setOrbit(v),
      getSpeed: () => ctx.cameraControls?.getSpeed() ?? Number(safeGet("td-cam-speed") || "20"),
      setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
      reset: () => ctx.cameraControls?.reset(),
    });

    // 截图（视图域子项，非根菜单）
    popupSection(t("preview.screenshot"), popup);
    const shot = makeShotGuard();
    const shotKeys = ["current", "front", "45", "side", "back45", "all"] as const;
    const shotLabels = [
      t("preview.screenshotCurrent"),
      t("preview.screenshotFront"),
      t("preview.screenshot45"),
      t("preview.screenshotSide"),
      t("preview.screenshotBack45"),
      t("preview.screenshotAll"),
    ];
    const saveShot = async (key: string): Promise<void> => {
      if (shot.saving) return;
      shot.setSaving(true);
      try {
        await saveScreenshot(ctx.model, key, () => {});
      } catch (e) {
        console.error("[3D 截图]", e);
        bus.emit("toast:show", {
          msg: "截图保存失败：" + friendlyError(e),
          duration: 4000,
          type: "error",
        });
      } finally {
        shot.setSaving(false);
      }
    };
    shotKeys.forEach((key, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ysm-3d-popbtn ysm-3d-popbtn--row";
      item.textContent = "📷 " + shotLabels[i];
      item.onclick = (): void => {
        void saveShot(key);
      };
      popup.appendChild(item);
    });
  };

  modelBtn.onclick = (): void => togglePopup(fillModelMenu, modelBtn);
  viewBtn.onclick = (): void => togglePopup(fillViewMenu, viewBtn);

  // 骨骼拾取：模型菜单弹窗内的详情框联动；弹窗未开时自动打开模型菜单（检视入口）
  ctx.handle.onBoneSelect = (info: BoneSelectInfo): void => {
    let detailEl = ctx.handle._boneDetailEl;
    if (!detailEl) {
      // 详情框在模型菜单弹窗内：未渲染则先打开模型菜单（幂等）
      if (popup.style.display === "none") {
        togglePopup(fillModelMenu, modelBtn);
      }
      detailEl = ctx.handle._boneDetailEl;
    }
    if (detailEl) {
      detailEl.textContent = formatBoneInfo(info);
      if (detailEl.parentNode) (detailEl.parentNode as HTMLElement).style.display = "block";
    }
    const bc = document.querySelector<HTMLElement>('#ysm-3d-panel [style*="max-height:300px"]');
    if (bc) {
      for (const lbl of bc.querySelectorAll<HTMLLabelElement>("label")) {
        const sp = lbl.querySelector("span");
        if (sp && sp.textContent === info.name) {
          lbl.scrollIntoView({ block: "nearest", behavior: "smooth" });
          lbl.style.background = "rgba(124,131,255,0.25)";
          setTimeout(() => {
            lbl.style.background = "";
          }, 1500);
          break;
        }
      }
    }
  };
}

/** 骨骼信息文本（对齐原 skeleton.ts onBoneSelect 格式） */
function formatBoneInfo(info: BoneSelectInfo): string {
  let txt =
    "🦴 " +
    info.name +
    "\n路径: " +
    info.path +
    "\n父骨骼: " +
    (info.parent || "(无)") +
    "\n子骨骼: " +
    info.children.length +
    " 个\nMesh: " +
    info.meshCount +
    "\nlocalPos: (" +
    info.localPos.map((v) => v.toFixed(3)).join(", ") +
    ")\n世界坐标: (" +
    info.worldPos.map((v) => v.toFixed(2)).join(", ") +
    ")";
  if (info.localRot) txt += "\nlocalRot: (" + info.localRot.map((v) => v.toFixed(4)).join(", ") + ")";
  if (info.cubeRot) txt += "\ncubeRot: (" + info.cubeRot.map((v) => v.toFixed(4)).join(", ") + ")";
  if (info.cubePos) txt += "\ncubePos: (" + info.cubePos.map((v) => v.toFixed(3)).join(", ") + ")";
  return txt;
}
