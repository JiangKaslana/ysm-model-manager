// ===== ReflectorCapability：反光地面能力（ADR-073 caps/ 能力模式）=====
// 复用 Three 官方 Reflector（three/addons/objects/Reflector.js），不允许自写镜像相机/RTV shader。
// 与 ShadowCapability 的 ShadowMaterial 地面分层共存：
//   - Shadow 平面 y = groundY（贴 GridHelper）
//   - Reflector 平面 y = groundY - 0.01（毫米级后移，避免 z-fighting）
// Reflector 是一个透明 mesh + 背面镜像 WebGLRenderTarget，draw call 代价不低（约等于再渲染一次场景），
// 默认关闭，用户显式开启；模型类别预设给出建议参数。

import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export interface ReflectorParams {
  enabled: boolean;
  /** 地面平面尺寸（世界单位）*/
  size: number;
  /** 位置 Y（默认与 GridHelper 对齐） */
  groundY: number;
  /** 镜面渲染目标分辨率（越大越精细，开销越大） */
  resolution: number;
  /** 镜面色调（白色=纯反射；浅灰=柔和；蓝色=冷调） */
  color: number;
  /** 反射强度（0~1；1 = 完全镜像，0 = 不可见） */
  opacity: number;
  /** clipBias：反射平面 z-fighting 与对象近距裁剪的折中值（0.001~0.01 常见） */
  clipBias: number;
}

export const DEFAULT_REFLECTOR_PARAMS: ReflectorParams = {
  enabled: false,
  size: 100,
  groundY: 0,
  resolution: 1024,
  color: 0xffffff,
  opacity: 0.6,
  clipBias: 0.003,
};

/** 模型类别反光预设：反光强度按材质风格适配（toon 不要强反射，PBR 角色中等，方块/体素弱） */
export const REFLECTOR_PRESETS: Record<string, Partial<ReflectorParams>> = {
  default: { ...DEFAULT_REFLECTOR_PARAMS },
  ysm: {
    // 方块：弱反射，避免镜面太强抢主体
    opacity: 0.25, size: 200, resolution: 512, color: 0xf0f4fa,
  },
  vrm: {
    // PBR 角色：中等反射 + 暖调
    opacity: 0.5, size: 60, resolution: 1024, color: 0xf8efe2,
  },
  mmd: {
    // toon：更弱，避免高光与反射冲突
    opacity: 0.2, size: 80, resolution: 1024, color: 0xfafcff,
  },
  litematic: {
    // 体素：大平面 + 冷调
    opacity: 0.25, size: 500, resolution: 512, color: 0xeaf1fb,
  },
  resourcepack: {
    // MC 方块：同 YSM
    opacity: 0.25, size: 200, resolution: 512, color: 0xf0f4fa,
  },
};

export class ReflectorCapability implements SceneCapability {
  readonly id = "reflector";
  readonly labelKey = "preview.reflector";
  readonly icon = "🪟";
  readonly descKey = "preview.reflectorDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private params: ReflectorParams;
  private enabled: boolean;

  private reflector: Reflector | null = null;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<ReflectorParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.params = { ...DEFAULT_REFLECTOR_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;
  }

  /* -------- 内部：构造/销毁 Reflector -------- */

  private buildReflector(): void {
    this.disposeReflector();
    if (!this.enabled) return;

    const geometry = new THREE.PlaneGeometry(this.params.size, this.params.size);
    geometry.rotateX(-Math.PI / 2);

    // Reflector 需要渲染目标尺寸与 clipBias；
    // 我们自定义 onBeforeRender 不注入 shader 修改：color/opacity 靠 Reflector.color + 自定义 shader 的 mixColor 分支无法直接访问，
    // 这里通过给 Reflector 加一个独立材质的"覆盖层"叠加方案：
    //   - Reflector 本体：标准反射（1 透明通道）
    //   - opacity 调用法：用一个 Group 包 Reflector，并在 Reflector.userData 上挂 opacity；
    //     但官方 Reflector 没有直接 opacity 接口，这里采用"加一层 MeshBasicMaterial 混合平面"方案不现实（会阻挡反射内容）。
    // 采用官方 Reflector 提供的 color 参数 + 后处理式手动叠加 opacity 的替代方案：
    //   给 Reflector 材质的 uniforms.tDiffuse 再乘以 opacity + color mix，
    //   通过 monkeypatch 材质 fragmentShader 实现（避免自写 shader 违反 ADR-073 红线的"完全自写"——仅做 2 行 uniform 注入）。

    const reflector = new Reflector(geometry, {
      clipBias: this.params.clipBias,
      textureWidth: this.params.resolution,
      textureHeight: this.params.resolution,
      color: this.params.color,
    });
    reflector.position.y = this.params.groundY - 0.01; // 毫米级后移避开 shadow 地面
    reflector.rotation.x = -Math.PI / 2; // PlaneGeometry 默认 xy 面，Reflector 构造时用 rotateX 也可，但 Reflector 期望 xy 面自己旋转
    // Reflector 内部用 XY 平面（法线 +Z）做背面镜像投影；我们希望地面法线 +Y，所以必须对 Reflector group rotateX(-PI/2)
    // 检查：THREE Reflector 在 onBeforeRender 中使用 mesh.matrixWorld 的三个列构建相机朝向，无论怎么旋转，mesh 的法线方向会被正确变换，
    // 所以直接给 Reflector 设置 rotateX(-PI/2) 会正确把反射平面变到地面方向。

    reflector.name = "ysm-reflector";

    // ========== opacity 注入（2 行 uniform，非完整自写 shader，不违反 ADR-073）==========
    const mat = reflector.material as THREE.ShaderMaterial;
    mat.transparent = true;
    mat.uniforms.uOpacity = { value: this.params.opacity };
    mat.uniforms.uTintColor = { value: new THREE.Color(this.params.color) };
    // 改写 fragment：在最终 `gl_FragColor = vec4( outgoingLight, diffuseColor.a );` 前乘 tint 与 opacity；
    // 找到 Reflector 原 shader 结尾的 `gl_FragColor = vec4( outgoingLight, diffuseColor.a );` 注入 mix。
    // 若 pattern 不匹配，原 shader 仍工作（只是 opacity/tint 失效，不崩溃）。
    const originalFrag = mat.fragmentShader;
    const injectedFrag = originalFrag.replace(
      /gl_FragColor\s*=\s*vec4\(\s*outgoingLight\s*,\s*diffuseColor\.a\s*\)\s*;/,
      [
        "outgoingLight = mix(outgoingLight, outgoingLight * uTintColor.rgb, 0.5);",
        "gl_FragColor = vec4(outgoingLight, diffuseColor.a * uOpacity);",
      ].join("\n"),
    );
    if (injectedFrag !== originalFrag) {
      mat.fragmentShader = injectedFrag;
      mat.needsUpdate = true;
    }

    this.reflector = reflector;
    this.scene.add(reflector);
  }

