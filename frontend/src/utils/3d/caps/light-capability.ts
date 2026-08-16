// ===== LightCapability — 3D 预览个人灯光系统 =====
// 递进第一步（ADR-081 L1）：聚光灯 + 体积光锥。后续可平滑升级 post-process 体积光管线。
//
// 设计要点（对齐 SkyCapability / GroundCapability 的能力模式）：
//   - 默认经典三点布光（key/fill/rim DirectionalLight）+ AmbientLight
//   - Spotlight 从对象正上方打下（聚光灯），cone + penumbra 可调
//   - 体积光锥：两交叉 PlaneGeometry + Cone 遮罩 shader（轻量，无 post-process 管线）
//   - 按模型类别预设（对齐 SkyCapability.setPreset 模式）
//   - 预留 setVolumetricEngine("cone" | "postprocess") 枚举，后续升级不动对外 API
//   - 本类不持有 backend 引用，纯 Three.js 侧逻辑
//   - target（对象中心）可动态更新，聚光灯 + 体积光锥随之重新定位

import * as THREE from "three";

/** 角度(度)→弧度；内联等价 THREE.MathUtils.degToRad，避免对 three 测试 mock 强依赖 MathUtils 导出 */
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** 递归 Partial：允许任意深度只传子集字段 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/* ============ 参数类型 ============ */

export interface DirectionalLightParams {
  enabled: boolean;
  color: number;
  intensity: number;
  /** 方位角（度，0=+X 东，90=+Z 南，180=-X 西，270=-Z 北；Y-up 坐标系） */
  azimuth: number;
  /** 仰角（度，0=水平，90=正上；负值=地面下） */
  elevation: number;
}

export interface AmbientLightParams {
  color: number;
  intensity: number;
}

export interface SpotlightParams {
  enabled: boolean;
  color: number;
  intensity: number;
  /** 锥角半角（度，越大越宽） */
  angle: number;
  /** 半影（0=硬边，1=全软边） */
  penumbra: number;
  /** 衰减距离 */
  distance: number;
  /** 衰减指数（0=无衰减，2=经典物理衰减） */
  decay: number;
}

export interface VolumetricParams {
  enabled: boolean;
  /** 最大透明度 */
  opacity: number;
  /** 空气散射幂次（越大衰减越陡，越集中底部） */
  fogPower: number;
  /** 边缘羽化（0=无，1=完全透明边缘） */
  edgeFade: number;
  /** 底部强度（光落在对象上） */
  baseStrength: number;
  /** 顶部强度（光源附近） */
  tipStrength: number;
}

export interface LightParams {
  key: DirectionalLightParams;
  fill: DirectionalLightParams;
  rim: DirectionalLightParams;
  ambient: AmbientLightParams;
  spotlight: SpotlightParams;
  volumetric: VolumetricParams;
}

/* ============ 默认值与预设 ============ */

const DEFAULT_KEY: DirectionalLightParams = {
  enabled: true, color: 0xffffff, intensity: 1.2, azimuth: 30, elevation: 45,
};
const DEFAULT_FILL: DirectionalLightParams = {
  enabled: true, color: 0xffffff, intensity: 0.4, azimuth: -30, elevation: 20,
};
const DEFAULT_RIM: DirectionalLightParams = {
  enabled: true, color: 0xffffff, intensity: 0.3, azimuth: 180, elevation: 25,
};
const DEFAULT_AMBIENT: AmbientLightParams = { color: 0xffffff, intensity: 0.5 };
const DEFAULT_SPOTLIGHT: SpotlightParams = {
  enabled: false, color: 0xffffff, intensity: 2.0, angle: 25, penumbra: 0.3, distance: 30, decay: 1.5,
};
const DEFAULT_VOLUMETRIC: VolumetricParams = {
  enabled: false, opacity: 0.45, fogPower: 1.5, edgeFade: 0.4, baseStrength: 0.9, tipStrength: 0.25,
};

export const DEFAULT_LIGHT_PARAMS: LightParams = {
  key: { ...DEFAULT_KEY },
  fill: { ...DEFAULT_FILL },
  rim: { ...DEFAULT_RIM },
  ambient: { ...DEFAULT_AMBIENT },
  spotlight: { ...DEFAULT_SPOTLIGHT },
  volumetric: { ...DEFAULT_VOLUMETRIC },
};

