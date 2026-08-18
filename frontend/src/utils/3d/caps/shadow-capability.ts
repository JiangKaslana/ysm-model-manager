// ===== ShadowCapability：阴影能力（ADR-073 caps/ 能力模式）=====
// 复用 renderer.shadowMap + ShadowMaterial。
// 设计要点：
//   - 光 castShadow 由 LightCapability 的光实例决定；ShadowCapability
//     只做 renderer 侧开关 + ground shadow receiver + 阴影贴图尺寸/软边。
//   - ground 阴影接收：叠加一层 PlaneGeometry + ShadowMaterial（不破坏现有
//     GridHelper 的地面，ShadowMaterial 仅显示阴影、透明底色，两者叠加效果正确）。
//   - dispose 还原 renderer.shadowMap 设置与 renderer.domElement 的 prev 状态。

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export interface ShadowParams {
  enabled: boolean;
  /** PCFSoft / Basic / PCF / VSM；默认 PCFSoft（软边最自然） */
  type: "basic" | "pcf" | "pcfsoft" | "vsm";
  /** 方向光阴影贴图尺寸（512~4096；越大越精细但开销更高） */
  mapSize: number;
  /** 方向光阴影相机范围（正方形半边长；越大覆盖越广但分辨率越稀释） */
  cameraRange: number;
  /** 方向光阴影相机 near */
  cameraNear: number;
  /** 方向光阴影相机 far */
  cameraFar: number;
  /** 阴影偏移（解决痤疮；负值稍大减少自阴影） */
  bias: number;
  /** 法线偏移 */
  normalBias: number;
  /** 阴影接收地面平面尺寸（世界单位；对齐 GroundCapability 默认 50 可覆盖小场景，调大适配大模型） */
  groundSize: number;
  /** 阴影平面的 Y 高度（默认 0，与 GridHelper 对齐） */
  groundY: number;
}

const THREE_SHADOW_TYPE: Record<ShadowParams["type"], THREE.ShadowMapType> = {
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  pcfsoft: THREE.PCFSoftShadowMap,
  vsm: THREE.VSMShadowMap,
};

export const DEFAULT_SHADOW_PARAMS: ShadowParams = {
  enabled: false,
  type: "pcfsoft",
  mapSize: 2048,
  cameraRange: 20,
  cameraNear: 0.1,
  cameraFar: 200,
  bias: -0.0005,
  normalBias: 0.02,
  groundSize: 100,
  groundY: 0,
};

/** 模型类别阴影预设 */
export const SHADOW_PRESETS: Record<string, Partial<ShadowParams>> = {
  default: { ...DEFAULT_SHADOW_PARAMS },
  ysm: {
    // 方块：硬边阴影即可，尺寸可小省算力
    type: "pcf", mapSize: 1024, cameraRange: 40, groundSize: 200, bias: -0.001,
  },
  vrm: {
    // PBR 角色：PCFSoft 柔和边缘
    type: "pcfsoft", mapSize: 2048, cameraRange: 15, groundSize: 50, bias: -0.0005, normalBias: 0.02,
  },
  mmd: {
    // toon：软阴影更搭
    type: "pcfsoft", mapSize: 2048, cameraRange: 18, groundSize: 60, bias: -0.0003,
  },
  litematic: {
    // 体素：大场景，PCF 足够
    type: "pcf", mapSize: 2048, cameraRange: 100, groundSize: 500, bias: -0.001,
  },
  resourcepack: {
    // MC 方块：同 YSM
    type: "pcf", mapSize: 1024, cameraRange: 40, groundSize: 200, bias: -0.001,
  },
};

export class ShadowCapability implements SceneCapability {
  readonly id = "shadow";
  readonly labelKey = "preview.shadow";
  readonly icon = "🪞";
  readonly descKey = "preview.shadowDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private params: ShadowParams;
  private enabled: boolean;

  // 构造前 renderer 设置，dispose 时还原
  private prevShadowMapEnabled: boolean;
  private prevShadowMapType: THREE.ShadowMapType;

  // 阴影接收地面（ShadowMaterial 平面）
  private groundMesh: THREE.Mesh | null = null;
  private groundMat: THREE.ShadowMaterial | null = null;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<ShadowParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.params = { ...DEFAULT_SHADOW_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;

    this.prevShadowMapEnabled = this.renderer.shadowMap.enabled;
    this.prevShadowMapType = this.renderer.shadowMap.type;
  }

  /* -------- 内部：应用阴影设置 -------- */

  private applyShadowMap(): void {
    this.renderer.shadowMap.enabled = this.enabled;
    this.renderer.shadowMap.type = THREE_SHADOW_TYPE[this.params.type];
    // shadowMap.needsUpdate 在光侧设置后 Three 自动触发；此处不强刷
  }

