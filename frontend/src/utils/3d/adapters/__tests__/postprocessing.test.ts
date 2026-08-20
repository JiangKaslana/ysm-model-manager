// @vitest-environment node
// ===== PostprocessingManager 测试（借测试反推源码问题）=====
// 覆盖：构造 / render 分支 / setSize / dispose 后行为 / 开关交替 / 极端参数。
// 每条测试刻意构造边界条件；发现的源码问题在注释中标注 // BUG。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { PostprocessingManager } from "../postprocessing.ts";
import type { LightCapability } from "../../caps/light-capability.ts";

// ── 全局模拟（@vitest-environment node 无 window/document） ─────────
Object.defineProperty(globalThis, "window", {
  value: { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  writable: true,
  configurable: true,
});

// ── 顶层 mock：Three.js post-processing 模块（避免真实 GPU 依赖） ───
vi.mock("three/examples/jsm/postprocessing/EffectComposer.js", () => {
  class FakeEffectComposer {
    public passes: any[] = [];
    public width = 0;
    public height = 0;
    constructor(public renderer: THREE.WebGLRenderer) {}
    setSize(w: number, h: number) { this.width = w; this.height = h; }
    setPixelRatio(r: number) { this._pixelRatio = r; }
    addPass(pass: any) { this.passes.push(pass); }
    render(dt: number) { this._lastDeltatime = dt; }
    dispose() {
      for (const p of this.passes) p.dispose?.();
      this.passes.length = 0;
    }
    _pixelRatio = 1;
    _lastDeltatime = 0;
  }
  return { EffectComposer: FakeEffectComposer };
});

vi.mock("three/examples/jsm/postprocessing/RenderPass.js", () => {
  class FakeRenderPass {
    constructor(public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {}
    dispose() { this._disposed = true; }
    _disposed = false;
  }
  return { RenderPass: FakeRenderPass };
});

vi.mock("three/examples/jsm/postprocessing/UnrealBloomPass.js", () => {
  class FakeUnrealBloomPass {
    threshold = 0;
    strength = 0;
    radius = 0;
    resolution: THREE.Vector2;
    constructor(res: THREE.Vector2, t: number, s: number, r: number) {
      this.resolution = res.clone();
      this.threshold = t;
      this.strength = s;
      this.radius = r;
    }
    dispose() { this._disposed = true; }
    _disposed = false;
  }
  return { UnrealBloomPass: FakeUnrealBloomPass };
});

vi.mock("three/examples/jsm/postprocessing/OutputPass.js", () => {
  // OutputPass 在 Three.js 中通常没有 dispose 方法
  class FakeOutputPass {
    constructor() {}
    // 故意不提供 dispose，模拟真实 OutputPass
  }
  return { OutputPass: FakeOutputPass };
});

// ── 工具：构造 fake renderer / scene / camera ──────────────────────
function fakeDomElement(w = 800, h = 600): any {
  return { width: w, height: h, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

function fakeRenderer(w = 800, h = 600): THREE.WebGLRenderer {
  const el = fakeDomElement(w, h);
  return {
    domElement: el,
    setSize: vi.fn(),
    getPixelRatio: () => 1,
    dispose: vi.fn(),
    getContext: vi.fn(() => null),
  } as unknown as THREE.WebGLRenderer;
}

function fakeScene(): THREE.Scene { return new THREE.Scene(); }
function fakeCamera(): THREE.PerspectiveCamera { return new THREE.PerspectiveCamera(); }

// ── 工具：构造 LightCapability mock ───────────────────────────────
function makeLightCap(overrides: {
  engine?: "cone" | "postprocess";
  volumetric?: { enabled: boolean; opacity: number; edgeFade: number };
} = {}): LightCapability {
  return {
    getVolumetricEngine: () => overrides.engine ?? "cone",
    getParams: () => ({
      volumetric: {
        enabled: true,
        opacity: 0.5,
        edgeFade: 0.5,
        ...(overrides.volumetric ?? {}),
      },
      _test: true,
    }),
  } as unknown as LightCapability;
}

// ── 类型断言辅助：访问内部 mock 属性 ─────────────────────────────
type MockedComposer = any & {
  width: number; height: number; passes: any[];
  setSize: (w: number, h: number) => void;
  setPixelRatio: (r: number) => void;
  addPass: (p: any) => void;
  render: (dt: number) => void;
  dispose: () => void;
};

describe("PostprocessingManager", () => {
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let mgr: PostprocessingManager;

  beforeEach(() => {
    renderer = fakeRenderer();
    scene = fakeScene();
    camera = fakeCamera();
    mgr = new PostprocessingManager(renderer, scene, camera);
  });

  // ════════════════════════════════════════════════════════════════
  // 1. 构造阶段
  // ════════════════════════════════════════════════════════════════

  it("构造：不传参数直接 new", () => {
    // 类型层禁止未传参；此处验证构造器是否做了防御
    expect(() => new PostprocessingManager(renderer, scene, camera)).not.toThrow();
  });

  it("构造：传入 null 参数不会立即报错", () => {
    // // BUG: 构造器不做任何参数校验，null 传入后仅在首次 render 时抛错
    expect(() => new PostprocessingManager(
      null as any, null as any, null as any
    )).not.toThrow();
  });

  it("构造：传入 undefined 参数不会立即报错", () => {
    // // BUG: 同上，undefined 也会被接受
    expect(() => new PostprocessingManager(
      undefined as any, undefined as any, undefined as any
    )).not.toThrow();
  });

  // ════════════════════════════════════════════════════════════════
  // 2. render() 正常路径
  // ════════════════════════════════════════════════════════════════

  it("render：volumetric=postprocess 且 enabled → 延迟创建 composer 并接管渲染", () => {
    const lightCap = makeLightCap({ engine: "postprocess" });
    const result = mgr.render(0.016, lightCap);
    expect(result).toBe(true);
    const c = (mgr as any).composer;
    expect(c).toBeTruthy();
    expect(c.passes.length).toBe(3); // RenderPass + UnrealBloomPass + OutputPass
    expect(c.width).toBe(800);
    expect(c.height).toBe(600);
    expect(c._lastDeltatime).toBe(0.016);
  });

  it("render：volumetric=cone → 不创建 composer，返回 false", () => {
    const lightCap = makeLightCap({ engine: "cone" });
    const result = mgr.render(0.016, lightCap);
    expect(result).toBe(false);
    expect((mgr as any).composer).toBeNull();
  });

  it("render：lightCap=null → 不创建 composer", () => {
    const result = mgr.render(0.016, null);
    expect(result).toBe(false);
    expect((mgr as any).composer).toBeNull();
  });

  it("render：volumetric.enabled=false → 不创建 composer", () => {
    const lightCap = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: false, opacity: 0, edgeFade: 0 },
    });
    const result = mgr.render(0.016, lightCap);
    expect(result).toBe(false);
    expect((mgr as any).composer).toBeNull();
  });

  // ════════════════════════════════════════════════════════════════
  // 3. render() 开关交替
  // ════════════════════════════════════════════════════════════════

  it("render：开关交替切换 → 每次启用都重新创建 passes（但 dispose 会因 OutputPass 无 dispose 而崩溃）", () => {
    // // BUG (P0): disposeComposer 调用 this.outputPass?.dispose()，但 Three.js OutputPass 没有 dispose 方法
    // ?. 只保护 null/undefined，无法保护"对象存在但方法不存在"——直接 TypeError 崩溃
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp); // 创建 composer
    // 切换到 cone 触发 dispose → 崩溃
    (lp as any).getVolumetricEngine = () => "cone";
    expect(() => mgr.render(2, lp)).toThrow(/outputPass.*dispose/);
  });

  it("render：重复调用（同状态）→ 不重复创建 composer", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const first = (mgr as any).composer;
    mgr.render(2, lp);
    expect((mgr as any).composer).toBe(first); // 同一实例
  });

  // ════════════════════════════════════════════════════════════════
  // 4. setSize
  // ════════════════════════════════════════════════════════════════

  it("setSize：composer 已创建 → 更新 composer 和 bloomPass 尺寸", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    mgr.setSize(1920, 1080);
    const c = (mgr as any).composer;
    expect(c.width).toBe(1920);
    expect(c.height).toBe(1080);
    expect((mgr as any).bloomPass.resolution.x).toBe(1920);
    expect((mgr as any).bloomPass.resolution.y).toBe(1080);
  });

  it("setSize：composer 未创建（首次调用前）→ 静默忽略", () => {
    // // BUG: setSize 在 composer 未创建时静默 no-op，不会报错也不会缓存尺寸
    mgr.setSize(1920, 1080);
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c.width).toBe(800); // 仍是 domElement 尺寸，setSize 被忽略
    expect(c.height).toBe(600);
  });

  it("setSize：传入 0 → 无保护地传给 EffectComposer", () => {
    // // BUG: setSize 不像 render 那样 clamp 到 1，0 会直接传给 setSize
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    expect(() => mgr.setSize(0, 0)).not.toThrow();
    const c = (mgr as any).composer;
    expect(c.width).toBe(0); // 已接受 0，真实 EffectComposer.setSize 可能出错
    expect(c.height).toBe(0);
  });

  it("setSize：传入负数 → 无保护地传入", () => {
    // // BUG: 同上，负数也通过
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    expect(() => mgr.setSize(-100, -100)).not.toThrow();
    const c = (mgr as any).composer;
    expect(c.width).toBe(-100);
    expect(c.height).toBe(-100);
  });

  it("setSize：传入 Infinity / NaN → 无保护地传入", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    expect(() => mgr.setSize(Infinity, NaN)).not.toThrow();
    const c = (mgr as any).composer;
    expect(c.width).toBe(Infinity);
    expect(Number.isNaN(c.height)).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════
  // 5. dispose
  // ════════════════════════════════════════════════════════════════

  it("dispose：调用后崩溃（OutputPass 无 dispose 方法）", () => {
    // // BUG (P0): disposeComposer 中 this.outputPass?.dispose() 因 OutputPass 无 dispose 方法而抛 TypeError
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    expect(() => mgr.dispose()).toThrow(/outputPass.*dispose/);
    // 因为抛错，内部状态可能未完全置空
  });

  it("dispose：重复调用不报错", () => {
    mgr.dispose();
    expect(() => mgr.dispose()).not.toThrow();
    expect(() => mgr.dispose()).not.toThrow();
  });

  // ════════════════════════════════════════════════════════════════
  // 6. dispose 后调用其他方法
  // ════════════════════════════════════════════════════════════════

  it("dispose 后 setSize → 静默忽略，不报错也不警告", () => {
    // // BUG: dispose 后 setSize 静默 no-op，无任何错误/警告，调用方无法感知
    mgr.dispose();
    expect(() => mgr.setSize(1920, 1080)).not.toThrow();
    // 无副作用：无法从外部判断已 dispose
    expect((mgr as any).composer).toBeNull();
  });

  it("dispose 后 render(volumetric=postprocess) → 会重新创建 composer", () => {
    // // BUG: dispose 后若再次调用 render 且 volumetric=postprocess，会重建 composer
    // 这意味着 dispose 不是"终止态"，调用方可能无意中复活已释放的资源
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.dispose();
    expect(mgr.render(1, lp)).toBe(true);
    expect((mgr as any).composer).toBeTruthy();
  });

  it("dispose 后 render(volumetric=cone) → 正常返回 false", () => {
    const lp = makeLightCap({ engine: "cone" });
    mgr.dispose();
    expect(mgr.render(1, lp)).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  // 7. 各后处理特效参数同步（bloom 阈值/强度/半径）
  // ════════════════════════════════════════════════════════════════

  it("render：bloom 参数根据 volumetric.opacity 正确计算", () => {
    // threshold = max(0.1, 0.5 - opacity*0.3)
    // strength = opacity*1.5
    // radius = edgeFade*0.5 + 0.1
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: 0.5, edgeFade: 0.4 },
    });
    mgr.render(1, lp);
    const bloom = (mgr as any).bloomPass;
    expect(bloom.threshold).toBeCloseTo(Math.max(0.1, 0.5 - 0.5 * 0.3), 6); // 0.35
    expect(bloom.strength).toBeCloseTo(0.5 * 1.5, 6); // 0.75
    expect(bloom.radius).toBeCloseTo(0.4 * 0.5 + 0.1, 6); // 0.3
  });

  it("render：opacity=0 → threshold=0.5, strength=0, 但仍创建 composer", () => {
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: 0, edgeFade: 0 },
    });
    mgr.render(1, lp);
    const bloom = (mgr as any).bloomPass;
    expect(bloom.threshold).toBeCloseTo(0.5, 6);
    expect(bloom.strength).toBe(0);
  });

  it("render：opacity=1 → threshold=0.2, strength=1.5", () => {
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: 1, edgeFade: 1 },
    });
    mgr.render(1, lp);
    const bloom = (mgr as any).bloomPass;
    expect(bloom.threshold).toBeCloseTo(0.2, 6);
    expect(bloom.strength).toBeCloseTo(1.5, 6);
    expect(bloom.radius).toBeCloseTo(0.6, 6);
  });

  it("render：opacity 极大值 → strength 无限增大，无上限", () => {
    // // BUG: strength = opacity * 1.5 无上界，opacity=100 → strength=150，GPU 过载
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: 1000, edgeFade: 1000 },
    });
    mgr.render(1, lp);
    const bloom = (mgr as any).bloomPass;
    expect(bloom.strength).toBe(1500);
    expect(bloom.radius).toBe(500.1);
  });

  it("render：opacity 极小负值 → threshold 仍被 Math.max 兜底（负 opacity 使 strength 变负）", () => {
    // Math.max(0.1, 0.5 - (-10)*0.3) = Math.max(0.1, 3.5) = 3.5
    // strength = -10 * 1.5 = -15 → 负 strength 在 Three.js 中会导致 Bloom 反向增强
    // // BUG (P1): 无负值保护，负 opacity 导致 strength 为负，渲染异常
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: -10, edgeFade: 0 },
    });
    mgr.render(1, lp);
    const bloom = (mgr as any).bloomPass;
    expect(bloom.threshold).toBe(3.5);
    expect(bloom.strength).toBe(-15);
  });

  it("render：opacity=Infinity → threshold 被 max 兜底到 0.1，但 strength 无限增大", () => {
    // Math.max(0.1, 0.5 - Infinity*0.3) = Math.max(0.1, -Infinity) = 0.1
    // strength = Infinity * 1.5 = Infinity → GPU 可能过载
    // // BUG (P1): strength 无上限，Infinity 直接传播
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: Infinity, edgeFade: Infinity },
    });
    mgr.render(1, lp);
    const bloom = (mgr as any).bloomPass;
    expect(bloom.strength).toBe(Infinity);
    expect(bloom.threshold).toBe(0.1);
  });

  // ════════════════════════════════════════════════════════════════
  // 8. 分辨率/尺寸边界
  // ════════════════════════════════════════════════════════════════

  it("render：domElement.width=0 → composer 尺寸 clamp 到 1", () => {
    renderer = fakeRenderer(0, 0);
    mgr = new PostprocessingManager(renderer, scene, camera);
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c.width).toBe(1);
    expect(c.height).toBe(1);
  });

  it("render：domElement 负尺寸 → clamp 到 1", () => {
    renderer = fakeRenderer(-100, -200);
    mgr = new PostprocessingManager(renderer, scene, camera);
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c.width).toBe(1);
    expect(c.height).toBe(1);
  });

  it("render：composer 创建时使用 domElement 尺寸而非 setSize 参数", () => {
    // // BUG: composer 创建时硬编码从 domElement 读宽高，忽略任何先前 setSize
    mgr.setSize(1920, 1080);
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c.width).toBe(800); // domElement.width
    expect(c.height).toBe(600); // domElement.height
  });

  it("setPixelRatio：使用 window.devicePixelRatio 并 clamp 到 2", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c._pixelRatio).toBe(Math.min((globalThis as any).window.devicePixelRatio, 2));
  });

  it("setPixelRatio：devicePixelRatio=3 → clamp 到 2", () => {
    (globalThis as any).window.devicePixelRatio = 3;
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c._pixelRatio).toBe(2);
    // 恢复
    (globalThis as any).window.devicePixelRatio = 1;
  });

  // ════════════════════════════════════════════════════════════════
  // 9. OutputPass dispose 问题
  // ════════════════════════════════════════════════════════════════

  it("disposeComposer：OutputPass 无 dispose 方法 → 直接 TypeError 崩溃", () => {
    // // BUG (P0): disposeComposer 中 this.outputPass?.dispose() 调用时，
    // outputPass 对象存在但无 dispose 方法。?. 只保护 null/undefined，
    // 不保护"方法不存在"——直接 TypeError。
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const op = (mgr as any).outputPass;
    expect(typeof op.dispose).toBe("undefined");
    expect(() => mgr.dispose()).toThrow(/outputPass.*dispose/);
  });

  // ════════════════════════════════════════════════════════════════
  // 10. Bloom 参数更新但不渲染
  // ════════════════════════════════════════════════════════════════

  it("render：连续调用 → bloom 参数每次按最新 volumetric 值更新", () => {
    const lp = makeLightCap({
      engine: "postprocess",
      volumetric: { enabled: true, opacity: 0.2, edgeFade: 0.1 },
    });
    mgr.render(1, lp);
    expect((mgr as any).bloomPass.strength).toBeCloseTo(0.3, 6);

    // 更新 volumetric 参数
    (lp as any).getParams = () => ({
      volumetric: { enabled: true, opacity: 0.8, edgeFade: 0.9 },
    });
    mgr.render(2, lp);
    expect((mgr as any).bloomPass.strength).toBeCloseTo(1.2, 6);
    expect((mgr as any).bloomPass.radius).toBeCloseTo(0.55, 6);
  });

  // ════════════════════════════════════════════════════════════════
  // 11. 方法不存在性检查（任务中提到的 setBloom/setSSAO/setSSR）
  // ════════════════════════════════════════════════════════════════

  it("API 缺失：setBloom / setSSAO / setSSR 不存在", () => {
    // // BUG: 任务描述提到 setBloom/setSSAO/setSSR，但源码中仅有 bloom，
    // 且没有公开的方法用于调整 bloom 参数，也没有 SSAO/SSR 支持
    expect(typeof (mgr as any).setBloom).toBe("undefined");
    expect(typeof (mgr as any).setSSAO).toBe("undefined");
    expect(typeof (mgr as any).setSSR).toBe("undefined");
  });

  it("API 缺失：没有 isDisposed / isActive 等状态查询方法", () => {
    // // BUG: 没有对外的状态查询方法，调用方无法判断当前是否已 dispose
    expect(typeof (mgr as any).isDisposed).toBe("undefined");
    expect(typeof (mgr as any).isActive).toBe("undefined");
  });

  // ════════════════════════════════════════════════════════════════
  // 12. 空/非法 volumetric 参数
  // ════════════════════════════════════════════════════════════════

  it("render：volumetric 属性缺失 → 直接崩溃（无防御）", () => {
    // // BUG (P0): render 访问 lightCap.getParams().volumetric.enabled 前未检查 volumetric 是否存在
    const lp = makeLightCap({ engine: "postprocess" });
    (lp as any).getParams = () => ({});
    expect(() => mgr.render(1, lp)).toThrow(/Cannot read.*enabled/);
  });

  it("render：volumetric 为 null → 直接崩溃", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    (lp as any).getParams = () => ({ volumetric: null });
    expect(() => mgr.render(1, lp)).toThrow(/Cannot read.*enabled/);
  });

  it("render：volumetric 为 undefined → 直接崩溃", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    (lp as any).getParams = () => ({ volumetric: undefined });
    expect(() => mgr.render(1, lp)).toThrow(/Cannot read.*enabled/);
  });

  // ════════════════════════════════════════════════════════════════
  // 13. 每帧性能：无 volumetric 时不分配
  // ════════════════════════════════════════════════════════════════

  it("render：1000 帧无 volumetric → 不分配任何 composer 实例", () => {
    const lp = makeLightCap({ engine: "cone" });
    for (let i = 0; i < 1000; i++) {
      expect(mgr.render(i, lp)).toBe(false);
    }
    expect((mgr as any).composer).toBeNull();
  });

  it("render：1000 帧 volumetric → 只创建一次 composer", () => {
    const lp = makeLightCap({ engine: "postprocess" });
    for (let i = 0; i < 1000; i++) {
      expect(mgr.render(i, lp)).toBe(true);
    }
    // 只应有一个 composer 实例
    expect((mgr as any).composer.passes.length).toBe(3);
  });

  // ════════════════════════════════════════════════════════════════
  // 14. 构造后多次 setSize 再首次 render
  // ════════════════════════════════════════════════════════════════

  it("setSize 多次调用在 render 前 → 全部静默丢失", () => {
    // // BUG: setSize 在 composer 未创建时不缓存任何值
    mgr.setSize(100, 100);
    mgr.setSize(200, 200);
    mgr.setSize(300, 300);
    const lp = makeLightCap({ engine: "postprocess" });
    mgr.render(1, lp);
    const c = (mgr as any).composer;
    expect(c.width).toBe(800); // 全部丢失
    expect(c.height).toBe(600);
  });

  // ════════════════════════════════════════════════════════════════
  // 15. render 中 volumetric.enabled 从 true 变 false 时的 dispose
  // ════════════════════════════════════════════════════════════════

  it("render：volumetric enabled 从 true → false → true → 反复 → 第 2 帧就因 OutputPass 崩溃", () => {
    // // BUG (P0): 同上，一旦 volumetric enabled 从 true 切换到 false，
    // render 进入 dispose 分支，调用 disposeComposer 时因 OutputPass 无 dispose 方法而崩溃
    let enabled = true;
    const lp = makeLightCap({ engine: "postprocess" });
    (lp as any).getParams = () => ({
      volumetric: { enabled, opacity: 0.5, edgeFade: 0.5 },
    });
    expect(mgr.render(0, lp)).toBe(true); // 创建
    enabled = false;
    expect(() => mgr.render(1, lp)).toThrow(/outputPass.*dispose/); // 崩溃
  });
});