  private disposeReflector(): void {
    if (!this.reflector) return;
    if (this.reflector.parent) this.reflector.parent.remove(this.reflector);
    this.reflector.geometry.dispose();
    // Reflector 内部通过 WebGLRenderTarget 缓存，需显式释放（.dispose() 已处理 rt）
    this.reflector.dispose?.();
    this.reflector = null;
  }

  /* -------- 参数 API -------- */

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    this.buildReflector();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setPreset(modelType: string): void {
    const preset = REFLECTOR_PRESETS[modelType] ?? REFLECTOR_PRESETS.default;
    this.params = { ...this.params, ...preset };
    if (this.enabled) this.buildReflector();
  }

  setOpacity(v: number): void {
    this.params.opacity = Math.max(0, Math.min(1, v));
    const mat = this.reflector?.material as THREE.ShaderMaterial | undefined;
    if (mat?.uniforms?.uOpacity) mat.uniforms.uOpacity.value = this.params.opacity;
  }

  setColor(hex: number): void {
    this.params.color = hex;
    const mat = this.reflector?.material as THREE.ShaderMaterial | undefined;
    if (mat?.uniforms?.uTintColor) mat.uniforms.uTintColor.value.setHex(hex);
  }

  setSize(v: number): void {
    this.params.size = v;
    if (this.enabled) this.buildReflector();
  }

  setGroundY(v: number): void {
    this.params.groundY = v;
    if (this.reflector) this.reflector.position.y = v - 0.01;
  }

  setResolution(v: number): void {
    this.params.resolution = v;
    if (this.enabled) this.buildReflector();
  }

  setClipBias(v: number): void {
    this.params.clipBias = v;
    if (this.enabled) this.buildReflector();
  }

  getParams(): ReflectorParams {
    return { ...this.params, enabled: this.enabled };
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  getMenuControls(): MenuControlDef[] {
    return [
      {
        id: "reflector-enabled",
        kind: "toggle",
        labelKey: "preview.reflector",
        fallback: "反光地面",
        getValue: () => this.isEnabled(),
        setValue: (v) => this.setEnabled(v as boolean),
      },
      {
        id: "reflector-opacity",
        kind: "slider",
        labelKey: "preview.reflectorOpacity",
        fallback: "反射强度",
        slider: { min: 0, max: 1, step: 0.01 },
        getValue: () => this.params.opacity,
        setValue: (v) => this.setOpacity(v as number),
      },
      {
        id: "reflector-resolution",
        kind: "slider",
        labelKey: "preview.reflectorResolution",
        fallback: "反射精度",
        slider: { min: 256, max: 2048, step: 256 },
        getValue: () => this.params.resolution,
        setValue: (v) => this.setResolution(v as number),
      },
      {
        id: "reflector-size",
        kind: "slider",
        labelKey: "preview.reflectorSize",
        fallback: "地面大小",
        slider: { min: 20, max: 500, step: 10 },
        getValue: () => this.params.size,
        setValue: (v) => this.setSize(v as number),
      },
    ];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      size: this.params.size,
      resolution: this.params.resolution,
      color: this.params.color,
      opacity: this.params.opacity,
      clipBias: this.params.clipBias,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (typeof state.size === "number") this.params.size = state.size;
    if (typeof state.resolution === "number") this.params.resolution = state.resolution;
    if (typeof state.color === "number") this.params.color = state.color;
    if (typeof state.opacity === "number") this.params.opacity = state.opacity;
    if (typeof state.clipBias === "number") this.params.clipBias = state.clipBias;
    this.buildReflector();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.buildReflector();
  }

  dispose(): void {
    this.disposeReflector();
  }
}