  private buildGround(): void {
    this.disposeGround();
    if (!this.enabled) return;

    this.groundMat = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: 0.4,
    });
    const geom = new THREE.PlaneGeometry(this.params.groundSize, this.params.groundSize);
    geom.rotateX(-Math.PI / 2);
    this.groundMesh = new THREE.Mesh(geom, this.groundMat);
    this.groundMesh.receiveShadow = true;
    this.groundMesh.position.y = this.params.groundY;
    this.groundMesh.name = "ysm-shadow-ground";
    this.scene.add(this.groundMesh);
  }

  private disposeGround(): void {
    if (this.groundMesh) {
      if (this.groundMesh.parent) this.groundMesh.parent.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      this.groundMesh = null;
    }
    if (this.groundMat) {
      this.groundMat.dispose();
      this.groundMat = null;
    }
  }

  /** 把 DirectionalLight / SpotLight 设置 castShadow + 阴影相机参数。
   *  由 mount-preview-core 在 LightCapability 创建完成后调用（也可手动调）。
   *  传入光对象列表，避免 ShadowCapability 耦合 LightCapability。 */
  syncLights(lights: Array<THREE.DirectionalLight | THREE.SpotLight>): void {
    const range = this.params.cameraRange;
    for (const light of lights) {
      light.castShadow = this.enabled;
      if (!light.shadow) continue;
      const mapSize = Math.max(256, Math.min(4096, this.params.mapSize));
      light.shadow.mapSize.set(mapSize, mapSize);
      light.shadow.bias = this.params.bias;
      light.shadow.normalBias = this.params.normalBias;
      if (light instanceof THREE.DirectionalLight && light.shadow.camera) {
        const cam = light.shadow.camera as THREE.OrthographicCamera;
        cam.left = -range; cam.right = range;
        cam.top = range; cam.bottom = -range;
        cam.near = this.params.cameraNear;
        cam.far = this.params.cameraFar;
        cam.updateProjectionMatrix();
      } else if (light instanceof THREE.SpotLight && light.shadow.camera) {
        const cam = light.shadow.camera as THREE.PerspectiveCamera;
        cam.near = this.params.cameraNear;
        cam.far = this.params.cameraFar;
        cam.updateProjectionMatrix();
      }
      light.shadow.needsUpdate = true;
    }
  }

  /* -------- 公共 API -------- */

  /** 场景中已有模型 mesh 统一 castShadow。
   *  由适配器 build 完成后调用（或 switchTo 后新模型注册完调用）。 */
  applyMeshCasts(roots: THREE.Object3D[]): void {
    for (const root of roots) {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = this.enabled;
          // receiveShadow 对模型自阴影也开启，观感更真实（稍耗性能）
          m.receiveShadow = this.enabled;
        }
      });
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    this.applyShadowMap();
    if (v) this.buildGround();
    else this.disposeGround();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setPreset(modelType: string): void {
    const preset = SHADOW_PRESETS[modelType] ?? SHADOW_PRESETS.default;
    this.params = { ...this.params, ...preset };
    this.applyShadowMap();
    if (this.enabled) this.buildGround();
  }

  setType(t: ShadowParams["type"]): void {
    this.params.type = t;
    this.applyShadowMap();
  }

  setMapSize(v: number): void {
    this.params.mapSize = v;
    this.applyShadowMap();
  }

  setCameraRange(v: number): void {
    this.params.cameraRange = v;
    this.applyShadowMap();
  }

  setBias(v: number): void {
    this.params.bias = v;
  }

  setNormalBias(v: number): void {
    this.params.normalBias = v;
  }

  setGroundSize(v: number): void {
    this.params.groundSize = v;
    if (this.enabled) this.buildGround();
  }

  /** 调整阴影平面位置（Y 高度），用于模型底部不是 0 的场景 */
  setGroundY(v: number): void {
    this.params.groundY = v;
    if (this.groundMesh) this.groundMesh.position.y = v;
  }

  /** 阴影透明度（ShadowMaterial.opacity） */
  setOpacity(v: number): void {
    if (this.groundMat) this.groundMat.opacity = Math.max(0, Math.min(1, v));
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  getMenuControls(): MenuControlDef[] {
    return [
      {
        id: "shadow-enabled",
        kind: "toggle",
        labelKey: "preview.shadow",
        fallback: "阴影",
        getValue: () => this.isEnabled(),
        setValue: (v) => this.setEnabled(v as boolean),
      },
      {
        id: "shadow-type",
        kind: "select",
        labelKey: "preview.shadowType",
        fallback: "阴影类型",
        select: [
          { value: "basic", label: "硬边 (Basic)" },
          { value: "pcf", label: "PCF" },
          { value: "pcfsoft", label: "软边 (PCFSoft)" },
          { value: "vsm", label: "VSM" },
        ],
        getValue: () => this.params.type,
        setValue: (v) => this.setType(v as ShadowParams["type"]),
      },
      {
        id: "shadow-mapSize",
        kind: "slider",
        labelKey: "preview.shadowMapSize",
        fallback: "阴影精度",
        slider: { min: 512, max: 4096, step: 256 },
        getValue: () => this.params.mapSize,
        setValue: (v) => this.setMapSize(v as number),
      },
      {
        id: "shadow-range",
        kind: "slider",
        labelKey: "preview.shadowRange",
        fallback: "阴影范围",
        slider: { min: 5, max: 200, step: 1 },
        getValue: () => this.params.cameraRange,
        setValue: (v) => this.setCameraRange(v as number),
      },
    ];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      type: this.params.type,
      mapSize: this.params.mapSize,
      cameraRange: this.params.cameraRange,
      bias: this.params.bias,
      normalBias: this.params.normalBias,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (state.type === "basic" || state.type === "pcf" || state.type === "pcfsoft" || state.type === "vsm") {
      this.params.type = state.type;
    }
    if (typeof state.mapSize === "number") this.params.mapSize = state.mapSize;
    if (typeof state.cameraRange === "number") this.params.cameraRange = state.cameraRange;
    if (typeof state.bias === "number") this.params.bias = state.bias;
    if (typeof state.normalBias === "number") this.params.normalBias = state.normalBias;
    this.applyShadowMap();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.applyShadowMap();
    if (this.enabled) this.buildGround();
  }

  dispose(): void {
    this.disposeGround();
    this.renderer.shadowMap.enabled = this.prevShadowMapEnabled;
    this.renderer.shadowMap.type = this.prevShadowMapType;
  }
}
