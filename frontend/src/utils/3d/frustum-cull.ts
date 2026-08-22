// ===== 视锥裁剪工具（Group 级 frustum culling）=====
// Three.js 默认逐 mesh 做 frustumCulled，但对整个 Group 仍需遍历子节点。
// 本工具在 Group 级做 BoundingSphere 测试，visible=false 后 Three.js 跳过整组遍历。
// 用途：多模型同框时，镜头外的模型整组跳过（省 matrixWorld 递归 + mesh 遍历）。
import * as THREE from "three";

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();

/** 需要裁剪的模型根节点列表（adapter 在 scene.add 时注册） */
const modelRoots: THREE.Object3D[] = [];

/** 注册模型根节点（adapter 调用） */
export function registerModelRoot(obj: THREE.Object3D): void {
  if (!modelRoots.includes(obj)) modelRoots.push(obj);
}

/** 注销模型根节点（adapter dispose 时调用） */
export function unregisterModelRoot(obj: THREE.Object3D): void {
  const i = modelRoots.indexOf(obj);
  if (i >= 0) modelRoots.splice(i, 1);
}

/** 获取当前注册的模型根节点数 */
export function getModelRootCount(): number {
  return modelRoots.length;
}

/**
 * 对所有已注册的模型根节点做视锥裁剪。
 * visible=false 的对象会被 Three.js 跳过（不遍历子 mesh）。
 * 在 render loop 中每帧调用一次。
 */
export function cullModelGroups(camera: THREE.Camera): void {
  if (modelRoots.length === 0) return;
  for (let i = modelRoots.length - 1; i >= 0; i--) {
    if (!modelRoots[i].parent) modelRoots.splice(i, 1);
  }
  if (modelRoots.length === 0) return;
  if (modelRoots.length === 1) {
    const obj = modelRoots[0];
    obj.visible = Boolean((obj as THREE.Mesh).isMesh || obj.children.length > 0);
    return;
  }
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  for (let i = modelRoots.length - 1; i >= 0; i--) {
    const obj = modelRoots[i];
    if (!obj.parent) {
      // 已从场景移除，清理引用
      modelRoots.splice(i, 1);
      continue;
    }
    _box.setFromObject(obj);
    if (_box.isEmpty()) {
      obj.visible = false;
      continue;
    }
    _box.getBoundingSphere(_sphere);
    obj.visible = _frustum.intersectsSphere(_sphere);
  }
}

/** 清空所有注册（session 结束时调用） */
export function clearModelRoots(): void {
  modelRoots.length = 0;
}
