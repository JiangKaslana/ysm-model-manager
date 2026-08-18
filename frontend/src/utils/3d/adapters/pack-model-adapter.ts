// ===== pack-model-adapter.ts — MC 资源包模型内容适配器（ADR-080 + ADR-084 L2）=====
// 资源包（.zip）→ ListPackModels 枚举 → 首个 entry 作为初始 path → 逐面 BufferGeometry + MeshStandardMaterial（roughness 1.0）。
// ADR-084 L2：zip 当虚拟文件夹——buildPath 即 entry path（assets/minecraft/models/block/xxx.json），
// core switchTo(newEntryPath) 走 ADR-066 §5.6 语义（复用外壳重建内容层），不自建 ◀/▶。
// 通用外壳（overlay/renderer/循环/释放/根菜单切换面板）由 mount-preview-core.ts 拥有。
// 边界：适配器 0 backend import（ADR-072），Go 绑定经 deps 注入。
//
// L4：tint 面按类别取 MC biome 默认色（plains；数据来源见 mc-tints.ts / ADR-080 §5.4）。

import * as THREE from "three";
import {
  parseJavaModel,
  isRenderableModel,
  type JavaModelResult,
} from "../parse-java-model.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import { loadMcTints, getTintColorSync } from "../mc-tints.ts";
import type { PreviewAdapter, PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import { textureCache } from "../texture-cache.ts";

/** Go 绑定依赖（薄包装层经 getApp 注入，对齐 vrm/litematic 工厂模式） */
export interface PackDeps {
  readEntry(path: string, entry: string): Promise<string>;
}

// tint 染色类别映射（tintindex → MC 染色类别；视觉近似，ADR-080 §5.4）
// 0=grass, 1=leaves(foliage), 2=water, 3=dead_bush(固定色)
const TINT_CATEGORY = ["grass", "foliage", "water", "dead_bush"] as const;
const NO_TEX_FALLBACK = 0xcccccc;

interface PackState {
  group: THREE.Group | null;
  disposables: THREE.Object3D[];
}

/** 工厂：适配器持 zipPath（容器路径），buildPath 即 entry path（虚拟文件夹下的文件路径） */
export function makePackAdapter(deps: PackDeps, zipPath: string): PreviewAdapter {
  return {
    id: "resourcepack",
    build: (ctx, buildPath) => buildPackScene(ctx, buildPath, deps, zipPath),
  };
}

/** base64 → dataURL（纹理喂 TextureLoader） */
function b64ToDataURL(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

async function textureFor(
  deps: PackDeps,
  path: string,
  face: JavaModelResult["faces"][number],
): Promise<THREE.Material> {
  if (face.tintindex !== null) {
    const idx = Math.max(0, Math.min(3, face.tintindex));
    const cat = TINT_CATEGORY[idx];
    const color = getTintColorSync(cat, "plains");
    return new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.9, roughness: 1.0, metalness: 0.0 });
  }
  if (face.texColor) {
    return new THREE.MeshStandardMaterial({ color: parseInt(face.texColor.slice(1), 16), roughness: 1.0, metalness: 0.0 });
  }
  if (face.texEntry) {
    const b64 = await deps.readEntry(path, face.texEntry);
    if (b64) {
      const dataUrl = b64ToDataURL(b64);
      const tex = textureCache.acquire(dataUrl, (u) => {
        const t = new THREE.Texture(new Image());
        t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        const img = t.image as HTMLImageElement;
        img.onload = (): void => { t.needsUpdate = true; };
        img.src = u;
        return t;
      });
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0 });
    }
  }
  return new THREE.MeshStandardMaterial({ color: NO_TEX_FALLBACK, roughness: 1.0, metalness: 0.0 });
}

/** 构建单个模型的内容 group（面 → BufferGeometry + Material） */
async function buildModelGroup(
  deps: PackDeps,
  path: string,
  model: JavaModelResult,
): Promise<{ group: THREE.Group; disposables: THREE.Object3D[] }> {
  const group = new THREE.Group();
  const disposables: THREE.Object3D[] = [];
  for (const f of model.faces) {
    const mat = await textureFor(deps, path, f);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(f.verts.map((v) => v / 16), 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(f.uv, 2));
    geo.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(f.verts.map((_, i) => f.dir[i % 3]), 3),
    );
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    disposables.push(mesh);
  }
  return { group, disposables };
}

