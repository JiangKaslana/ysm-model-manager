// ===== 3D debug 渲染层（从 model3d.ts 拆出，ADR-040 P1）=====
// rebuildDebug / makeTextTexture：pivot 标记 + 骨骼线框 + 文字标签叠加层。
// 频繁切换 debug 模式时每骨骼一个标签，注意 dispose 防 GPU 内存泄漏（致命陷阱 #11）。
import * as THREE from "three";
import { disposeMaterial } from "./mesh.ts";

export interface DebugBoneData {
  pos: THREE.Vector3;
  name: string;
  parentId?: string;
}

/** 生成骨骼名 Canvas 纹理（Sprite 标签用） */
export function makeTextTexture(text: string, color?: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = color || "#ffffff";
    ctx.font = "24px sans-serif";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 3;
    ctx.fillText(text, 4, 58);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.premultiplyAlpha = true;
  return tex;
}

/**
 * 重建 debug 叠加层（pivot 标记 / 骨骼线框）。
 * @param scene 目标场景
 * @param rootGroup 根骨骼组（用于遍历主组件骨骼）
 * @param boneGroupMap 骨骼 Group 映射（compKey 口径）
 * @param spec 原始 spec（取 spec.models[0].bones）
 * @param state debug 状态对象（持有 debugGroup / debugMode 引用）
 */
export function rebuildDebug(
  scene: THREE.Scene,
  rootGroup: THREE.Group,
  boneGroupMap: Map<string, THREE.Group>,
  spec: { models?: Array<{ bones?: Array<{ id: string; name: string; parentId?: string }> }> },
  state: { debugGroup: THREE.Group | null; debugMode: "normal" | "pivot" | "bone" },
): void {
  if (state.debugGroup) {
    // 释放旧 debug 组内的几何体/材质/纹理，防止内存泄漏
    state.debugGroup.traverse((c) => {
      const obj = c as THREE.Mesh | THREE.Line | THREE.Sprite;
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry?.dispose();
        const m = (obj as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => disposeMaterial(x));
        else disposeMaterial(m);
      } else if ((obj as THREE.Line).isLine) {
        (obj as THREE.Line).geometry?.dispose();
        const lm = (obj as THREE.Line).material;
        if (Array.isArray(lm)) lm.forEach((x) => x.dispose());
        else lm?.dispose();
      } else if ((obj as THREE.Sprite).isSprite) {
        (obj as THREE.Sprite).material.map?.dispose();
        (obj as THREE.Sprite).material?.dispose();
      }
    });
    scene.remove(state.debugGroup);
    state.debugGroup = null;
  }
  if (state.debugMode === "normal") return;
  state.debugGroup = new THREE.Group();
  scene.add(state.debugGroup);

  // 获取骨骼世界坐标（仅主组件 spec.models[0]，与 renderModel3D 原文口径一致）
  const boneWorldPositions = new Map<
    string,
    { pos: THREE.Vector3; name: string; parentId?: string }
  >();
  for (const bd of spec.models?.[0]?.bones || []) {
    const bg = boneGroupMap.get(bd.id);
    if (!bg) continue;
    const wp = new THREE.Vector3();
    bg.getWorldPosition(wp);
    boneWorldPositions.set(bd.id, {
      pos: wp,
      name: bd.name,
      parentId: bd.parentId,
    });
  }

  if (state.debugMode === "pivot") {
    for (const [, data] of boneWorldPositions) {
      const top = data.pos.clone();
      top.y += 4;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([data.pos, top]);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.25 }),
      );
      state.debugGroup.add(line);
      const tex = makeTextTexture(data.name, "#88ffaa");
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true });
      const label = new THREE.Sprite(mat);
      label.position.copy(top);
      label.scale.set(120, 24, 1);
      state.debugGroup.add(label);
    }
  } else if (state.debugMode === "bone") {
    for (const [, data] of boneWorldPositions) {
      const parentPos = data.parentId
        ? boneWorldPositions.get(data.parentId)?.pos
        : null;
      if (!parentPos) continue;
      const geo = new THREE.BufferGeometry().setFromPoints([data.pos.clone(), parentPos.clone()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x44aaff }));
      state.debugGroup.add(line);
    }
  }
}
