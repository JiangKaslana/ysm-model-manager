// ===== GroundCapability：地面能力（ADR-073 同款 caps/ 能力模式）=====
// 统一核心注入（mount-preview-core），YSM/VRM/MMD/Litematic 零改动继承。
// GridHelper 地面 + visible 开关；apply() 挂入场景，dispose() 移除并释放，
// 作用域不泄漏到其它预览（对齐 SkyCapability 生命周期口径）。
// 实现 SceneCapability 统一接口，支持注册表自动发现 + 菜单控件 + 持久化。

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export interface GroundParams {
  /** 地面网格尺寸（世界单位） */
  size: number;
  /** 网格分段 */
  divisions: number;
  /** 中心轴线颜色 */
  colorCenter: number;
  /** 网格线颜色 */
  colorGrid: number;
  /** 地面初始可见 */
  visible: boolean;
  /** 湿润度 0=干 1=完全湿润；>0 时叠加半透明水面 Mesh */
  wetness: number;
  /** 水面颜色（湿润时叠加层底色） */
  waterColor: number;
  /** 水面不透明度 0=透明 1=不透明 */
  waterOpacity: number;
  /** 法线贴图强度 0=无效果 1=完全按波浪法线 */
  normalStrength: number;
}

export const DEFAULT_GROUND_PARAMS: GroundParams = {
  size: 50,
  divisions: 50,
  colorCenter: 0x444466,
  colorGrid: 0x333355,
  visible: true,
  wetness: 0,
  waterColor: 0x335577,
  waterOpacity: 0.6,
  normalStrength: 0.3,
};

export class GroundCapability implements SceneCapability {
  readonly id = "ground";
  readonly labelKey = "preview.ground";
  readonly icon = "🌐";
  readonly descKey = "preview.groundDesc";

  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  private water: THREE.Mesh; // 半透明水面叠加层（wetness>0 时显示）
  private waterTime: { value: number }; // 水面波纹动画 time uniform
  private params: GroundParams;
  private enabled: boolean;

  constructor(opts: {
    scene: THREE.Scene;
    params?: Partial<GroundParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.params = { ...DEFAULT_GROUND_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.grid = new THREE.GridHelper(
      this.params.size,
      this.params.divisions,
      this.params.colorCenter,
      this.params.colorGrid,
    );
    this.grid.visible = this.params.visible;
    this.grid.name = "ysm-ground";

    // 半透明水面：PlaneGeometry 旋转到水平，MeshStandardMaterial 半透明
    const waterGeo = new THREE.PlaneGeometry(this.params.size, this.params.size, 32, 32);
    const waterMat = new THREE.MeshStandardMaterial({
      color: this.params.waterColor,
      transparent: true,
      opacity: this.params.waterOpacity * this.params.wetness,
      roughness: 0.2, // 湿润表面低粗糙度 → 高反射
      metalness: 0.3,
      depthWrite: false, // 不遮挡网格
    });

    // ── 水面波纹动画 ──
    // onBeforeCompile 注入 time uniform + vertex shader 波动函数；
    // update(dt) 推进 time uniform，render loop 调用。
    this.waterTime = { value: 0 };
    waterMat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms["uTime"] = this.waterTime;
      // vertex shader：注入 time uniform + 波动函数，扰动 position.z（水面 local Y）
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         float wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
           return amp * sin(dot(p, dir) * freq + uTime * speed);
         }`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         // PlaneGeometry 顶点在 local XY 平面，rotation.x=-π/2 后 local Y→world Z
         // 扰动 transformed.z 模拟水面波动
         vec2 wpos = transformed.xy;
         float h = 0.0;
         h += wave(wpos, normalize(vec2(1.0, 0.3)), 0.8, 1.2, 0.08);
         h += wave(wpos, normalize(vec2(-0.4, 1.0)), 1.1, 0.9, 0.05);
         h += wave(wpos, normalize(vec2(0.2, -0.8)), 1.6, 1.5, 0.03);
         transformed.z += h;`,
      );
    };
    waterMat.needsUpdate = true;

