// ===== YSM 3D 内容适配器（ADR-066 P3-E：收敛 YSM 自驱渲染器到统一外壳）=====
// 采用 core 的 self 外壳模式：core 提供 overlay / topBar / body / viewContainer /
// loadingEl / closeBtn / ESC / resize / 代际守卫 / cleanup 编排；本适配器经
// renderModel3D 自驱 3D 内部（YS M 渲染器是自带 renderer/scene/controls/rAF 的
// 单例，不能像 vrm/litematic 那样共享 ctx + update(dt)），并借 extraControls /
// extraPanel 把 YSM 专属 UI（多纹理选择 / 截图菜单 / 重置 / 模型组选择 / 旋转速度 /
// 骨骼面板）挂入统一外壳。
//
// 与 vrm/litematic 适配器的区别：它们走 shared 模式（core 建 renderer 并驱循环，
// 适配器只注入场景/灯光/每帧 update）；YS M 因历史单例形态走 self 模式，core 不建
// renderer，仅提供外壳，避免双 renderer 争 viewContainer + 双 rAF 双重渲染 + 双键盘劫持。
import * as THREE from "three";
import { createIconButton, ensureFabStyles } from "../../utils/dom/fab.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { renderModel3D } from "../../utils/3d/model3d.ts";
import type { Spec3D, BoneSelectInfo } from "../../utils/3d/model3d.ts";
import { preloadModel, type ModelLike } from "./model3d-loader.ts";
import { fill3DPanel } from "./skeleton-fill-panel.ts";
import { saveScreenshot, type Model3DHandleX } from "./skeleton-render.ts";
import type { PreviewScene, PreviewBuildCtx, PreviewAdapter } from "./mount-preview-core.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** 适配器可选项：纹理切换重建 / 关闭回调由外层（ysm-3d.ts）负责 */
export interface YsmAdapterOptions {
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
}

/** 模型对象（对齐 fill3DPanel / saveScreenshot 的字段需求） */
type YsmModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  boneCount?: number;
  bones?: unknown[];
};

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
 * 构建 YSM 3D 内容场景并挂载到统一外壳（self 模式）。
 * 成功路径自行移除 core 提供的 loadingEl（对齐 vrm/litematic 既有口径）。
 */