/** 模型类别预设（对齐 SkyCapability.MODEL_SKY_PRESETS 模式） */
export const LIGHT_PRESETS: Record<string, Partial<LightParams>> = {
  default: { spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false }, volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false } },
  ysm: {
    // 方块哑光，顶光稍柔
    key: { ...DEFAULT_KEY, intensity: 1.3 },
    fill: { ...DEFAULT_FILL, intensity: 0.5 },
    rim: { ...DEFAULT_RIM, intensity: 0.35 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.8, angle: 30, penumbra: 0.4 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.4, fogPower: 1.2 },
  },
  vrm: {
    // PBR 角色，rim 稍强勾勒轮廓
    key: { ...DEFAULT_KEY, intensity: 1.0 },
    fill: { ...DEFAULT_FILL, intensity: 0.5 },
    rim: { ...DEFAULT_RIM, intensity: 0.6 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.5, angle: 28 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  mmd: {
    // toon 材质易过曝，整体降 30%
    key: { ...DEFAULT_KEY, intensity: 0.85 },
    fill: { ...DEFAULT_FILL, intensity: 0.3 },
    rim: { ...DEFAULT_RIM, intensity: 0.25 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.4 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  litematic: {
    // 体素，均匀光照
    key: { ...DEFAULT_KEY, intensity: 1.0, azimuth: 45, elevation: 60 },
    fill: { ...DEFAULT_FILL, intensity: 0.4, azimuth: -45, elevation: 30 },
    rim: { ...DEFAULT_RIM, intensity: 0.3, azimuth: 135, elevation: 30 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false },
  },
  "resourcepack": {
    // MC 方块/物品，顶光稍柔（alias for pack-model 兼容 adapter.id）
    key: { ...DEFAULT_KEY, intensity: 1.3 },
    fill: { ...DEFAULT_FILL, intensity: 0.4 },
    rim: { ...DEFAULT_RIM, intensity: 0.35 },
    spotlight: { ...DEFAULT_SPOTLIGHT, enabled: false, intensity: 1.8, angle: 30 },
    volumetric: { ...DEFAULT_VOLUMETRIC, enabled: false, opacity: 0.4 },
  },
};

/* ============ 体积光锥 shader（两交叉 PlaneGeometry + Cone 遮罩） ============ */

const VOLUMETRIC_CONE_VERT = `
  varying float vY;
  varying float vX;
  varying float vZ;
  void main() {
    vY = position.y;
    vX = position.x;
    vZ = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUMETRIC_CONE_FRAG = `
  precision highp float;
  varying float vY;
  varying float vX;
  varying float vZ;
  uniform vec3 uColor;
  uniform float uMaxAlpha;
  uniform float uFogPower;
  uniform float uEdgeFade;
  uniform float uHeight;
  uniform float uBaseRadius;
  uniform float uTipStrength;
  uniform float uBaseStrength;

  void main() {
    // h = 0 底部（base），h = 1 顶部（tip）
    float h = (vY + uHeight * 0.5) / uHeight;
    // 当前高度处锥面半径：底部 uBaseRadius → 顶部 0
    float rAtH = uBaseRadius * (1.0 - h);
    float d = sqrt(vX * vX + vZ * vZ);
    if (d > rAtH) discard;
    if (rAtH < 0.0001) discard; // 锥顶退化为点，无内容可渲染

    // 垂直强度：底部与顶部之间的插值
    float vertIntensity = mix(uBaseStrength, uTipStrength, h);
    // 空气散射（fog）：指数衰减从底部到顶部
    float airFalloff = exp(-uFogPower * h);
    // 径向羽化：中心 → 1.0，边缘 → (1 - edgeFade)
    float rNorm = d / rAtH;
    float radialFalloff = 1.0 - rNorm * uEdgeFade;

    float alpha = uMaxAlpha * vertIntensity * airFalloff * radialFalloff;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

interface VolumetricConeUniforms {
  uColor: { value: THREE.Color };
  uMaxAlpha: { value: number };
  uFogPower: { value: number };
  uEdgeFade: { value: number };
  uHeight: { value: number };
  uBaseRadius: { value: number };
  uTipStrength: { value: number };
  uBaseStrength: { value: number };
}

/* ============ LightCapability ============ */

export class LightCapability {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private params: LightParams;
  private enabled: boolean;
  private target: THREE.Vector3; // 对象中心，聚光灯瞄准点
  private targetHeight: number;  // 聚光灯位于对象上方的高度

  // 灯光对象
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private spotlight: THREE.SpotLight;
  private spotlightTarget: THREE.Object3D; // 隐形目标，SpotLight 瞄准

  // 体积光锥
  private coneGroup: THREE.Group | null = null;
  private coneUniforms: VolumetricConeUniforms | null = null;
  private coneMaterial: THREE.ShaderMaterial | null = null;
  private coneHeight = 0;
  private coneRadius = 0;

  // 体积光锥引擎（预留：后续支持 postprocess 模式）
  private volumetricEngine: "cone" | "postprocess" = "cone";

  // ADR-085 S2：记录当前预设名，消灭 fillLighting 启发式派生
  private currentPreset: string = "default";

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: DeepPartial<LightParams>;
    enabled?: boolean;
    target?: THREE.Vector3;
    targetHeight?: number;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.params = deepMergeLightParams(DEFAULT_LIGHT_PARAMS, opts.params ?? {});
    this.enabled = opts.enabled ?? true;
    this.target = opts.target ?? new THREE.Vector3(0, 0, 0);
    this.targetHeight = opts.targetHeight ?? 8;

    this.keyLight = this.createDirectional(this.params.key);
    this.fillLight = this.createDirectional(this.params.fill);
    this.rimLight = this.createDirectional(this.params.rim);
    this.ambientLight = new THREE.AmbientLight(this.params.ambient.color, this.params.ambient.intensity);

    // 聚光灯：位于对象正上方，向下照射
    this.spotlight = new THREE.SpotLight(
      this.params.spotlight.color,
      this.params.spotlight.intensity,
      this.params.spotlight.distance,
      degToRad(this.params.spotlight.angle),
      this.params.spotlight.penumbra,
      this.params.spotlight.decay,
    );
    this.spotlight.position.set(
      this.target.x,
      this.target.y + this.targetHeight,
      this.target.z,
    );
    this.spotlightTarget = new THREE.Object3D();
    this.spotlightTarget.name = "ysm-light-spot-target";
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.target = this.spotlightTarget;

    // 初始化体积光锥几何（参数化，enable 时挂载）
    this.rebuildCone();
  }

  /* ----- 方向灯方向更新 ----- */

  private createDirectional(p: DirectionalLightParams): THREE.DirectionalLight {
    const dl = new THREE.DirectionalLight(p.color, p.intensity);
    dl.position.copy(this.dirToPosition(p, 5));
    return dl;
  }

  /** 方位角 + 仰角 → 3D 位置（radius 为单位长度，后续乘 intensity 相关） */
  private dirToPosition(p: DirectionalLightParams, radius: number): THREE.Vector3 {
    const az = degToRad(p.azimuth);
    const el = degToRad(p.elevation);
    const h = radius * Math.cos(el); // 水平分量
    const y = radius * Math.sin(el); // 垂直分量
    return new THREE.Vector3(h * Math.sin(az), y, h * Math.cos(az));
  }

  private updateDirectional(light: THREE.DirectionalLight, p: DirectionalLightParams): void {
    light.color.setHex(p.color);
    light.intensity = p.intensity;
    light.position.copy(this.dirToPosition(p, 5));
    light.visible = p.enabled;
  }

  /* ----- 体积光锥 ----- */

  /** 根据当前参数重建体积光锥几何 + 材质 */
  private rebuildCone(): void {
    this.disposeCone();

    const sp = this.params.spotlight;
    const vm = this.params.volumetric;
    if (!sp.enabled || !vm.enabled) return;

    // 锥高 = 从聚光灯到对象中心的距离（= targetHeight）
    const height = this.targetHeight;
    // 锥底半径 = 锥高 * tan(半角)
    const halfAngle = degToRad(sp.angle);
    const baseRadius = height * Math.tan(halfAngle) * (1.0 + sp.penumbra * 0.5);

    this.coneHeight = height;
    this.coneRadius = baseRadius;

    // 材质
    const uniforms: VolumetricConeUniforms = {
      uColor: { value: new THREE.Color(sp.color) },
      uMaxAlpha: { value: vm.opacity },
      uFogPower: { value: vm.fogPower },
      uEdgeFade: { value: vm.edgeFade },
      uHeight: { value: height },
      uBaseRadius: { value: baseRadius },
      uTipStrength: { value: vm.tipStrength },
      uBaseStrength: { value: vm.baseStrength },
    };
    this.coneUniforms = uniforms;

    this.coneMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as Record<string, THREE.IUniform<unknown>>,
      vertexShader: VOLUMETRIC_CONE_VERT,
      fragmentShader: VOLUMETRIC_CONE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    // 两交叉 PlaneGeometry：一个沿 XZ 平面，一个垂直
    const halfWidth = baseRadius;
    const geom = new THREE.PlaneGeometry(halfWidth * 2, height);

    const plane1 = new THREE.Mesh(geom, this.coneMaterial);
    const plane2 = new THREE.Mesh(geom, this.coneMaterial);
    plane2.rotation.y = Math.PI / 2;

    this.coneGroup = new THREE.Group();
    this.coneGroup.name = "ysm-light-volumetric-cone";
    this.coneGroup.add(plane1);
    this.coneGroup.add(plane2);

    // 锥组位置：尖端在聚光灯位置，底部在对象中心
    // PlaneGeometry 默认 Y=0 中心 → 需整体上移 height/2 使尖端在顶部
    this.coneGroup.position.copy(this.spotlight.position);
    this.coneGroup.position.y -= height / 2; // 让锥底在 target 高度，锥尖在 spotlight 高度
  }

  private disposeCone(): void {
    if (this.coneGroup) {
      if (this.coneGroup.parent) this.coneGroup.parent.remove(this.coneGroup);
      this.coneGroup.traverse((obj) => {
        const m = obj as THREE.Mesh;
        try { m.geometry?.dispose(); } catch {}
        const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((mt) => tryDisposeMat(mt));
          else tryDisposeMat(mat);
        }
      });
      this.coneGroup = null;
      this.coneUniforms = null;
      this.coneMaterial = null;
    }
  }

  private updateConeUniforms(): void {
    if (!this.coneUniforms || !this.coneMaterial) return;
    const sp = this.params.spotlight;
    const vm = this.params.volumetric;
    this.coneUniforms.uColor.value.setHex(sp.color);
    this.coneUniforms.uMaxAlpha.value = vm.opacity;
    this.coneUniforms.uFogPower.value = vm.fogPower;
    this.coneUniforms.uEdgeFade.value = vm.edgeFade;
    this.coneUniforms.uTipStrength.value = vm.tipStrength;
    this.coneUniforms.uBaseStrength.value = vm.baseStrength;
  }

  /* ----- 公共 API ----- */

  apply(): void {
    if (!this.enabled) { this.detach(); return; }
    if (!this.keyLight.parent) this.scene.add(this.keyLight);
    if (!this.fillLight.parent) this.scene.add(this.fillLight);
    if (!this.rimLight.parent) this.scene.add(this.rimLight);
    if (!this.ambientLight.parent) this.scene.add(this.ambientLight);
    if (!this.spotlightTarget.parent) this.scene.add(this.spotlightTarget);
    if (!this.spotlight.parent) this.scene.add(this.spotlight);
    if (this.params.volumetric.enabled && this.params.spotlight.enabled && this.coneGroup) {
      if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else this.detach();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setTarget(v: THREE.Vector3): void {
    this.target.copy(v);
    this.spotlightTarget.position.copy(this.target);
    this.spotlight.position.set(this.target.x, this.target.y + this.targetHeight, this.target.z);
    if (this.coneGroup) {
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    }
  }

  getTarget(): THREE.Vector3 {
    return this.target.clone();
  }

  setTargetHeight(h: number): void {
    this.targetHeight = h;
    this.spotlight.position.set(this.target.x, this.target.y + h, this.target.z);
    this.rebuildCone();
    if (this.coneGroup && this.scene.getObjectByName(this.coneGroup.name)) {
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    }
  }

  /** 按模型类别套用预设 */
  setPreset(modelType: string): void {
    const preset = LIGHT_PRESETS[modelType] ?? LIGHT_PRESETS.default;
    this.currentPreset = modelType; // ADR-085 S2：记录真实预设名
    this.params = deepMergeLightParams(this.params, preset);
    this.syncLightsFromParams();
    this.rebuildCone();
    if (this.coneGroup && this.coneGroup.parent) {
      // 若启用状态改变，需同步挂载/卸载
      if (!this.params.volumetric.enabled || !this.params.spotlight.enabled) {
        if (this.coneGroup.parent) this.coneGroup.parent.remove(this.coneGroup);
      } else if (!this.coneGroup.parent) {
        this.scene.add(this.coneGroup);
      }
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    }
  }

  /** 聚光灯参数更新 */
  setSpotlight(p: Partial<SpotlightParams>): void {
    Object.assign(this.params.spotlight, p);
    const sp = this.params.spotlight;
    this.spotlight.color.setHex(sp.color);
    this.spotlight.intensity = sp.intensity;
    this.spotlight.distance = sp.distance;
    this.spotlight.angle = degToRad(sp.angle);
    this.spotlight.penumbra = sp.penumbra;
    this.spotlight.decay = sp.decay;
    this.spotlight.visible = sp.enabled;
    this.rebuildCone();
    if (this.coneGroup && this.params.volumetric.enabled) {
      if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    }
  }

  /** 体积光锥参数更新（含 enable/disable 切换） */
  setVolumetric(p: Partial<VolumetricParams>): void {
    Object.assign(this.params.volumetric, p);
    this.updateConeUniforms();
    if (p.enabled !== undefined) {
      if (this.params.volumetric.enabled && this.params.spotlight.enabled && this.coneGroup) {
        if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
      } else {
        if (this.coneGroup?.parent) this.coneGroup.parent.remove(this.coneGroup);
      }
    }
  }

  /** 切换体积光锥引擎（预留：当前仅 "cone"） */
  setVolumetricEngine(engine: "cone" | "postprocess"): void {
    this.volumetricEngine = engine;
    // 当前仅支持 cone 模式；postprocess 模式下体积光锥暂不渲染（占位）
    if (engine === "postprocess" && this.coneGroup?.parent) {
      this.coneGroup.parent.remove(this.coneGroup);
    } else if (engine === "cone" && this.params.volumetric.enabled && this.params.spotlight.enabled) {
      this.rebuildCone();
      if (this.coneGroup && !this.coneGroup.parent) {
        this.scene.add(this.coneGroup);
        this.coneGroup.position.copy(this.spotlight.position);
        this.coneGroup.position.y -= this.coneHeight / 2;
      }
    }
  }

  getVolumetricEngine(): "cone" | "postprocess" {
    return this.volumetricEngine;
  }

  /** 合并式参数更新（只覆盖给定字段） */
  setParams(p: DeepPartial<LightParams>): void {
    this.params = deepMergeLightParams(this.params, p);
    this.syncLightsFromParams();
    this.rebuildCone();
    if (this.coneGroup && this.params.volumetric.enabled && this.params.spotlight.enabled) {
      if (!this.coneGroup.parent) this.scene.add(this.coneGroup);
      this.coneGroup.position.copy(this.spotlight.position);
      this.coneGroup.position.y -= this.coneHeight / 2;
    } else if (this.coneGroup?.parent) {
      this.coneGroup.parent.remove(this.coneGroup);
    }
  }

  getParams(): LightParams {
    return deepMergeLightParams(DEFAULT_LIGHT_PARAMS, this.params);
  }

  /** 当前预设名（ADR-085 S2：fillLighting 只读初始化，消灭启发式派生） */
  getCurrentPreset(): string {
    return this.currentPreset;
  }

  private syncLightsFromParams(): void {
    this.updateDirectional(this.keyLight, this.params.key);
    this.updateDirectional(this.fillLight, this.params.fill);
    this.updateDirectional(this.rimLight, this.params.rim);
    this.ambientLight.color.setHex(this.params.ambient.color);
    this.ambientLight.intensity = this.params.ambient.intensity;
    this.setSpotlight({ ...this.params.spotlight });
  }

  private detach(): void {
    [this.keyLight, this.fillLight, this.rimLight, this.ambientLight, this.spotlight, this.spotlightTarget].forEach((o) => {
      if (o.parent) o.parent.remove(o);
    });
    if (this.coneGroup?.parent) this.coneGroup.parent.remove(this.coneGroup);
  }

  dispose(): void {
    this.detach();
    this.disposeCone();
    this.keyLight.dispose();
    this.fillLight.dispose();
    this.rimLight.dispose();
    this.ambientLight.dispose();
    this.spotlight.dispose();
  }
}

/* ============ 工具函数 ============ */

function deepMergeLightParams(base: LightParams, override: DeepPartial<LightParams>): LightParams {
  const mergeDir = (a: DirectionalLightParams, b?: Partial<DirectionalLightParams>): DirectionalLightParams =>
    ({ ...a, ...b } as DirectionalLightParams);
  const mergeAmb = (a: AmbientLightParams, b?: Partial<AmbientLightParams>): AmbientLightParams =>
    ({ ...a, ...b } as AmbientLightParams);
  const mergeSpot = (a: SpotlightParams, b?: Partial<SpotlightParams>): SpotlightParams =>
    ({ ...a, ...b } as SpotlightParams);
  const mergeVol = (a: VolumetricParams, b?: Partial<VolumetricParams>): VolumetricParams =>
    ({ ...a, ...b } as VolumetricParams);

  return {
    key: mergeDir(base.key, override.key),
    fill: mergeDir(base.fill, override.fill),
    rim: mergeDir(base.rim, override.rim),
    ambient: mergeAmb(base.ambient, override.ambient),
    spotlight: mergeSpot(base.spotlight, override.spotlight),
    volumetric: mergeVol(base.volumetric, override.volumetric),
  };
}

function tryDisposeMat(m: THREE.Material): void {
  try {
    const mt = m as unknown as { map?: THREE.Texture };
    if (mt.map) mt.map.dispose();
    m.dispose();
  } catch {}
}