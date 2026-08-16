// ===== pack-model-adapter.ts — MC 资源包模型内容适配器（ADR-080）=====
// 资源包（.zip）→ ListPackModels 枚举 → 解析首个完整可渲染 block/item 模型
// → 逐面 BufferGeometry + MeshLambert（纹理/纯色/tint 近似）→ 挂核心 scene。
// 模型浏览：extraControls 挂"◀ n/N ▶"切换（复用外壳，重建内容层）。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。
// 边界：适配器 0 backend import（ADR-072），Go 绑定经 deps 注入。

import * as THREE from "three";
import {
  parseJavaModel,
  isRenderableModel,
  b64ToBytes,
  type JavaModelResult,
} from "../parse-java-model.ts";
import type { PreviewAdapter, PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

/** Go 绑定依赖（薄包装层经 getApp 注入，对齐 vrm/litematic 工厂模式） */
export interface PackDeps {
  listModels(path: string): Promise<string[]>;
  readEntry(path: string, entry: string): Promise<string>;
}

/** tint 染色面近似色（无 biome 数据的兜底，ADR-080 已知限制） */
const TINT_FALLBACK = 0x7cbd4b;
const NO_TEX_FALLBACK = 0xcccccc;

interface PackState {
  entries: string[];
  index: number;
  cache: Map<string, JavaModelResult>;
  root: THREE.Group | null;
  disposables: THREE.Object3D[];
}

function makePackAdapter(deps: PackDeps): PreviewAdapter {
  return {
    id: "resourcepack",
    build: (ctx, path) => buildPackScene(ctx, path, deps),
  };
}

/** base64 → dataURL（纹理喂 TextureLoader） */
function b64ToDataURL(b64: string): string {
  const bytes = b64ToBytes(b64);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(bin)}`;
}

async function textureFor(
  ctx: PreviewBuildCtx,
  deps: PackDeps,
  path: string,
  face: JavaModelResult["faces"][number],
): Promise<THREE.Material> {
  // tint 面：近似草绿（无 biome 数据）
  if (face.tintindex !== null) {
    return new THREE.MeshLambertMaterial({ color: TINT_FALLBACK, transparent: true, opacity: 0.9 });
  }
  if (face.texColor) {
    return new THREE.MeshLambertMaterial({ color: parseInt(face.texColor.slice(1), 16) });
  }
  if (face.texEntry) {
    const b64 = await deps.readEntry(path, face.texEntry);
    if (b64) {
      const tex = await new THREE.TextureLoader().loadAsync(b64ToDataURL(b64));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter; // MC 像素风
      tex.minFilter = THREE.NearestFilter;
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      // 半透明面（overlay 草层/植物）随材质透明；纹理无 alpha 时忽略
      return mat;
    }
  }
  return new THREE.MeshLambertMaterial({ color: NO_TEX_FALLBACK });
}

/** 构建单个模型的内容 group（面 → BufferGeometry + Material） */
async function buildModelGroup(
  ctx: PreviewBuildCtx,
  deps: PackDeps,
  path: string,
  model: JavaModelResult,
): Promise<{ group: THREE.Group; disposables: THREE.Object3D[] }> {
  const group = new THREE.Group();
  const disposables: THREE.Object3D[] = [];
  for (const f of model.faces) {
    const mat = await textureFor(ctx, deps, path, f);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(f.verts.map((v) => v / 16), 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(f.uv, 2));
    geo.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(f.verts.map((_, i) => f.dir[i % 3]), 3),
    );
    // prismarine 无 AO 索引：(0,1,2),(2,1,3)
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

/** 构建资源包模型预览场景（ADR-080 D3） */
export async function buildPackScene(
  ctx: PreviewBuildCtx,
  path: string,
  deps: PackDeps,
): Promise<PreviewScene> {
  const entries = (await deps.listModels(path)).filter((e) => e.includes("/block/") || e.includes("/item/")); // 方块 + 物品
  if (entries.length === 0) {
    ctx.loadingEl.remove();
    throw new Error("资源包内无方块/物品模型（无 3D 内容）");
  }

  const state: PackState = { entries, index: -1, cache: new Map(), root: null, disposables: [] };

  // 定位首个完整可渲染模型（懒解析，纯模板如 cube/cube_all 自动跳过）
  let start = 0;
  while (start < entries.length) {
    const m = await parseJavaModel(entries[start], async (e) => deps.readEntry(path, e));
    if (isRenderableModel(m)) {
      state.cache.set(entries[start], m);
      break;
    }
    start++;
  }
  if (start >= entries.length) {
    ctx.loadingEl.remove();
    throw new Error("资源包内无完整可渲染模型（缺少纹理引用）");
  }
  state.index = start;

  // 环境光（对齐 vrm-adapter）
  ctx.scene!.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(1, 2, 1);
  ctx.scene!.add(dl);
  ctx.scene!.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.4));

  /** 重建当前索引模型（复用外壳，替换内容层） */
  async function rebuild(): Promise<void> {
    if (state.root) {
      ctx.scene!.remove(state.root);
      for (const d of state.disposables) {
        d.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const m of mats) {
            (m as THREE.MeshLambertMaterial).map?.dispose();
            (m as THREE.Material).dispose();
          }
        });
      }
      state.disposables = [];
      state.root = null;
    }
    const entry = state.entries[state.index];
    let model = state.cache.get(entry);
    if (!model) {
      model = (await parseJavaModel(entry, async (e) => deps.readEntry(path, e))) ?? undefined;
      if (!model) return; // 解析失败：保持现状
      state.cache.set(entry, model);
    }
    const { group, disposables } = await buildModelGroup(ctx, deps, path, model);
    ctx.scene!.add(group);
    state.root = group;
    state.disposables = disposables;
    frameCamera(ctx, group);
    if (labelEl) labelEl.textContent = `${state.index + 1}/${entries.length}`;
  }

  // 模型切换控件（挂通用 topBar）
  const sep = document.createElement("span");
  sep.style.opacity = "0.4";
  sep.textContent = "│";
  const prevBtn = document.createElement("button");
  prevBtn.textContent = "◀";
  prevBtn.title = "上一个模型";
  prevBtn.onclick = () => {
    if (entries.length === 0) return;
    state.index = (state.index - 1 + entries.length) % entries.length;
    void rebuild();
  };
  const nextBtn = document.createElement("button");
  nextBtn.textContent = "▶";
  nextBtn.title = "下一个模型";
  nextBtn.onclick = () => {
    if (entries.length === 0) return;
    state.index = (state.index + 1) % entries.length;
    void rebuild();
  };
  const labelEl = document.createElement("span");
  labelEl.style.fontSize = "12px";
  labelEl.style.opacity = "0.8";
  labelEl.textContent = `-/${entries.length}`;

  // 首模型渲染
  await rebuild();
  ctx.loadingEl.remove(); // 加载完成，移除占位

  return {
    dispose: (): void => {
      if (state.root) ctx.scene!.remove(state.root);
      for (const d of state.disposables) {
        d.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const m of mats) {
            (m as THREE.MeshLambertMaterial).map?.dispose();
            (m as THREE.Material).dispose();
          }
        });
      }
      state.disposables = [];
      state.root = null;
    },
    extraControls: (topBar: HTMLElement): void => {
      topBar.appendChild(sep);
      topBar.appendChild(prevBtn);
      topBar.appendChild(labelEl);
      topBar.appendChild(nextBtn);
    },
  };
}

export { makePackAdapter };