    // 程序化法线贴图：让水面 PBR 光照/反射随波浪变化更真实
    const normalMap = this.generateNormalMap(256);
    waterMat.normalMap = normalMap;
    waterMat.normalScale = new THREE.Vector2(this.params.normalStrength, this.params.normalStrength);
    waterMat.needsUpdate = true;

    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.rotation.x = -Math.PI / 2; // 水平
    this.water.position.y = 0.01; // 略高于网格避免 z-fighting
    this.water.name = "ysm-ground-water";
    this.water.visible = this.params.wetness > 0;
  }

  /** 推进水面波纹动画（render loop 调用） */
  update(dt: number): void {
    this.waterTime.value += dt;
  }

  /** 挂入场景（对齐 SkyCapability.apply 口径） */
  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
    if (!this.water.parent) this.scene.add(this.water);
  }

  /** 地面显隐开关（水面跟随） */
  setVisible(v: boolean): void {
    this.grid.visible = v;
    this.water.visible = v && this.params.wetness > 0;
  }

  getVisible(): boolean {
    return this.grid.visible;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.grid.parent) this.grid.parent.remove(this.grid);
      if (this.water.parent) this.water.parent.remove(this.water);
    }
  }

  // ── 水面参数（湿润表面模式）──
  setWetness(v: number): void {
    this.params.wetness = Math.max(0, Math.min(1, v));
    const mat = this.water.material as THREE.MeshStandardMaterial;
    mat.opacity = this.params.waterOpacity * this.params.wetness;
    this.water.visible = this.grid.visible && this.params.wetness > 0;
  }
  getWetness(): number {
    return this.params.wetness;
  }
  setWaterColor(hex: number): void {
    this.params.waterColor = hex;
    (this.water.material as THREE.MeshStandardMaterial).color.setHex(hex);
  }
  getWaterColor(): number {
    return this.params.waterColor;
  }
  setWaterOpacity(v: number): void {
    this.params.waterOpacity = Math.max(0, Math.min(1, v));
    (this.water.material as THREE.MeshStandardMaterial).opacity = this.params.waterOpacity * this.params.wetness;
  }
  getWaterOpacity(): number {
    return this.params.waterOpacity;
  }

  // ── 法线贴图强度 ──
  setNormalStrength(v: number): void {
    this.params.normalStrength = Math.max(0, Math.min(1, v));
    const mat = this.water.material as THREE.MeshStandardMaterial;
    const s = new THREE.Vector2(this.params.normalStrength, this.params.normalStrength);
    mat.normalScale.copy(s);
  }
  getNormalStrength(): number {
    return this.params.normalStrength;
  }

  // ── 程序化法线贴图生成 ──
  private generateNormalMap(size: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const sz = this.params.size;

    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        // 归一化到波浪空间
        const x = (u / size - 0.5) * sz * 2;
        const y = (v / size - 0.5) * sz * 2;

        let dhdx = 0, dhdy = 0;

        // Wave 1: dir=(1,0.3) normalized, freq=0.8, amp=0.08
        const d1 = new THREE.Vector2(1, 0.3).normalize();
        const p1 = new THREE.Vector2(x, y);
        const phase1 = p1.dot(d1) * 0.8;
        dhdx += 0.08 * Math.cos(phase1) * d1.x * 0.8;
        dhdy += 0.08 * Math.cos(phase1) * d1.y * 0.8;

        // Wave 2: dir=(-0.4,1) normalized, freq=1.1, amp=0.05
        const d2 = new THREE.Vector2(-0.4, 1).normalize();
        const p2 = new THREE.Vector2(x, y);
        const phase2 = p2.dot(d2) * 1.1;
        dhdx += 0.05 * Math.cos(phase2) * d2.x * 1.1;
        dhdy += 0.05 * Math.cos(phase2) * d2.y * 1.1;

        // Wave 3: dir=(0.2,-0.8) normalized, freq=1.6, amp=0.03
        const d3 = new THREE.Vector2(0.2, -0.8).normalize();
        const p3 = new THREE.Vector2(x, y);
        const phase3 = p3.dot(d3) * 1.6;
        dhdx += 0.03 * Math.cos(phase3) * d3.x * 1.6;
        dhdy += 0.03 * Math.cos(phase3) * d3.y * 1.6;

        // 组合法线：N = (-dh/dx, -dh/dy, 1) 归一化
        const nx = -dhdx;
        const ny = -dhdy;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const nnx = nx / len;
        const nny = ny / len;

        // 编码到 RGB
        const idx = (v * size + u) * 4;
        data[idx] = Math.round((nnx * 0.5 + 0.5) * 255);       // R
        data[idx + 1] = Math.round((nny * 0.5 + 0.5) * 255);   // G
        data[idx + 2] = 255;                                     // B (朝上)
        data[idx + 3] = 255;                                     // A
      }
    }

    return new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 返回菜单控件定义（框架自动渲染） */
  getMenuControls(): MenuControlDef[] {
    return [
      // 顶部主控件：地面显隐
      {
        id: "ground-visible",
        kind: "toggle",
        labelKey: "preview.ground",
        fallback: "地面",
        getValue: () => this.getVisible(),
        setValue: (v) => this.setVisible(v as boolean),
      },
      // 水面参数组（湿润表面模式）
      {
        id: "ground-wetness",
        kind: "slider",
        labelKey: "preview.groundWetness",
        fallback: "湿润度",
        group: "preview.groundGroupWater",
        slider: { min: 0, max: 1, step: 0.05 },
        getValue: () => this.getWetness(),
        setValue: (v) => this.setWetness(v as number),
      },
      {
        id: "ground-water-color",
        kind: "color",
        labelKey: "preview.groundWaterColor",
        fallback: "水色",
        group: "preview.groundGroupWater",
        getValue: () => this.getWaterColor(),
        setValue: (v) => this.setWaterColor(v as number),
      },
      {
        id: "ground-water-opacity",
        kind: "slider",
        labelKey: "preview.groundWaterOpacity",
        fallback: "不透明度",
        group: "preview.groundGroupWater",
        slider: { min: 0, max: 1, step: 0.05 },
        getValue: () => this.getWaterOpacity(),
        setValue: (v) => this.setWaterOpacity(v as number),
      },
      {
        id: "ground-normal-strength",
        kind: "slider",
        labelKey: "preview.groundNormalStrength",
        fallback: "法线强度",
        group: "preview.groundGroupWater",
        slider: { min: 0, max: 1, step: 0.05 },
        getValue: () => this.getNormalStrength(),
        setValue: (v) => this.setNormalStrength(v as number),
      },
    ];
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      visible: this.params.visible,
      enabled: this.enabled,
      wetness: this.params.wetness,
      waterColor: this.params.waterColor,
      waterOpacity: this.params.waterOpacity,
      normalStrength: this.params.normalStrength,
    });
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.visible === "boolean") {
      this.params.visible = state.visible;
      this.grid.visible = state.visible;
    }
    if (typeof state.wetness === "number") this.setWetness(state.wetness);
    if (typeof state.waterColor === "number") this.setWaterColor(state.waterColor);
    if (typeof state.waterOpacity === "number") this.setWaterOpacity(state.waterOpacity);
    if (typeof state.normalStrength === "number") this.setNormalStrength(state.normalStrength);
  }

  /** 移除并释放（GridHelper 材质可能是数组，遍历 dispose） */
  dispose(): void {
    if (this.grid.parent) this.grid.parent.remove(this.grid);
    if (this.water.parent) this.water.parent.remove(this.water);
    this.grid.geometry.dispose();
    const mat = this.grid.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
  }
}
