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
  scene.updateMatrixWorld();
  const box = new THREE.Box3();
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) box.expandByObject(child);
  });

  if (!box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 1.5 + 2;
    // 模型包围盒适配：相机放 Z- 侧（模型正面；历史曾用 +Z/YSMViewer 默认，实际 YSM 模型脸朝 Z-）
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