/** 包围盒定相机（对齐 vrm-adapter 口径） */
function frameCamera(ctx: PreviewBuildCtx, target: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (ctx.camera) {
    ctx.camera.near = 0.05;
    ctx.camera.far = maxDim * 50;
    ctx.camera.position.set(center.x, center.y + size.y * 0.15, center.z + maxDim * 1.8);
    ctx.camera.updateProjectionMatrix();
  }
  if (ctx.controls) {
    ctx.controls.target.copy(center);
    ctx.controls.minDistance = maxDim * 0.1;
    ctx.controls.maxDistance = maxDim * 12;
    ctx.controls.update();
  }
}

/** 释放内容层 GPU 资源（复用：build 失败和 dispose 共用） */
function disposeContent(state: PackState, scene: THREE.Scene): void {
  if (state.group && state.group.parent) {
    scene.remove(state.group);
  }
  for (const d of state.disposables) {
    d.traverse((o) => {
      const mesh = o as THREE.Mesh;
      try { mesh.geometry?.dispose(); } catch {}
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        try { m.dispose(); } catch {}
      }
    });
  }
  state.disposables = [];
  state.group = null;
}

/** 构建资源包模型预览场景（ADR-080 D3 + ADR-084 L2） */
async function buildPackScene(
  ctx: PreviewBuildCtx,
  entryPath: string, // ADR-084 L2：zip 内模型路径（虚拟文件夹下的文件路径）
  deps: PackDeps,
  zipPath: string,   // 容器路径（.zip 文件路径）
): Promise<PreviewScene> {
  if (!ctx.scene || !ctx.camera || !ctx.controls || !ctx.renderer) {
    throw new Error("pack-model shared 模式需要核心提供 scene/camera/controls/renderer");
  }

  const state: PackState = { group: null, disposables: [] };

  // 解析模型（entryPath = zip 内路径，readEntry 取 zip 内文件内容）
  let model: JavaModelResult | null = null;
  try {
    model = await parseJavaModel(entryPath, async (e) => deps.readEntry(zipPath, e));
  } catch (e) {
    ctx.loadingEl.remove();
    throw new Error(`资源包内模型解析失败: ${entryPath}`);
  }
  if (!isRenderableModel(model!)) {
    ctx.loadingEl.remove();
    throw new Error(`资源包内模型无完整纹理引用: ${entryPath}`);
  }

  // 预载 MC biome tint 表（vendored minecraft-data，ADR-080 §5.4 L4）；失败则降级 plains 默认常量
  try {
    await loadMcTints();
  } catch (e) {
    console.warn("[pack-model] tint 表加载失败，使用 plains 默认色兜底:", e);
  }

  // 释放旧内容层（ADR-084 L2：switchTo 先 dispose 旧 group 再重建）
  // 注意：core switchTo 已执行 built?.dispose()，但我们保留此处作为防御性清理（
  // 首次 build 时 state 为空 no-op，重建时确保无残留）。
  // 核心在 switchTo 内已移除 sceneBaseline 之外的子节点（line 724-727），此处只需释放 GPU 资源。
  if (state.group && state.group.parent) {
    ctx.scene!.remove(state.group);
  }

  const { group, disposables } = await buildModelGroup(deps, zipPath, model);
  state.group = group;
  state.disposables = disposables;
  ctx.scene!.add(group);
  frameCamera(ctx, group);
  ctx.loadingEl.remove();

  return {
    dispose: () => disposeContent(state, ctx.scene!),
    resetCamera: () => {
      if (ctx.camera && state.group) {
        frameCamera(ctx, state.group);
      }
    },
    setRotationMode: (orbit: boolean) => ctx.cameraControls?.setOrbit(orbit),
    setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer, ctx.scene, ctx.camera)),
  };
}

export { buildPackScene };