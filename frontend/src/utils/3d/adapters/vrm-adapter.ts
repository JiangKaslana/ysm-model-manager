// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, type VRMAnimation } from "@pixiv/three-vrm-animation";
import type { VRM0Meta } from "@pixiv/three-vrm-core";
import { t } from "../../../core/i18n/t.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts";
import { buildVrmBoneTree } from "./vrm-bone.ts";
import { vrmSemanticBoneMap } from "../semantic-bones.ts";
import { createBreathController } from "../perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import { createGazeController } from "../perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { createBlinkController } from "../perception/blink.ts"; // 语义表情消费方：程序化生命力 L1.5
import { createFootIKController } from "../mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK，格式无关）
import { screenshotFromRenderer } from "../screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { BoneTree } from "../bone-tools.ts";
import type { PreviewMenuItemDef } from "./preview-menu-defs.ts";
import {
  listVrmMaterials,
  getVrmMaterialDetail,
  setVrmMaterialVisible,
  setVrmMaterialOpacity,
} from "../vrm-materials.ts";
import type { VrmMaterialControlBridge } from "../../../views/app-preview/vrm-controls.ts";
import type { MmdPlayBridge } from "../../../views/app-preview/mmd-controls.ts";

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
  /** VRM0 授权约束徽章（Vrm0Restrictions），VRM1 无此字段 */
  restrictions?: {
    allowedUser: "everyone" | "licensed" | "onlyAuthor";
    commercial: boolean;
    sexual: boolean;
    violent: boolean;
    reference?: string;
  };
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
      const m = meta as VRM0Meta;
      info = {
        metaVersion: "0",
        name: meta.title || "",
        authors: meta.author ? [meta.author] : [],
        version: meta.version,
        license: meta.licenseName ? meta.licenseName + (meta.otherLicenseUrl ? " · " + meta.otherLicenseUrl : "") : undefined,
        contact: meta.contactInformation,
        thumbnail: meta.texture ? imageToDataURL(meta.texture) : "",
        restrictions: {
          allowedUser: m.allowedUserName === "Everyone" ? "everyone"
            : m.allowedUserName === "ExplicitlyLicensedPerson" ? "licensed"
            : "onlyAuthor",
          commercial: m.commercialUssageName === "Allow",
          sexual: m.sexualUssageName === "Allow",
          violent: m.violentUssageName === "Allow",
          reference: m.reference || undefined,
        },
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
/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface VrmPanelHooks {
  makePanelRenderer: (bridge: VrmMaterialControlBridge) => (list: HTMLElement) => void;
  /** 模型信息面板填充回调（ADR-052 P3）；缺失则 model 项 render 退化为 no-op */
  makeModelPanelRenderer?: (list: HTMLElement) => void;
  /** 截图面板填充回调（ADR-052 P3：喂 screenshotFn 给 saveScreenshot）；缺失则 shot 项 render 退化为 no-op */
  makeShotPanelRenderer?: (screenshotFn: () => Promise<string | null>) => (list: HTMLElement) => void;
  /** 播放面板填充回调（复用 MMD 播放面板；解除 utils→views 分层违规 R1，缺失则 play 项 render 退化为 no-op） */
  fillPlayPanel?: (list: HTMLElement, bridge: MmdPlayBridge) => void;
}

export async function buildVrmScene(
  ctx: PreviewBuildCtx,
  path: string,
  readFn: (p: string) => Promise<string | null>,
  panels?: VrmPanelHooks,
  listAllFilePaths?: (dir: string) => Promise<string[] | null>,
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
  // VRMA 动作：同款 loader 注册动画插件（解析 .vrma → gltf.userData.vrmAnimations）
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (!vrm) throw new Error("VRM 实例解析失败（非标准 .vrm？）");

  // VRM0.0 模型背对镜头，转正；VRM1.0 为 no-op 但调用安全
  VRMUtils.rotateVRM0(vrm);
  ctx.scene!.add(vrm.scene);
  registerModelRoot(vrm.scene);
  ctx.loadingEl.remove(); // 加载完成，移除占位（旧 vrm-3d.ts:172 同款）

  // ---- VRMA 动作（同目录 .vrma）：官方 @pixiv/three-vrm-animation（与 three-vrm 同源）----
  // 复用已注册 VRMAnimationLoaderPlugin 的同一 loader 解析 .vrma → gltf.userData.vrmAnimations；
  // 单个损坏 / 目录不可列 / 无 .vrma → 无动作降级，均不阻断模型渲染（对齐 MMD 同目录 VMD 口径）。
  const motionClips: Array<{ label: string; clip: THREE.AnimationClip }> = [];
  let motionMixer: THREE.AnimationMixer | null = null;
  let motionAction: THREE.AnimationAction | null = null;
  let motionPlaying = true;
  let motionIdx = 0;
  if (listAllFilePaths) {
    try {
      const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
      const files = (await listAllFilePaths(dirPath)) || [];
      const vrmaPaths = files.filter((p) => p.toLowerCase().endsWith(".vrma"));
      for (const vp of vrmaPaths) {
        try {
          const b64 = await readFn(vp);
          if (!b64) continue;
          const bytes = b64ToBytes(b64);
          const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const animGltf = await new Promise<GLTF>((resolve, reject) => loader.parse(buf, "", resolve, reject));
          const anims = (animGltf.userData as { vrmAnimations?: VRMAnimation[] }).vrmAnimations;
          if (!anims || anims.length === 0) continue;
          motionClips.push({
            label: (vp.split(/[/\\]/).pop() || "motion").replace(/\.vrma$/i, "") || "motion",
            clip: createVRMAnimationClip(anims[0], vrm),
          });
        } catch {
          /* 单个 .vrma 解析失败 → 跳过其余照常 */
        }
      }
      if (motionClips.length > 0) {
        motionMixer = new THREE.AnimationMixer(vrm.scene);
        motionAction = motionMixer.clipAction(motionClips[0].clip);
        motionAction.play(); // AnimationAction 默认 LoopRepeat 循环
      }
    } catch {
      /* 目录不可列 → 白模降级，不阻断模型渲染 */
    }
  }

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
  // Phase 3 收编后 extraPanel 机制已移除，所有适配器面板统一走声明式根菜单。
  // 菜单表提取为可导出 vrmMenuItems()：测试遍历同一份真实数组断言结构（对齐 MikuMikuAR）。
  const bonePanelRef: { current: (() => void) | null } = { current: null };
  const boneTree = buildVrmBoneTree(vrm);

  // VRM 材质收集：vrm.scene.traverse 取所有 Mesh.material（含数组材质）
  const vrmMaterials: THREE.Material[] = [];
  vrm.scene.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    vrmMaterials.push(...mats);
  });

  ctx.menu.setAdapterItems(
    vrmMenuItems({
      panels,
      screenshot: () => Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
      modelPanel: panels?.makeModelPanelRenderer,
      bonePanel: {
        tree: boneTree,
        viewContainer: ctx.viewContainer,
        camera: ctx.camera,
        scene: ctx.scene,
        cleanupRef: bonePanelRef,
      },
      material: {
        list: () => listVrmMaterials(vrmMaterials),
        getDetail: (i: number) => getVrmMaterialDetail(vrmMaterials, i),
        setVisible: (i: number, v: boolean) => setVrmMaterialVisible(vrmMaterials, i, v),
        setOpacity: (i: number, o: number) => {
          setVrmMaterialOpacity(vrmMaterials, i, o);
        },
      },
      play: motionClips.length > 0
        ? {
            clips: motionClips.map((c) => ({ label: c.label })),
            isPlaying: () => motionPlaying,
            toggle: () => {
              motionPlaying = !motionPlaying;
              if (motionAction) motionAction.paused = !motionPlaying;
            },
            currentIndex: () => motionIdx,
            select: (i: number) => {
              if (i === motionIdx || !motionMixer) return;
              if (i < 0 || i >= motionClips.length) return;
              motionIdx = i;
              motionAction?.stop();
              motionAction = motionMixer.clipAction(motionClips[i].clip);
              // 先 play() 再按当前播放态设 paused：暂停态切片也能靠后续 toggle 恢复，
              // 避免「新 action 从未 play() → 永久冻结且 animActive 误判关掉呼吸/眨眼」
              motionAction.play();
              motionAction.paused = !motionPlaying;
            },
          }
        : null,
    }),
  );

  // VRM humanoid 天然语义化：humanBones 键即语义名，零候选匹配直产映射
  const semanticBones = vrmSemanticBoneMap(vrm.humanoid.humanBones);
  // 感知层呼吸（程序化生命力 L1）：待机态下对 chest/spine/shoulders 施加正弦微位移
  const breath = createBreathController();
  // 感知层注视追踪（程序化生命力 L2）：优先用 VRM 原生 lookAt（内部处理 head 旋转限幅），
  // fallback 到语义骨骼驱动（仅当 vrm.lookAt 缺失，极少见）
  const useNativeLookAt = !!vrm.lookAt;
  let gaze: ReturnType<typeof createGazeController> | null = useNativeLookAt ? null : createGazeController();
  // 启用原生 lookAt：指向相机作为注视目标（autoUpdate 默认 true，vrm.update 自动消费）
  if (useNativeLookAt) vrm.lookAt!.target = ctx.camera;
  // 感知层眨眼（程序化生命力 L1.5）：随机间隔触发 blink 表情
  // 对齐 MMD 接法：先发现可用 blink 表情（"blink" / "blinkLeft" / "blinkRight"），
  // 再用 BlinkController 周期写入；无匹配表情则静默降级
  const exprMgr = vrm.expressionManager;
  const blinkExpressionNames = exprMgr
    ? (["blink", "blinkLeft", "blinkRight"] as const).filter((n) => exprMgr.getExpression(n) !== null)
    : [] as Array<"blink" | "blinkLeft" | "blinkRight">;
  const blink = createBlinkController();
  // 程序化足部锚地（Foot IK）：待机态下保持双足贴地，防悬空/穿模（格式无关，与 MMD 共用）
  const footIK = createFootIKController(boneTree, semanticBones);

  return {
    // VRM 动态部分（VRMA 动画 + SpringBone/表情/LookAt/MToon UV）靠 vrm.update 驱动
    update: (dt: number): void => {
      if (!vrm.scene.visible) return; // Frustum Culling 不可见 → 跳过 springBone/感知层，省 CPU
      if (motionMixer) motionMixer.update(dt);
      // vrm.update 内部序：humanoid（含 VRMA 写入的归一化骨骼）→ lookAt → expression →
      // nodeConstraint → springBone；故 VRMA 播放只需 mixer.update + vrm.update，无需手动 humanoid.update。
      vrm.update(dt);
      // 动画播放时暂停程序化生命力（避免与 VRMA 姿态/表情打架，对齐 MMD 口径）
      const animActive = !!motionAction && !motionAction.paused;
      if (semanticBones) {
        if (!animActive) breath.apply(dt, semanticBones);
        // 注视追踪：原生 lookAt 优先（VRM 内部处理 head 旋转限幅），fallback 才走语义骨骼
        if (!animActive && !useNativeLookAt) gaze!.apply(dt, semanticBones, ctx.camera!.position);
      }
      // Foot IK：待机态下锚定双足（在眨眼之前，先稳定姿态再驱动表情）
      footIK.apply(dt, !animActive);
      // 眨眼：多表情统一写入（动画播放时暂停，避免覆盖 VRMA 表情轨）
      if (exprMgr && blinkExpressionNames.length > 0 && !animActive) {
        const mgr = exprMgr;
        blink.apply(dt, (weight: number) => {
          for (const name of blinkExpressionNames) {
            mgr.setValue(name, weight);
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
      unregisterModelRoot(vrm.scene);
      breath.reset();
      gaze?.reset();
      blink.dispose();
      footIK.dispose();
      motionMixer?.stopAllAction(); // 停掉 VRMA 动画 mixer，避免释放后残留 action
      motionMixer?.uncacheRoot(vrm.scene); // 释放 PropertyBinding 缓存，防 GPU/内存残留（switchTo 重建时尤甚）
      // 原生 lookAt：断开相机引用，避免释放后残留
      if (useNativeLookAt) vrm.lookAt!.target = null;
      VRMUtils.deepDispose(vrm.scene);
    },
    // ADR-052 P3：截图走共享 renderer（通用化，与 ysm/mmd/litematic 呑约对称）
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    semanticBones,
  };
}

/** vrmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface VrmMenuItemsOpts {
  /** 截图能力（ADR-052 P3：screenshotFromRenderer 共享 renderer）；null → 不注入 shot 项 */
  screenshot: (() => Promise<string | null>) | null;
  /** 模型信息面板填充回调（视图层注入；缺失则 render 退化为 no-op） */
  modelPanel?: (list: HTMLElement) => void;
  bonePanel: {
    /** 已构建骨骼树（buildVrmBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: { current: (() => void) | null };
  };
  /** VRM 材质桥：vrm.scene 遍历的 Mesh.material 列表（与 MMD MaterialControlBridge 对齐）*/
  material: {
    list: () => ReturnType<typeof listVrmMaterials>;
    getDetail: (i: number) => ReturnType<typeof getVrmMaterialDetail>;
    setVisible: (i: number, v: boolean) => void;
    setOpacity: (i: number, o: number) => void;
  };
  /** VRM 动作桥（@pixiv/three-vrm-animation 播放）；null/缺省（无同目录 .vrma）→ 不注入 play 项 */
  play?: MmdPlayBridge | null;
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: VrmPanelHooks;
}

/**
 * VRM 声明式根菜单专属项（ADR-076 v2 Phase 2）：🦴 骨骼 + 🎨 材质。
 * 提取为可导出表：适配器与测试共用同一份真实数组（对齐 MikuMikuAR），加菜单项只改这里。
 */
export function vrmMenuItems(o: VrmMenuItemsOpts): PreviewMenuItemDef[] {
  const items: PreviewMenuItemDef[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "vrm-model-entry",
      render: (list): void => {
        o.modelPanel?.(list);
      },
    },
    {
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "vrm-shot-entry",
      render: (list): void => {
        // ADR-052 P3：截图面板填充委托视图层（panels.makeShotPanelRenderer），缺失则 no-op
        if (o.screenshot) o.panels?.makeShotPanelRenderer?.(o.screenshot)(list);
      },
    },
    {
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      legacyTestId: "vrm-material-entry",
      dockGroup: "model",
      render: (list): void => {
        o.panels?.makePanelRenderer?.(o.material)(list);
      },
    },
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
  if (o.play) {
    items.push({
      id: "vrma-play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      legacyTestId: "vrm-play-entry",
      dockGroup: "motion", // 底栏 💃 动作组（对齐 MMD）
      render: (list): void => {
        o.panels?.fillPlayPanel?.(list, o.play!);
      },
    });
  }
  return items;
}
