// ===== 3D 场景灯光样板（快消批：AmbientLight(0xffffff,1.0) + DirLight(0xffffff,2)@10,30,20）=====
// 原样板逐字重复：renderer-setup.ts、screenshot-renderer.ts 各一份；
// litematic-3d.ts 使用参数化柔光（Ambient 0.7 / Dir 0.5+0.3），不纳入。
import * as THREE from "three";

// 标准主灯方向（renderer-setup / screenshot-renderer 口径一致）
const DIR_LIGHT_POS = [10, 30, 20] as const;

/**
 * 添加 3D 场景标准主灯（AmbientLight 0xffffff@1.0 + DirectionalLight 0xffffff@2 位于 [10,30,20]）。
 * 收 renderer-setup / screenshot-renderer 逐字样板（索引 7.1）；零行为变更。
 */
export function addStandardSceneLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 2);
  dl.position.set(DIR_LIGHT_POS[0], DIR_LIGHT_POS[1], DIR_LIGHT_POS[2]);
  scene.add(dl);
}