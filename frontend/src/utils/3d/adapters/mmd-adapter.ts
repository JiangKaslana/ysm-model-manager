// ===== MMD 内容适配器（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 本文件只负责 MMD 专属逻辑：经 Go 绑定 ReadFileBytes 取 PMX/PMD 字节 →
// MMDLoader（@moeru/three-mmd，parser 自带，无 babylon 依赖）解析 →
// LoadingManager.setURLModifier 把模型同目录纹理映射为 blob URL（Wails 环境
// 浏览器读不了本地磁盘路径）→ 挂入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { MMDLoader, VmdObject, buildAnimation, VPDLoader, applyVPD, type VpdObject } from "@moeru/three-mmd";
import { t } from "../../../core/i18n/t.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { PreviewMenuItemDef } from "./preview-menu-defs.ts";
import type {
  MmdBottomNavCtx,
  MmdPlayBridge,
  MaterialControlBridge,
} from "../../../views/app-preview/mmd-controls.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
} from "../mmd-materials.ts";
import { mmdBonesToBoneNodes } from "../mmd-bones.ts"; // ADR-077: pmx.bones 索引结构 → BoneNode[]
import { buildBoneTree, type BoneTree } from "../bone-tools.ts";
import { mmdSemanticBoneMap } from "../semantic-bones.ts";
import { mmdSemanticMorphMap } from "../semantic-morphs.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts"; // ADR-074 S2: 通用骨骼面板
import { createBreathController } from "../perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import { createGazeController } from "../perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { createBlinkController } from "../perception/blink.ts"; // 语义 morph 消费方：程序化生命力 L1.5
import { createLipSyncController } from "../perception/lipsync.ts"; // 语义 morph 消费方：程序化生命力 L2
import { createAutoDanceController } from "../perception/autodance.ts"; // 语义骨骼消费方：程序化生命力 L3
import { buildLipMorphIndices } from "../perception/lipsync.ts"; // 多 morph index 提取
import { createFootIKController } from "../mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK）
import { screenshotFromRenderer } from "../screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
// import { createBlinkController } from "../perception/blink.ts"; // 待 three-mmd 暴露 morph 权重 API 后接入

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView<ArrayBuffer>，规避 SharedArrayBuffer 泛型） */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** MMD 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface MmdDataPort {
  readFileBytes(path: string): Promise<string | null>;
  listAllFilePaths(dir: string): Promise<string[] | null>;
  addOpLog(op: string, msg: string, status: "ok" | "fail", err?: string): Promise<void>;
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function mmdDiag(
  port: MmdDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

/** 同目录纹理候选扩展名（PMX/PMD 引用的贴图；.spa/.sph 特殊格式 Image 解不了，命中后降级无贴图） */
const TEXTURE_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".tga", ".gif", ".webp"];

/** 假 TGA 检测：合法 TGA 头部第 3 字节（图像类型）∈ {1,2,3,9,10,11}；MMD 素材常有扩展名 .tga 但内容非法的占位文件，跳过避免 TGALoader 刷错 */
function isLikelyTga(bytes: Uint8Array): boolean {
  if (bytes.length < 18) return false;
  const type = bytes[2];
  return type === 1 || type === 2 || type === 3 || type === 9 || type === 10 || type === 11;
}

/**
 * MMD 内容构建：读 PMX/PMD 字节 + 同目录纹理 → 挂入核心 scene，返回每帧 update + dispose。
 * 成功路径自行移除 loadingEl（对齐 vrm/litematic 既有口径）。数据读取经 port 注入（ADR-072）。
 */
/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface MmdPanelHooks {
  fillModelPanel: (list: HTMLElement, ctx: MmdBottomNavCtx) => void;
  fillPlayPanel: (list: HTMLElement, bridge: MmdPlayBridge) => void;
  fillShotPanel: (list: HTMLElement, ctx: MmdBottomNavCtx, screenshot: (() => Promise<string | null>) | null) => void;
  buildMaterialControls: (container: HTMLElement, bridge: MaterialControlBridge) => void;
}

export async function buildMmdScene(
  ctx: PreviewBuildCtx,
  path: string,
  port: MmdDataPort,
  panels?: MmdPanelHooks,
): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🎭</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:preview-prog 1.5s ease-in-out infinite"></div></div>';

  const b64 = await port.readFileBytes(path);
  await mmdDiag(port, "read-model", path, b64 ? "ok" : "fail", b64 ? `bytes=${b64.length}` : "ReadFileBytes 返回空（路径语义/守卫？）");
  if (!b64) throw new Error("ReadFileBytes 返回空");
  const bytes = b64ToBytes(b64);
  const modelBase = (path.split(/[/\\]/).pop() || "").toLowerCase();

  // ---- 同目录文件清单：ListAllFilePaths 递归列全部文件（不能用 ScanModelEntries——
  // 它只返回主文件条目，纹理/VMD 拿不到，URLModifier 全放行导致纹理 502）----
  const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  const texMap = new Map<string, string>();
  const blobUrls: string[] = [];
  const vmdPaths: string[] = [];
  const vpdPaths: string[] = []; // 同目录 VPD 姿势文件
  // 模型本体也注册 blob：MMDLoader 内部 FileLoader 从 URL 读字节（WebView2 读不了磁盘路径），
  // URLModifier 拦截模型 URL → blob 后才可加载。
  const modelBlobUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(bytes)]));
  blobUrls.push(modelBlobUrl);
  texMap.set(modelBase, modelBlobUrl);
  try {
    const files = (await port.listAllFilePaths(dirPath)) || [];
    // 并行预读纹理（避免 N 次串行 RPC 拖慢预览打开；单张失败降级不影响整体）
    await Promise.all(
      files
        .filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext)))
        .map(async (p) => {
          const texB64 = await port.readFileBytes(p);
          if (!texB64) return;
          const texBytes = b64ToBytes(texB64);
          // 假 TGA（扩展名 .tga 但头部类型非法）：不注册 blob → TGALoader 不会加载它 → 无刷屏错误
          if (p.toLowerCase().endsWith(".tga") && !isLikelyTga(texBytes)) return;
          const blob = new Blob([bytesToArrayBuffer(texBytes)]);
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          const lower = p.toLowerCase().replace(/\\/g, "/");
          // 键1：相对目录路径（PMX 内记录如 "textures/face.png"，对齐 URLModifier 收到的 fullPath；
          // 统一正斜杠——Go 在 Windows 返回反斜杠路径）
          const dirNorm = dirPath.toLowerCase().replace(/\\/g, "/");
          const rel = lower.startsWith(dirNorm + "/")
            ? lower.slice(dirNorm.length + 1)
            : lower;
          texMap.set(rel, url);
          // 键2：basename 兜底（同名不同子目录由最长后缀匹配区分）
          texMap.set(lower.split("/").pop() || "", url);
        }),
    );
    // 同目录 VMD 动作文件（模型加载后逐个解析）
    vmdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vmd")));
    // 同目录 VPD 姿势文件（模型加载后逐个应用）
    vpdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vpd")));
    await mmdDiag(
      port,
      "list-files",
      dirPath,
      "ok",
      `files=${files.length} tex=${files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext))).length} vmd=${vmdPaths.length}`,
    );
  } catch (e) {
    await mmdDiag(port, "list-files", dirPath, "fail", e instanceof Error ? e.message : String(e));
    /* 目录不可列 → 白模降级，不阻断模型渲染 */
  }

  // ---- URLModifier：模型自身 + 纹理 URL → blob URL（未命中原样返回，toon 内置 dataURL 天然放行）----
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url: string): string => {
    const lower = url.toLowerCase().replace(/\\/g, "/");
    // 最长路径后缀匹配（保留目录上下文：同名纹理在不同子目录时各归其位，basename 冲突兜底）
    let best: string | undefined;
    let bestLen = -1;
    for (const [key, blobUrl] of texMap) {
      if (key.length > bestLen && lower.endsWith(key)) {
        best = blobUrl;
        bestLen = key.length;
      }
    }
    return best ?? url;
  });

  const loader = new MMDLoader(manager);
  let mmd;
  try {
    mmd = await loader.loadAsync(path);
  } catch (e) {
    // 加载失败：回收已建 blob（模型 + 已读纹理），避免 WebView2 会话期内泄漏内存
    for (const url of blobUrls) URL.revokeObjectURL(url);
    await mmdDiag(port, "parse", path, "fail", e instanceof Error ? e.message : String(e));
    throw e;
  }
  await mmdDiag(
    port,
    "parse",
    path,
    "ok",
    `bones=${mmd.pmx?.bones?.length ?? 0} mats=${mmd.pmx?.materials?.length ?? 0} morphs=${mmd.pmx?.morphs?.length ?? 0}`,
  );
  const mesh = mmd.mesh;

  ctx.scene!.add(mesh);
  ctx.loadingEl.remove(); // 加载完成，移除占位（对齐 vrm-adapter 口径）

  // ---- VMD 动作（同目录 .vmd）：VmdObject.ParseFromBuffer 直解字节，坏文件跳过不阻断 ----
  const mixer = new THREE.AnimationMixer(mesh);
  const clips: Array<{ label: string; clip: THREE.AnimationClip }> = [];
  for (const v of vmdPaths) {
    try {
      const vmdB64 = await port.readFileBytes(v);
      if (!vmdB64) continue;
      // await 包装：真实库 ParseFromBuffer 同步返回（await 无害），但损坏/异步实现时
      // reject 能被 try/catch 捕获，不会把 Promise 对象当 vmd 传给 buildAnimation
      const vmd = await VmdObject.ParseFromBuffer(bytesToArrayBuffer(b64ToBytes(vmdB64)));
      clips.push({
        label: (v.split(/[/\\]/).pop() || "").replace(/\.vmd$/i, "") || "motion",
        clip: buildAnimation(vmd, mesh),
      });
    } catch {
      /* 单个 VMD 损坏 → 跳过，其余照常 */
    }
  }
  // 同目录 VPD 姿势文件：加载并缓存（applyVPD 直接修改骨骼变换，非动画 clip）
  const vpdPoses: Array<{ label: string; vpd: VpdObject }> = [];
  for (const v of vpdPaths) {
    try {
      const vpdB64 = await port.readFileBytes(v);
      if (!vpdB64) continue;
      const vpdBytes = b64ToBytes(vpdB64);
      // VPDLoader.loadAsync 需要 URL，构造 blob URL（ArrayBuffer 兼容 BlobPart）
      const vpdBlobUrl = URL.createObjectURL(new Blob([vpdBytes.buffer as ArrayBuffer]));
      blobUrls.push(vpdBlobUrl);
      const vpd = await new VPDLoader().loadAsync(vpdBlobUrl);
      vpdPoses.push({
        label: (v.split(/[/\\]/).pop() || "").replace(/\.vpd$/i, "") || "pose",
        vpd,
      });
    } catch {
      /* 单个 VPD 损坏 → 跳过，其余照常 */
    }
  }
  let playing = true;
  let curIdx = 0;
  let action: THREE.AnimationAction | null = null;
  if (clips.length > 0) {
    action = mixer.clipAction(clips[0].clip); // 默认 LoopRepeat 循环
    action.play();
  }

  // 包围盒定相机（MMD Y-up、单位约厘米，原点一般在脚底；尺寸差由相机距离吸收，不缩放模型）
  const box = new THREE.Box3().setFromObject(mesh);
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

  // MMDToon 材质对光有响应，补环境 + 主光 + 半球光（对齐 vrm-adapter 灯位）

  // ---- 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放 ----
  // 切换模型归 core switch 项（needsSiblings），相机归 core camera 项（sharedOnly）。
  // 菜单表提取为可导出 mmdMenuItems()：测试遍历同一份真实数组断言结构（对齐 MikuMikuAR）。
  const navCtx: MmdBottomNavCtx = {
    mmd,
    mesh,
    modelName: path.split(/[/\\]/).pop() || "",
    modelPath: path,
    cameraControls: ctx.cameraControls,
    switchTo: ctx.switchTo,
  };
  const mats = mesh.material as unknown as THREE.Material[];
  const bonePanelRef: { current: (() => void) | null } = { current: null };
  // ADR-077 + 语义骨骼层：骨骼树构建复用一次，既喂骨骼面板也产语义映射
  const boneTree = mmd.pmx?.bones && mesh.skeleton
    ? buildBoneTree(mmdBonesToBoneNodes(mmd.pmx.bones, mesh.skeleton.bones))
    : null;
  const items = mmdMenuItems({
    navCtx,
    panels,
    screenshot: () => Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    material: {
      list: () => listMmdMaterials(mmd.pmx.materials),
      getDetail: (i) => getMmdMaterialDetail(mmd.pmx.materials, mats, i),
      setVisible: (i, v) => setMmdMaterialVisible(mats, i, v),
      setOpacity: (i, o) => {
        setMmdMaterialOpacity(mats, i, o);
        const m = mats[i];
        if (m) m.needsUpdate = true; // 透明状态变更需重编译着色器
      },
    },
    play:
      clips.length > 0
        ? {
            clips,
            isPlaying: () => playing,
            toggle: () => {
              playing = !playing;
              // AnimationAction 的暂停是 paused 属性（无 pause() 方法），play() 兼容重置
              if (action) action.paused = !playing;
            },
            currentIndex: () => curIdx,
            select: (i) => {
              if (i === curIdx) return;
              curIdx = i;
              action?.stop();
              action = mixer.clipAction(clips[i].clip);
              if (playing) action.play();
            },
          }
        : null,
    // ADR-077: 骨骼面板（MMD 特有：THREE.Bone 无几何，拾取走距离法）——收编为根菜单 bones 项
    bonePanel: boneTree
      ? {
          tree: boneTree,
          viewContainer: ctx.viewContainer,
          camera: ctx.camera,
          scene: ctx.scene,
          cleanupRef: bonePanelRef,
        }
      : null,
  });
  ctx.menu.setAdapterItems(items);

  // MMD 语义骨骼：候选名匹配表移植自 MikuMikuAR motion-algos；消费方读取驱动感知层
  const semanticBones = boneTree ? mmdSemanticBoneMap(boneTree) : undefined;
  // MMD 语义 morph：候选名匹配（blink/lipOpen 等）→ morphTargetDictionary index
  const semanticMorphs = mmdSemanticMorphMap(mmd.pmx?.morphs ?? []);
  // 感知层呼吸（程序化生命力 L1）：待机态下对 chest/spine/shoulders 施加正弦微位移
  const breath = createBreathController();
  // 感知层注视追踪（程序化生命力 L2）：head/eyes 跟随相机方向
  const gaze = createGazeController();
  // 感知层眨眼（程序化生命力 L1.5）：随机间隔触发 morph
  const blink = createBlinkController();
  // 感知层 LipSync（程序化生命力 L2）：待机态下多 morph 驱动口型
  const lipSync = createLipSyncController({ multiMorph: true });
  let lipSyncTime = 0;
  // 构建口型 morph index 映射（从语义 morph map + mesh.morphTargetDictionary）
  const lipIndices = (mesh.morphTargetDictionary && semanticMorphs
    ? buildLipMorphIndices(semanticMorphs, mesh.morphTargetDictionary)
    : undefined);
  // 感知层 AutoDance（程序化生命力 L3）：按 BPM 节拍驱动骨骼律动（待机态生效）
  const autoDance = createAutoDanceController({ bpm: 120, intensity: 0.3 });
  // 程序化足部锚地（Foot IK）：待机态下保持双足贴地，防悬空/穿模
  const footIK = createFootIKController(boneTree, semanticBones);

  return {
    // MMD 动态部分（VMD 动画 + IK/追加变换姿态解算）靠 updateWithMixer 驱动；静态模型摆正初始姿势
    update: (dt: number): void => {
      mmd.updateWithMixer(dt, mixer, { ik: true, grant: true });
      if (semanticBones) {
        // 待机呼吸：有动画播放时暂停（避免与动画打架）
        if (!action || action.paused) breath.apply(dt, semanticBones);
        // 注视追踪：始终生效（动画中头也跟随相机，增强生命力）
        gaze.apply(dt, semanticBones, ctx.camera!.position);
      }
      // 眨眼：随机间隔触发 morph（待机态，有动画时暂停避免冲突）
      const blinkEntry = semanticMorphs.blink;
      if (blinkEntry && mesh.morphTargetDictionary && mesh.morphTargetInfluences && (!action || action.paused)) {
        const idx = mesh.morphTargetDictionary[blinkEntry.name];
        if (idx !== undefined) {
          blink.apply(dt, (weight: number) => { mesh.morphTargetInfluences![idx] = weight; });
        }
      }
      // LipSync：待机态下多 morph 驱动（open/close/pucker/smile）
      // 当前用呼吸相位模拟，后续可接入 Web Audio API 真实振幅
      if (lipIndices && (!action || action.paused)) {
        lipSyncTime += dt;
        const breathPhase = Math.sin(lipSyncTime / 2.5 * Math.PI * 2);
        // 张嘴随呼吸相位变化，其他音素静默
        const openAmp = Math.max(0, breathPhase) * 0.4;
        lipSync.applyMulti(dt, { lipOpen: openAmp }, (morphId, weight) => {
          const idx = morphId === "lipOpen" ? lipIndices.open
            : morphId === "lipClose" ? lipIndices.close
            : morphId === "lipPucker" ? lipIndices.pucker
            : morphId === "lipSmile" ? lipIndices.smile
            : undefined;
          if (idx !== undefined) mesh.morphTargetInfluences![idx] = weight;
        });
      }
      // AutoDance：待机态下按节拍律动（与呼吸/眨眼/注视共存，动作叠加）
      const isIdle = !action || action.paused;
      // Foot IK：待机态下锚定双足（在 AutoDance 之前，防足部偏移被覆盖）
      footIK.apply(dt, isIdle);
      if (isIdle) {
        autoDance.apply(dt, semanticBones ?? {});
      }
    },
    // 先回收 blob URL（防御：库 dispose 抛错也不泄漏内存），再释放 MMD 资源（geometry/材质经核心 fullCleanup 防御释放）
    dispose: (): void => {
      bonePanelRef.current?.();
      mixer.stopAllAction();
      breath.reset();
      gaze.reset();
      blink.dispose();
      lipSync.dispose();
      autoDance.dispose();
      footIK.dispose();
      for (const url of blobUrls) URL.revokeObjectURL(url);
      mmd.dispose();
    },
    // ADR-052 P3：截图走共享 renderer（通用化，与 ysm/vrm/litematic 呑约对称）
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    semanticBones,
    // VPD 姿势导入：同目录 .vpd 文件加载后缓存，点击触发 applyVPD
    applyPose: vpdPoses.length > 0
      ? (index: number): void => {
          const pose = vpdPoses[index];
          if (!pose) return;
          try {
            applyVPD(mmd, pose.vpd, { ik: true, grant: true });
          } catch {
            /* 单个 VPD 应用失败不阻断预览 */
          }
        }
      : undefined,
  };
}

/** mmdMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface MmdMenuItemsOpts {
  navCtx: MmdBottomNavCtx;
  /** 截图能力（ADR-052 P3：screenshotFromRenderer 共享 renderer）；null → 不注入 shot 项 */
  screenshot: (() => Promise<string | null>) | null;
  /** 材质面板桥（mmd-materials.ts 纯逻辑层，ADR-072） */
  material: MaterialControlBridge;
  /** 播放/动作桥；null（无同目录 VMD）→ 不注入 play 项 */
  play: MmdPlayBridge | null;
  /** 骨骼面板依赖；null（无 pmx.bones / skeleton）→ 不注入 bones 项 */
  bonePanel: {
    /** 已构建骨骼树（buildBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: { current: (() => void) | null };
  } | null;
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: MmdPanelHooks;
}

/**
 * MMD 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放（+ 条件 bones）。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 */
export function mmdMenuItems(o: MmdMenuItemsOpts): PreviewMenuItemDef[] {
  const items: PreviewMenuItemDef[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      legacyTestId: "mmd-model-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      render: (list) => o.panels?.fillModelPanel?.(list, o.navCtx),
    },
    {
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      legacyTestId: "mmd-shot-entry",
      render: (list) => o.panels?.fillShotPanel?.(list, o.navCtx, o.screenshot),
    },
    {
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      legacyTestId: "mmd-material-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      render: (list) => o.panels?.buildMaterialControls?.(list, o.material),
    },
  ];
  if (o.play) {
    items.push({
      id: "play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      legacyTestId: "mmd-play-entry",
      dockGroup: "motion", // 底栏 💃 动作组
      render: (list) => o.panels?.fillPlayPanel?.(list, o.play!),
    });
  }
  if (o.bonePanel) {
    items.push({
      id: "bones",
      icon: "🦴",
      labelKey: "preview.bones",
      fallback: "骨骼",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组（ADR-085：补齐，与 ysm/vrm bones 对齐）
      legacyTestId: "mmd-bones-entry",
      render: (list) => {
        // 通用骨骼面板：渲染进根菜单面板；重入时先清理旧 renderer
        if (o.bonePanel!.cleanupRef.current) {
          o.bonePanel!.cleanupRef.current();
          o.bonePanel!.cleanupRef.current = null;
        }
        o.bonePanel!.cleanupRef.current = makeBonePanelRenderer(o.bonePanel!.tree)(list, {
          viewContainer: o.bonePanel!.viewContainer!,
          camera: o.bonePanel!.camera!,
          scene: o.bonePanel!.scene!,
        });
      },
    });
  }
  return items;
}
