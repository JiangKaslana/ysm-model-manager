// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { t } from "../../../core/i18n/t.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts";
import { buildVrmBoneTree } from "./vrm-bone.ts";
import { vrmSemanticBoneMap } from "../semantic-bones.ts";
import { createBreathController } from "../perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import { createGazeController } from "../perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { createBlinkController } from "../perception/blink.ts"; // 语义表情消费方：程序化生命力 L1.5
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { BoneTree } from "../bone-tools.ts";
import type { PreviewMenuItemDef } from "./preview-menu-defs.ts";

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 把 THREE.Texture / HTMLImageElement 转 dataURL（meta 卡缩略图） */
function imageToDataURL(img: unknown): string {
  try {
    // VRM0 meta.texture 是 THREE.Texture（取 .image）；VRM1 meta.thumbnailImage 直接是 HTMLImageElement
    const holder = img as { image?: unknown } | null;
    const raw = holder && typeof holder.image !== "undefined" ? holder.image : img;
    const source = raw as HTMLImageElement | HTMLCanvasElement | ImageBitmap | null;
    if (!source) return "";
    const w =
      source instanceof HTMLImageElement
        ? source.naturalWidth
        : (source as HTMLCanvasElement | ImageBitmap).width;
    const h =
      source instanceof HTMLImageElement
        ? source.naturalHeight
        : (source as HTMLCanvasElement | ImageBitmap).height;
    if (!w || !h) return "";
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return "";
    g.drawImage(source as CanvasImageSource, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** VRM meta 归一化信息（meta 卡展示用） */
export interface VrmMetaInfo {
  name: string;
  authors: string[];
  version?: string;
  license?: string;
  contact?: string;
  thumbnail?: string; // dataURL，空串表示无缩略图
  metaVersion: "0" | "1";
}

/** 解析 VRM meta（不渲染 3D，parse 后立即 deepDispose），失败返回 null */
export async function readVrmMeta(
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<VrmMetaInfo | null> {
  try {
    const b64 = await readFn(path);
    if (!b64) return null;

    const bytes = b64ToBytes(b64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) return null;
    const meta = vrm.meta;
    let info: VrmMetaInfo;
    if (meta.metaVersion === "0") {
      info = {
        metaVersion: "0",
        name: meta.title || "",
        authors: meta.author ? [meta.author] : [],
        version: meta.version,
        license: meta.licenseName ? meta.licenseName + (meta.otherLicenseUrl ? " · " + meta.otherLicenseUrl : "") : undefined,
        contact: meta.contactInformation,
        thumbnail: meta.texture ? imageToDataURL(meta.texture) : "",
      };
    } else {
      info = {
        metaVersion: "1",
        name: meta.name || "",
        authors: meta.authors || [],
        version: meta.version,
        license: meta.licenseUrl,
        contact: meta.contactInformation,
        thumbnail: meta.thumbnailImage ? imageToDataURL(meta.thumbnailImage) : "",
      };
    }
    VRMUtils.deepDispose(vrm.scene); // 仅取 meta，释放 parse 出的 GPU 资源
    return info;
  } catch {
    return null;
  }
}

/** VRM 内容构建：把模型挂入核心 scene，返回每帧 update + dispose */
export async function buildVrmScene(
  ctx: PreviewBuildCtx,
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🥽</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:preview-prog 1.5s ease-in-out infinite"></div></div>';

  const b64 = await readFn(path);
  if (!b64) throw new Error("ReadFileBytes 返回空");

  const bytes = b64ToBytes(b64);
  // GLTFLoader.parse 要求 ArrayBuffer
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  const loader = new GLTFLoader();
  // v3 架构：往官方 GLTFLoader 注册 VRM 插件（不接管资源管线）
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (!vrm) throw new Error("VRM 实例解析失败（非标准 .vrm？）");

  // VRM0.0 模型背对镜头，转正；VRM1.0 为 no-op 但调用安全
  VRMUtils.rotateVRM0(vrm);
  ctx.scene!.add(vrm.scene);
  ctx.loadingEl.remove(); // 加载完成，移除占位（旧 vrm-3d.ts:172 同款）

  // 包围盒定相机（VRM 原点在脚底、Y-up、面朝 +Z）
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  ctx.camera!.near = 0.05;
  ctx.camera!.far = maxDim * 50;
  ctx.camera!.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);
  ctx.camera!.updateProjectionMatrix();

  ctx.controls!.target.copy(center);
  ctx.controls!.minDistance = maxDim * 0.1;
  ctx.controls!.maxDistance = maxDim * 12;
  ctx.controls!.update();


  // ADR-074 S2 骨骼面板接入：经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单专属项（ADR-076 v2 Phase 2）。
  // 旧版经 extraControls 加「🦴 骨骼」按钮 → querySelector("#preview-panel") 恒 null（core 仅在适配器
  // 返回 extraPanel 时才建 #preview-panel），按钮实为死按钮——改走声明式根菜单契约（对齐 ysm-adapter）。
  // 菜单表提取为可导出 vrmMenuItems()：测试遍历同一份真实数组断言结构（对齐 MikuMikuAR）。
  const bonePanelRef: { current: (() => void) | null } = { current: null };
  const boneTree = buildVrmBoneTree(vrm);
  ctx.menu.setAdapterItems(
    vrmMenuItems({
      bonePanel: {
        tree: boneTree,
        viewContainer: ctx.viewContainer,
        camera: ctx.camera,
        scene: ctx.scene,
        cleanupRef: bonePanelRef,
      },
    }),
  );

  // VRM humanoid 天然语义化：humanBones 键即语义名，零候选匹配直产映射
  const semanticBones = vrmSemanticBoneMap(vrm.humanoid.humanBones);
  // 感知层呼吸（程序化生命力 L1）：待机态下对 chest/spine/shoulders 施加正弦微位移
  const breath = createBreathController();
  // 感知层注视追踪（程序化生命力 L2）：head/eyes 跟随相机方向
  const gaze = createGazeController();
  // 感知层眨眼（程序化生命力 L1.5）：随机间隔触发 blink 表情
  // 对齐 MMD 接法：先发现可用 blink 表情（"blink" / "blinkLeft" / "blinkRight"），
  // 再用 BlinkController 周期写入；无匹配表情则静默降级
  const exprMgr = vrm.expressionManager;
  const blinkExpressionNames = exprMgr
    ? (["blink", "blinkLeft", "blinkRight"] as const).filter((n) => exprMgr.getExpression(n) !== null)
    : [] as Array<"blink" | "blinkLeft" | "blinkRight">;
  const blink = createBlinkController();

  return {
    // VRM 动态部分（SpringBone/表情/LookAt/MToon UV）靠 vrm.update 驱动
    update: (dt: number): void => {
      vrm.update(dt);
      if (semanticBones) {
        breath.apply(dt, semanticBones);
        gaze.apply(dt, semanticBones, ctx.camera!.position);
      }
      // 眨眼：多表情统一写入（VRM 无 action 系统，始终生效）
      if (exprMgr && blinkExpressionNames.length > 0) {
        blink.apply(dt, (weight: number) => {
          for (const name of blinkExpressionNames) {
            exprMgr.setValue(name, weight);
          }
        });
      }
    },
    // 释放 VRM 几何/材质/纹理（含 MToon），避免 GPU 缓冲泄漏
    dispose: (): void => {
      try {
        bonePanelRef.current?.();
      } catch {
        /* 面板清理不阻断 dispose */
      }
      breath.reset();
      gaze.reset();
      blink.dispose();
      VRMUtils.deepDispose(vrm.scene);
    },
    semanticBones,
  };
}

/** vrmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface VrmMenuItemsOpts {
  bonePanel: {
    /** 已构建骨骼树（buildVrmBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: { current: (() => void) | null };
  };
}

/**
 * VRM 声明式根菜单专属项（ADR-076 v2 Phase 2）：🦴 骨骼。
 * 提取为可导出表：适配器与测试共用同一份真实数组（对齐 MikuMikuAR），加菜单项只改这里。
 */
export function vrmMenuItems(o: VrmMenuItemsOpts): PreviewMenuItemDef[] {
  return [
    {
      id: "bones",
      icon: "🦴",
      labelKey: "preview.bones",
      fallback: "骨骼",
      kind: "panel",
      legacyTestId: "vrm-bones-entry",
      dockGroup: "model", // 底栏 🧍 模型组（骨骼）
      render: (list): void => {
        // 通用骨骼面板（ADR-077）：渲染进根菜单面板；重入时先清理旧 renderer
        if (o.bonePanel.cleanupRef.current) {
          o.bonePanel.cleanupRef.current();
          o.bonePanel.cleanupRef.current = null;
        }
        o.bonePanel.cleanupRef.current = makeBonePanelRenderer(o.bonePanel.tree)(list, {
          viewContainer: o.bonePanel.viewContainer!,
          camera: o.bonePanel.camera!,
          scene: o.bonePanel.scene!,
        });
      },
    },
  ];
}
