// ===== 场景能力统一接口（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow/Reflection 等）实现本接口，
// 由 scene-capability-registry 自动发现并注入菜单，新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在 registry.add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。

import type * as THREE from "three";

/* ============ 菜单控件定义 ============ */

/** 单个菜单控件类型 */
export type MenuControlKind = "toggle" | "slider" | "select" | "divider";

/** 菜单控件定义（声明式，由框架渲染为 DOM） */
export interface MenuControlDef {
  /** 稳定 id（用于持久化 key） */
  id: string;
  /** 控件类型 */
  kind: MenuControlKind;
  /** i18n 标签键 */
  labelKey: string;
  /** i18n 回退文案 */
  fallback: string;
  /** slider 配置 */
  slider?: {
    min: number;
    max: number;
    step: number;
    unit?: string;
  };
  /** select 配置 */
  select?: Array<{ value: string; label: string }>;
  /** 读取当前值（框架调用，渲染初始状态） */
  getValue: () => number | string | boolean;
  /** 设置值（框架调用，用户交互时触发） */
  setValue: (v: number | string | boolean) => void;
}

/* ============ 场景能力统一接口 ============ */

export interface SceneCapability {
  /** 唯一标识（如 "sky" / "ground" / "light" / "fog"） */
  readonly id: string;

  /** 显示名称 i18n 键 */
  readonly labelKey: string;

  /** 图标（emoji） */
  readonly icon: string;

  /** 能力描述 i18n 键 */
  readonly descKey: string;

  /** 挂入场景（constructor 后调用） */
  apply(): void;

  /** 释放资源（会话结束时调用） */
  dispose(): void;

  /** 启用/禁用 */
  setEnabled(v: boolean): void;
  isEnabled(): boolean;

  /** 按模型类别套用预设（可选，无预设的能力忽略） */
  setPreset?(modelType: string): void;

  /** 返回菜单控件定义列表（框架自动渲染为 slide panel） */
  getMenuControls(): MenuControlDef[];

  /** 持久化：保存当前状态到 localStorage */
  saveState(): void;

  /** 持久化：从 localStorage 恢复状态（构造后、apply 前调用） */
  loadState(): void;
}

/* ============ 注册表 ============ */

/** 能力工厂：接收 scene/renderer，返回能力实例 */
export type SceneCapabilityFactory = (ctx: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}) => SceneCapability;

class SceneCapabilityRegistry {
  private factories = new Map<string, SceneCapabilityFactory>();

  /** 注册能力工厂 */
  add(factory: SceneCapabilityFactory): void {
    // 用一个临时调用获取 id（工厂必须在首次调用时返回正确 id）
    // 这里只存工厂，实际 id 在 create 时获取
    this.factories.set("__pending__" + this.factories.size, factory);
  }

  /** 创建所有已注册能力 */
  createAll(ctx: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
  }): SceneCapability[] {
    const caps: SceneCapability[] = [];
    for (const factory of this.factories.values()) {
      try {
        const cap = factory(ctx);
        caps.push(cap);
      } catch (e) {
        console.warn("[scene-cap] 能力创建失败:", e);
      }
    }
    return caps;
  }

  /** 获取所有已注册能力的工厂（用于检查） */
  getFactories(): SceneCapabilityFactory[] {
    return [...this.factories.values()];
  }
}

/** 全局单例（ADR-066 同模式：模块级单例 + 运行时状态隔离） */
export const sceneCapabilityRegistry = new SceneCapabilityRegistry();

/* ============ 持久化工具 ============ */

const STORAGE_PREFIX = "ysm-scene-cap-";

/** 安全读取（隐私模式降级 null） */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 安全写入（隐私模式降级静默） */
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 静默
  }
}

/** 保存 JSON 到 localStorage */
export function persistState(capId: string, state: Record<string, unknown>): void {
  safeSet(STORAGE_PREFIX + capId, JSON.stringify(state));
}

/** 从 localStorage 加载 JSON */
export function restoreState(capId: string): Record<string, unknown> | null {
  const raw = safeGet(STORAGE_PREFIX + capId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