export async function buildYsmScene(
  ctx: PreviewBuildCtx,
  model: YsmModel,
  texIdx: number,
  opts: YsmAdapterOptions,
): Promise<PreviewScene> {
  ensureFabStyles();
  const { texArr, spec } = await preloadModel(model as ModelLike);
  const h = (await renderModel3D(
    ctx.viewContainer,
    texArr,
    spec as Spec3D,
    texIdx,
  )) as Model3DHandleX;

  // 成功路径：移除 core 提供的加载指示器（错误/空数据场景由 core 保留 loadingEl 并提示）
  ctx.loadingEl.remove();

  // 闭包共享：extraControls 创建、extraPanel 消费的 YSM 模型组选择器
  let modelSel: HTMLSelectElement | null = null;

  return {
    dispose(): void {
      // 对齐原 skeleton.ts close3D：清 timeTimer / keyHandler + 内容层 cleanup
      if (h._timeTimer) clearInterval(h._timeTimer);
      if (h._keyHandler) document.removeEventListener("keydown", h._keyHandler);
      h.cleanup();
    },

    extraControls(topBar: HTMLElement): void {
      // ── 多纹理选择器（仅多纹理模型出现）──
      if ((model.textures?.length ?? 0) > 1) {
        const texSel = document.createElement("select");
        texSel.className = "ysm-ovl-select";
        model.textures!.forEach((_, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = `${t("preview.texture")} ${i + 1}`;
          texSel.appendChild(opt);
        });
        texSel.value = String(texIdx);
        texSel.onchange = (): void => {
          const idx = parseInt(texSel.value, 10);
          opts.onTextureChange?.(idx);
        };
        topBar.appendChild(texSel);
      }

      const spacer = document.createElement("div");
      spacer.className = "ysm-ovl-spacer";
      topBar.appendChild(spacer);

      // ── 截图按钮 + 菜单 ──
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
          await saveScreenshot(model, key, shot.setIcon);
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

      // ── 重置视角 ──
      const resetBtn = createIconButton({
        icon: "⟲",
        label: t("preview.resetView"),
        title: "重置相机视角到初始位置",
      });
      resetBtn.onclick = (): void => {
        h.resetCamera();
      };
      topBar.appendChild(resetBtn);

      // ── 模型组选择器（fill3DPanel 内按需显示，默认隐藏）──
      modelSel = document.createElement("select");
      modelSel.className = "ysm-ovl-select";
      modelSel.style.display = "none";
      modelSel.onchange = (): void => {
        h.showModelGroup(parseInt(modelSel!.value, 10));
      };
      topBar.appendChild(modelSel);

      // ── 旋转模式 ──
      const rotLabel = document.createElement("span");
      rotLabel.className = "ysm-ovl-label";
      rotLabel.textContent = t("preview.cameraRotation") + ":";
      topBar.appendChild(rotLabel);
      const rotSel = document.createElement("select");
      rotSel.className = "ysm-ovl-select";
      rotSel.style.marginRight = "8px";
      [
        { v: true, t: "环绕" },
        { v: false, t: "自身" },
      ].forEach((m) => {
        const opt = document.createElement("option");
        opt.value = String(m.v);
        opt.textContent = m.t;
        rotSel.appendChild(opt);
      });
      rotSel.value = safeGet("td-rot-mode") === "free" ? "false" : "true";
      rotSel.onchange = (): void => {
        h.setRotationMode(rotSel.value === "true");
        safeSet("td-rot-mode", rotSel.value === "true" ? "orbit" : "free");
      };
      topBar.appendChild(rotSel);

      // ── 速度控制 ──
      const spdLabel = document.createElement("span");
      spdLabel.className = "ysm-ovl-label";
      spdLabel.textContent = t("preview.cameraSpeed") + ":";
      topBar.appendChild(spdLabel);
      const spdSlider = document.createElement("input");
      spdSlider.type = "range";
      spdSlider.min = "2";
      spdSlider.max = "200";
      spdSlider.value = safeGet("td-cam-speed") || "20";
      spdSlider.className = "ysm-ovl-slider";
      topBar.appendChild(spdSlider);
      const spdVal = document.createElement("span");
      spdVal.className = "ysm-ovl-val";
      spdVal.textContent = safeGet("td-cam-speed") || "20";
      spdSlider.oninput = (): void => {
        spdVal.textContent = spdSlider.value;
        h.setSpeed(Number(spdSlider.value));
        safeSet("td-cam-speed", spdSlider.value);
      };
      topBar.appendChild(spdVal);
    },

    extraPanel(panel: HTMLElement): void {
      if (!modelSel) return;
      fill3DPanel(
        panel as HTMLDivElement,
        model,
        texArr as THREE.Texture[],
        spec as Spec3D,
        h,
        modelSel,
      );
      // 骨骼拾取：写详情框 + 面板内滚动高亮（对齐原 skeleton.ts onBoneSelect）
      h.onBoneSelect = (info: BoneSelectInfo): void => {
        const detailEl = h._boneDetailEl;
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
    },
  };
}

/** 工厂：构造统一 PreviewAdapter（self 模式） */
export function makeYsmAdapter(
  model: YsmModel,
  texIdx: number,
  opts: YsmAdapterOptions = {},
): PreviewAdapter {
  return {
    id: "ysm",
    mode: "self",
    onClose: opts.onClose,
    build(ctx: PreviewBuildCtx): Promise<PreviewScene> {
      return buildYsmScene(ctx, model, texIdx, opts);
    },
  };
}
