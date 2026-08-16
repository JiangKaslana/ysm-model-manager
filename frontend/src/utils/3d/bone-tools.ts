// ===== 通用骨骼工具层（跨格式：YSM spec bones / VRM humanoid bones 均适配）=====
// 屏蔽「YSM 扁平声明 vs VRM Object3D 层级树」形态差异，统一为 BoneNode 抽象。
// 能力：骨骼树构建 / 列表（枚举+父子+深度）/ 拾取（Raycaster 命中）/ 显隐 /
// 详情（路径/坐标/父/子）。纯逻辑零 DOM——UI 渲染不在本层（ADR-072 工具层纯净）。
// YSM 侧既有 bone-list.ts / bone-raycast.ts / bone-visibility.ts 不推倒，
// 本层是独立通用工具；是否桥接见任务 #5 检查结论。

import * as THREE from "three";

/** 统一骨骼节点：来源无关（YSM spec bones / VRM humanoid bones 均适配） */
export interface BoneNode {
  /** 唯一标识（YSM: bone.id；VRM: humanoid bone 名如 "leftUpperArm"） */
  id: string;
  /** 显示名 */
  name: string;
  /** 父骨骼 id（无 = 根） */
  parentId: string | null;
  /** 可选 3D 节点：拾取/显隐/坐标操作需要；纯列表/路径/详情场景可缺省 */
  object?: THREE.Object3D;
}

/** 骨骼树：id 索引 + 子映射 + 根集合（buildBoneTree 产物） */
export interface BoneTree {
  byId: Map<string, BoneNode>;
  childrenMap: Map<string, string[]>;
  roots: string[];
}

/**
 * 从任意扁平骨骼声明构建层级树。
 * 输入契约足够宽：仅要求 { id, name, parentId? }——YSM 扁平 bones、
 * VRM humanoid 提取结果均可直接喂入。
 */
export function buildBoneTree(bones: Array<{ id: string; name: string; parentId?: string | null; object?: THREE.Object3D }>): BoneTree {
  const byId = new Map<string, BoneNode>();
  const childrenMap = new Map<string, string[]>();
  const roots: string[] = [];
  for (const b of bones) {
    byId.set(b.id, { id: b.id, name: b.name, parentId: b.parentId ?? null, object: b.object });
    if (!childrenMap.has(b.id)) childrenMap.set(b.id, []);
  }
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      const kids = childrenMap.get(node.parentId);
      if (kids) kids.push(node.id);
    } else {
      roots.push(node.id);
    }
  }
  return { byId, childrenMap, roots };
}

/** 深度缩进的骨骼列表项（枚举 + 父子 + 深度） */
export interface BoneListItem {
  id: string;
  name: string;
  depth: number;
}

/** 骨骼树 → 深度缩进列表（前序遍历，根 depth=0；数组顺序即展开顺序） */
export function listBonesWithDepth(tree: BoneTree): BoneListItem[] {
  const out: BoneListItem[] = [];
  const walk = (id: string, depth: number): void => {
    const node = tree.byId.get(id);
    if (!node) return;
    out.push({ id: node.id, name: node.name, depth });
    for (const cid of tree.childrenMap.get(id) || []) walk(cid, depth + 1);
  };
  for (const root of tree.roots) walk(root, 0);
  return out;
}

/** 骨骼 id → 全路径（如 "root / spine / head"；找不到该 id 返回 null） */
export function getBonePath(id: string, tree: BoneTree): string | null {
  if (!tree.byId.has(id)) return null;
  const parts: string[] = [];
  let cur: string | undefined = id;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const node = tree.byId.get(cur);
    if (!node) break;
    parts.unshift(node.name);
    cur = node.parentId || undefined;
  }
  return parts.join(" / ");
}

/** 骨骼 id → 世界坐标（需 object；无 object 或缺省返回 null） */
export function getBonePosition(id: string, tree: BoneTree): THREE.Vector3 | null {
  const node = tree.byId.get(id);
  if (!node?.object) return null;
  const pos = new THREE.Vector3();
  return node.object.getWorldPosition(pos);
}

/** 骨骼详情：路径/坐标/父骨骼/子骨骼列表（id 不存在返回 null） */
export interface BoneDetail {
  id: string;
  name: string;
  path: string;
  position: THREE.Vector3 | null;
  parent: { id: string; name: string } | null;
  children: Array<{ id: string; name: string }>;
}

export function getBoneDetail(id: string, tree: BoneTree): BoneDetail | null {
  const node = tree.byId.get(id);
  if (!node) return null;
  const parent = node.parentId ? tree.byId.get(node.parentId) : undefined;
  const children = (tree.childrenMap.get(id) || [])
    .map((cid) => tree.byId.get(cid))
    .filter((n): n is BoneNode => !!n)
    .map((n) => ({ id: n.id, name: n.name }));
  return {
    id: node.id,
    name: node.name,
    path: getBonePath(id, tree) || node.name,
    position: getBonePosition(id, tree),
    parent: parent ? { id: parent.id, name: parent.name } : null,
    children,
  };
}

/** 骨骼显隐：设置该骨骼节点及其所有子网格可见性（需 object；无 object no-op） */
export function setBoneVisible(node: BoneNode | undefined, visible: boolean): void {
  if (!node?.object) return;
  node.object.traverse((c) => {
    (c as THREE.Object3D).visible = visible;
  });
}

/** 骨骼显隐：切换（取反）该骨骼节点可见性 */
export function toggleBoneVisible(node: BoneNode | undefined): void {
  if (!node?.object) return;
  node.object.traverse((c) => {
    (c as THREE.Object3D).visible = !c.visible;
  });
}

// 注意（审核，2026-08-16）：骨骼「拾取」不在此层——拾取策略格式相关：
//   - ysm（cube mesh 有几何）走 bone-raycast.ts 的 intersectObjects + name 归属；
//   - mmd（THREE.Bone 无几何）走 mmd-bones.ts pickMmdBone 的「射线到骨骼距离」法；
//   - vrm（humanoid node）待接。
// 曾在此放 pickBone/findAncestorBoneId（「网格面片归属拾取」，只适用于 ysm 且有
// 无消费者），已拆出——通用工具只保留格式无关的树/列表/路径/详情/显隐。
