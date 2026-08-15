// ===== YSM 3D 专属控件（ADR-066 §5.6 方案 A：从 ysm-adapter 拆出的控件层）=====
// adapter 保持「内容构建 + 装配」单一职责；YSM 专属 UI（纹理选择 / 截图菜单 /
// 模型组选择 / 骨骼面板接线）集中于此，相机控件（旋转/速度/重置）复用 core 的
// buildCameraControls（shared/self 双模式单点，消灭双份实现）。

import * as THREE from "three";
import { createIconButton, ensureFabStyles } from "../../utils/dom/fab.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { saveScreenshot, type Model3DHandleX } from "./skeleton-render.ts";
import { fill3DPanel } from "./skeleton-fill-panel.ts";
import { buildCameraControls } from "./mount-preview-core.ts";
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

/** 控件装配上下文：由 ysm-adapter 在 buildYsmScene 内组装传入 */
export interface YsmControlsContext {
  model: YsmModel;
  /** 当前纹理下标（纹理选择器初始值） */
  texIdx: number;
  /** preloadModel 返回的纹理数组（可能含 null——缺失纹理占位，fill3DPanel 内断言） */
  texArr: (THREE.Texture | null)[];
  spec: Spec3D;
  /** renderModel3D 返回的句柄（旋转/速度/重置/模型组/骨骼拾取回调） */
  handle: Model3DHandleX;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
}

/** 连点/多菜单触发时忽略并发（防重复保存文件）——对齐原 skeleton.ts makeShotGuard */
function makeShotGuard(shotBtn: HTMLElement): {
  saving: boolean;
  setSaving: (v: boolean) => void;
  setIcon: (icon: string) => void;
} {
  let _saving = false;
  const setIcon = (icon: string): void => {
    const ic = shotBtn.querySelector<HTMLElement>(".ysm-ic");
    if (ic) ic.textContent = icon;
  };
  return {
    get saving() {
      return _saving;
    },
    setSaving: (v: boolean) => {
      _saving = v;
    },
    setIcon,
  };
}

/**
 * 在统一 topBar 追加 YSM 专属控件（纹理选择 / 截图菜单 / 模型组选择 + 通用相机控件）。
 * 返回模型组选择器引用（extraPanel 的 fill3DPanel 消费，默认隐藏按需显示）。
 */
export function buildYsmTopBarControls(
  topBar: HTMLElement,
  ctx: YsmControlsContext,
): { modelSel: HTMLSelectElement | null } {
  ensureFabStyles();

  // ── 多纹理选择器（仅多纹理模型出现）──
  if ((ctx.model.textures?.length ?? 0) > 1) {
    const texSel = document.createElement("select");
    texSel.className = "ysm-ovl-select";
    ctx.model.textures!.forEach((_, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${t("preview.texture")} ${i + 1}`;
      texSel.appendChild(opt);
    });
    texSel.value = String(ctx.texIdx);
    texSel.onchange = (): void => {
      const idx = parseInt(texSel.value, 10);
      ctx.onTextureChange?.(idx);
    };
    topBar.appendChild(texSel);
  }

  const spacer = document.createElement("div");
  spacer.className = "ysm-ovl-spacer";
  topBar.appendChild(spacer);

  // ── 截图按钮 + 菜单（6 角度）──
  const shotWrap = document.createElement("div");
  shotWrap.className = "ysm-ovl-shotwrap";
  const shotBtn = createIconButton({
    icon: "\u{1F4F7}",
    label: t("preview.screenshot"),
    title: t("preview.screenshot"),
  });
  shotBtn.className = "ysm-ovl-btn ysm-ovl-shotbtn";
  shotBtn.setAttribute("aria-label", t("preview.screenshot") + " menu");
  const arrowSpan = document.createElement("span");
  arrowSpan.style.marginLeft = "4px";
  arrowSpan.textContent = " ▾";
  shotBtn.appendChild(arrowSpan);
  const shotMenu = document.createElement("div");
  shotMenu.className = "ysm-ovl-shotmenu";
  const shotItems = [
    { label: t("preview.screenshotCurrent"), key: "current" },
    { label: t("preview.screenshotFront"), key: "front" },
    { label: t("preview.screenshot45"), key: "45" },
    { label: t("preview.screenshotSide"), key: "side" },
    { label: t("preview.screenshotBack45"), key: "back45" },
    { label: t("preview.screenshotAll"), key: "all" },
  ];
  shotItems.forEach((item) => {
    const el = document.createElement("div");
    el.textContent = item.label;
    el.className = "ysm-ovl-shotitem";
    el.setAttribute("aria-label", t("preview.screenshot") + " — " + item.label);
    shotMenu.appendChild(el);
  });
  shotWrap.appendChild(shotBtn);
  shotWrap.appendChild(shotMenu);
  topBar.appendChild(shotWrap);

  const shot = makeShotGuard(shotBtn);
  const shotKeys = ["current", "front", "45", "side", "back45", "all"];
  const saveShot = async (key: string): Promise<void> => {
    if (shot.saving) return;
    shot.setSaving(true);
    try {
      await saveScreenshot(ctx.model, key, shot.setIcon);
    } catch (e) {
      shot.setIcon("❌");
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
  shotMenu
    .querySelectorAll<HTMLElement>(".ysm-ovl-shotitem")
    .forEach((el, i) => {
      el.onclick = (): void => {
        shotMenu.style.display = "none";
        saveShot(shotKeys[i]);
      };
    });
  shotBtn.addEventListener("pointerenter", () => {
    shotMenu.style.display = "block";
  });
  shotBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    shotMenu.style.display = shotMenu.style.display === "block" ? "none" : "block";
  });
  shotWrap.addEventListener("pointerleave", () => {
    shotMenu.style.display = "none";
  });

  // ── 模型组选择器（fill3DPanel 内按需显示，默认隐藏）──
  let modelSel: HTMLSelectElement | null = null;
  modelSel = document.createElement("select");
  modelSel.className = "ysm-ovl-select";
  modelSel.style.display = "none";
  modelSel.onchange = (): void => {
    ctx.handle.showModelGroup(parseInt(modelSel!.value, 10));
  };
  topBar.appendChild(modelSel);

  // ── 相机控件（旋转模式 / 速度 / 重置视角）：复用 core 通用构建器 ──
  buildCameraControls(topBar, {
    getOrbit: () => safeGet("td-rot-mode") !== "free",
    setOrbit: (v: boolean) => {
      ctx.handle.setRotationMode(v);
    },
    getSpeed: () => Number(safeGet("td-cam-speed") || "20"),
    setSpeed: (n: number) => {
      ctx.handle.setSpeed(n);
    },
    reset: () => ctx.handle.resetCamera(),
  });

  return { modelSel };
}

/**
 * 在核心侧栏挂载 YSM 骨骼面板（fill3DPanel）+ 骨骼拾取接线。
 * modelSel 由 buildYsmTopBarControls 创建传入（多组件模型 fill3DPanel 内按需显示）。
 */
export function buildYsmPanel(
  panel: HTMLElement,
  ctx: YsmControlsContext,
  modelSel: HTMLSelectElement,
): void {
  fill3DPanel(
    panel as HTMLDivElement,
    ctx.model,
    ctx.texArr as THREE.Texture[],
    ctx.spec as Spec3D,
    ctx.handle,
    modelSel,
  );
  ctx.handle.onBoneSelect = (info: BoneSelectInfo): void => {
    const detailEl = ctx.handle._boneDetailEl;
    if (detailEl) {
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
      detailEl.textContent = txt;
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
