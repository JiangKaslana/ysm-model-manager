// ===== 3D 相机初始化（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 根据场景 mesh 包围盒计算相机初始位置和目标点。
// ysmview 风格：相机放在 Z- 侧（模型正面），距离 = 最大包围盒尺寸 * 1.5 + 2。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * 根据场景包围盒适配相机位置和 controls.target。
 * @returns { initCamPos, initCamTarget } 初始状态的深拷贝，供 resetCamera 使用
 */
export function fitCameraToScene(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { initCamPos: THREE.Vector3; initCamTarget: THREE.Vector3 } {
  // 使用 setFromObject 而非 traverse+expandByObject：前者会正确应用父节点 scale，
  // 后者只计算局部包围盒，忽略 rootGroup.scale = 1/16（基岩标准），导致相机拉远 16 倍。
  const box = new THREE.Box3().setFromObject(scene);

  if (!box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 1.5 + 2;
    // 调试日志：验证包围盒尺寸和相机距离
    console.log('[Camera] Box size (after scale):', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
    console.log('[Camera] Camera distance:', dist.toFixed(2));
    // 模型包围盒适配：相机放 Z- 侧（模型正面；历史曾用 +Z/YSMViewer 默认，实际 YSM 模型脸朝 Z-）
    camera.position.set(center.x, center.y, center.z - dist);
    camera.lookAt(center);
    controls.target.copy(center);
    console.log('[Camera] Camera position:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
  } else {
    camera.position.set(0, 80, -120);
    controls.target.set(0, 80, 0);
  }
  controls.update();

  return {
    initCamPos: camera.position.clone(),
    initCamTarget: controls.target.clone(),
  };
}

/**
 * 按给定根节点列表（多模型同框）计算并集包围盒并返回相机初始位姿。
 * 与 fitCameraToScene 同口径，但只框显式传入的 roots（来自 SceneRegistry.visibleRoots），
 * 从而正确处理「隐藏模型不计入」「排除 sky/ground 基线」（ADR-093 T3）。
 * @param roots 各可见模型的根 Object3D（差量捕获所得）
 */
export function fitCameraToRoots(
  roots: THREE.Object3D[],
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { initCamPos: THREE.Vector3; initCamTarget: THREE.Vector3 } {
  const box = new THREE.Box3();
  for (const root of roots) {
    root.updateMatrixWorld();
    box.expandByObject(root);
  }

  if (!box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 1.5 + 2;
    camera.position.set(center.x, center.y, center.z - dist);
    camera.lookAt(center);
    controls.target.copy(center);
  } else {
    camera.position.set(0, 80, -120);
    controls.target.set(0, 80, 0);
  }
  controls.update();

  return {
    initCamPos: camera.position.clone(),
    initCamTarget: controls.target.clone(),
  };
}
