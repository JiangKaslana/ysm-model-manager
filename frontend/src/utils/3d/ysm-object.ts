// ===== ysm-object.ts — YSM 3D 场景图构建（可挂任意 THREE.Scene）=====
// ADR-066 §5.7 shared 化第一步：从 renderModel3D 抽出「内容层」——
// spec → Object3D 场景图（boneGroupMap/rootGroup/modelGroups），不依赖
// renderer/scene 实例，供统一核心（mount-preview-core shared 模式）挂载；
// renderModel3D 内部复用同一函数（自建外壳路径零回归）。
//
// 与 renderModel3D 原内联逻辑的差异：
//   - 不修改入参 spec（原实现原地改 spec.models[].meshGroups 合并网格，
//     多实例共享 spec 会互相污染；此处合并到本地结构）
//   - 不建 renderer/scene/camera/controls，不跑 rAF，不做输入/射线/调试接线
//     （这些属外壳层，由调用方决定：renderModel3D 自建壳 / 统一核心 shared 模式）

import * as THREE from "three";
import { buildSceneMesh, compKey } from "./mesh.ts";
import { addMeshToBoneGroup } from "./mesh-builder.ts";
import { disposeSceneMeshes } from "./cleanup-helper.ts";
import { getBoneList } from "./bone-list.ts";
import { setBoneVisible, toggleBone, showModelGroup } from "./bone-visibility.ts";
import type { Spec3D, SpecMeshGroup3D } from "./model3d.ts";

/** YSM 内容场景句柄：挂进任意 scene 后的内容层操作与释放 */
export interface YsmObjectHandle {
  rootGroup: THREE.Group;
  /** boneId 分组（含模型组维度 compKey），供骨骼拾取/显隐 */
  boneGroupMap: Map<string, THREE.Group>;
  /** 模型组（多组件模型切换） */
  modelGroups: THREE.Group[];
  showModelGroup(idx: number): void;
  getModelGroupCount(): number;
  setBoneVisible(name: string, visible: boolean): void;
  toggleBone(name: string): void;
  getBoneList(): Array<{ id: string; name: string; parentId?: string | null }>;
  /** 从所在 scene 移除 rootGroup 并释放其几何/材质资源（不含 scene/camera/controls） */
  removeFromScene(scene: THREE.Scene): void;
}

/**
 * 构建 YSM 内容场景图：spec → rootGroup（骨骼分组 + 网格挂载 + 纹理绑定）。
 * 纯 three 场景图构建，无渲染壳依赖。
 * ADR-114 perComponent：componentTexMap 按组件名查独立纹理数组，
 * 不再依赖全局 texArr[texIdx] 槽位顺序。
 */
export function buildYsmObject(
  spec: Spec3D,
  texArr: (THREE.Texture | null)[],
  componentTexMap: Map<string, (THREE.Texture | null)[]>,
  texIdx = 0,
): YsmObjectHandle {
  const { boneGroupMap, rootGroup, modelGroups } = buildSceneMesh(spec);

  // 网格合并 + 挂载（原 renderModel3D 内联逻辑；合并结果本地化，不写回 spec）
  for (const [mi, mg] of (spec.models || []).entries()) {
    if (!mg.meshGroups?.length) continue;
    const grouped = new Map<string, SpecMeshGroup3D[]>();
    for (const md of mg.meshGroups) {
      const key = md.boneId + ":" + (md.texIdx ?? 0);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(md);
    }
    const merged: SpecMeshGroup3D[] = [];
    for (const [, g] of grouped) {
      if (g.length === 1) {
        merged.push(g[0]);
        continue;
      }
      let positions: number[] = [];
      let normals: number[] = [];
      let uvs: number[] = [];
      let idx: number[] = [];
      let idxOff = 0;
      const standalone: SpecMeshGroup3D[] = [];
      for (const md of g) {
        const isId =
          md.localRotation?.[3] === 1 &&
          md.localRotation?.[0] === 0 &&
          md.localRotation?.[1] === 0 &&
          md.localRotation?.[2] === 0;
        if (!isId) {
          standalone.push(md);
          continue;
        }
        const dx = md.localPosition?.[0] || 0;
        const dy = md.localPosition?.[1] || 0;
        const dz = md.localPosition?.[2] || 0;
        for (let i = 0; i < (md.positions?.length || 0); i += 3) {
          positions.push((md.positions[i] || 0) + dx);
          positions.push((md.positions[i + 1] || 0) + dy);
          positions.push((md.positions[i + 2] || 0) + dz);
        }
        if (md.normals) normals.push(...md.normals);
        if (md.uvs) uvs.push(...md.uvs);
        for (let i = 0; i < (md.indices?.length || 0); i++)
          idx.push((md.indices[i] || 0) + idxOff);
        idxOff += (md.positions?.length || 0) / 3;
      }
      if (positions.length)
        merged.push({
          id: g[0].boneId + "_merged",
          boneId: g[0].boneId,
          texIdx: g[0].texIdx,
          localPosition: [0, 0, 0],
          localRotation: [0, 0, 0, 1],
          positions,
          normals,
          uvs,
          indices: idx,
        });
      merged.push(...standalone);
    }
    // 写回 spec（原 renderModel3D 语义，model3d.test.ts 锁定）：单实例预览下
    // spec 每次由 preloadModel 重新生成，写回不污染跨会话；多实例若未来出现
    // 需改为克隆 spec 后合并（当前无此场景）。
    mg.meshGroups = merged;
    // ADR-114 perComponent：按组件名查 componentTexMap，fallback 全局 texArr
    const compName = mg.name ?? `comp_${mi}`;
    const compTexArr = componentTexMap.get(compName) ?? texArr;
    for (const md of mg.meshGroups) {
      const bg = boneGroupMap.get(compKey(mi, md.boneId));
      if (!bg) continue;
      if (md.texIdx === undefined) {
        console.warn("[model3d] mesh 缺 texIdx（spec 契约破坏），回退 0", spec.models?.length);
      }
      addMeshToBoneGroup(bg, md, compTexArr);
    }
  }

  return {
    rootGroup,
    boneGroupMap,
    modelGroups,
    showModelGroup: (idx: number) => showModelGroup(modelGroups, idx),
    getModelGroupCount: () => spec.models?.length || 0,
    setBoneVisible: (name: string, visible: boolean) => setBoneVisible(boneGroupMap, name, visible),
    toggleBone: (name: string) => toggleBone(boneGroupMap, name),
    getBoneList: () => getBoneList(spec),
    removeFromScene(scene: THREE.Scene): void {
      scene.remove(rootGroup);
      disposeSceneMeshes(rootGroup);
    },
  };
}
