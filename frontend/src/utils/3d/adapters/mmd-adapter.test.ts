// ===== MMD 适配器测试 =====
// 覆盖：buildMmdScene 主路径（ReadFileBytes + ListAllFilePaths 同目录纹理预读 →
// URLModifier 映射 → 挂场景/灯光/取景）、update/dispose 契约（blob URL 回收）、
// 错误路径（空字节/加载失败/目录扫描失败降级）。
// @moeru/three-mmd 全 mock（MMDLoader 捕获 LoadingManager 断言 URLModifier 行为）；
// three 用真实实现（Box3/Vector3/Light/LoadingManager 为纯 JS，无 WebGL 依赖）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "./preview-menu.ts";

const hoisted = vi.hoisted(() => {
  const managerInstances: Array<{ resolveURL: (url: string) => string }> = [];
  return {
    readBytesMock: vi.fn(),
    listPathsMock: vi.fn(),
    loaderLoadAsyncMock: vi.fn(),
    mmdUpdateMock: vi.fn(),
    mmdUpdateWithMixerMock: vi.fn(),
    mmdDisposeMock: vi.fn(),
    vmdParseMock: vi.fn(),
    buildAnimMock: vi.fn(),
    managerInstances,
  };
});

vi.mock("../../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadFileBytes: hoisted.readBytesMock,
    ListAllFilePaths: hoisted.listPathsMock,
  }),
}));
vi.mock("@moeru/three-mmd", () => ({
  MMDLoader: class {
    loadAsync = hoisted.loaderLoadAsyncMock;
    constructor(manager: { resolveURL: (url: string) => string }) {
      hoisted.managerInstances.push(manager);
    }
  },
  VmdObject: { ParseFromBuffer: hoisted.vmdParseMock },
  buildAnimation: hoisted.buildAnimMock,
}));

import { buildMmdScene, type MmdDataPort, type MmdPanelHooks } from "./mmd-adapter.ts";

/** 构造注入端口（对齐 ADR-072：适配器 0 backend import，数据经 port 注入） */
function makePort(): MmdDataPort {
  return {
    readFileBytes: hoisted.readBytesMock,
    readFileBytesBatch: vi.fn().mockImplementation(async (paths: string[]) => {
      const result: Record<string, string | null> = {};
      for (const p of paths) {
        result[p] = await hoisted.readBytesMock(p);
      }
      return result;
    }),
    listAllFilePaths: hoisted.listPathsMock,
    addOpLog: vi.fn().mockResolvedValue(undefined),
    getCachedTexture: vi.fn().mockResolvedValue(null),
  };
}

/** 测试用 panels 桩：fillPlayPanel 喂真实按钮+文案（暂停/播放 toggle），其余 no-op */
function makeMmdPanels(): MmdPanelHooks {
  return {
    fillModelPanel: () => {},
    fillPlayPanel: (list) => {
      const btn = document.createElement("button");
      btn.id = "mmd-play-btn";
      btn.textContent = "暂停";
      btn.onclick = (): void => { btn.textContent = btn.textContent === "暂停" ? "播放" : "暂停"; };
      list.appendChild(btn);
    },
    fillShotPanel: () => {},
    buildMaterialControls: () => {},
  };
}

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const loadingEl = document.createElement("div");
  return {
    ctx: {
      scene,
      camera,
      controls: {
        target: new THREE.Vector3(),
        minDistance: 0,
        maxDistance: 0,
        update: vi.fn(),
      } as unknown as OrbitControls,
      viewContainer: document.createElement("div"),
      loadingEl,
      overlay: document.createElement("div"),
      menu: { setAdapterItems: vi.fn(), openPanel: vi.fn() } as unknown as PreviewMenuHandle,
    },
    scene,
    camera,
    loadingEl,
  };
}

/** 最近一次 setAdapterItems 收到的适配器项 */
function registeredItems(ctx: ReturnType<typeof makeCtx>["ctx"]) {
  return (ctx.menu as unknown as { setAdapterItems: ReturnType<typeof vi.fn> }).setAdapterItems.mock
    .calls[0][0] as Array<{
    id: string;
    kind: string;
    render?: (list: HTMLElement, close: () => void) => void;
  }>;
}

/** 构造一个可用的 fake MMD（mesh 挂进 scene 需真实 Object3D 供 Box3 计算；pmx 对齐真实 MMD 类形态） */
function fakeMmd() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
  return {
    mesh,
    pmx: { bones: [], materials: [], morphs: [] },
    update: hoisted.mmdUpdateMock,
    updateWithMixer: hoisted.mmdUpdateWithMixerMock,
    dispose: hoisted.mmdDisposeMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.managerInstances.length = 0;
  hoisted.loaderLoadAsyncMock.mockReset();
  hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmd()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMmdScene 主路径", () => {
  it("读模型字节 + 预读同目录纹理 → URLModifier 命中模型/纹理/放行未知", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      if (p.toLowerCase().endsWith(".tga")) {
        // 合法 TGA 头：18 字节 + 图像类型 2（未压缩真彩）——通过假 TGA 魔数检测
        const tga = new Uint8Array(18);
        tga[2] = 2;
        return Promise.resolve(btoa(String.fromCharCode(...tga)));
      }
      return Promise.resolve(btoa("PNG"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/tex.png",
      "/mmd/miku/sub/face.tga",
      "/mmd/miku/readme.txt",
    ]);
    const { ctx, scene, camera, loadingEl } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    // 目录列取 + 模型/纹理读取
    expect(hoisted.listPathsMock).toHaveBeenCalledWith("/mmd/miku");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/tex.png");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/sub/face.tga");
    // readme.txt 不是纹理候选，不读
    expect(hoisted.readBytesMock).not.toHaveBeenCalledWith("/mmd/miku/readme.txt");

    // loader 收到模型路径
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");

    // URLModifier：模型本体 + 纹理（含子目录 basename）→ blob；未知/toon dataURL 放行
    // （LoadingManager.resolveURL 实例方法内部走 setURLModifier 注册的闭包 modifier）
    const mgr = hoisted.managerInstances[0];
    expect(mgr).toBeDefined();
    expect(mgr!.resolveURL("/mmd/miku/miku.pmx")).toBe("blob:mock-url");
    expect(mgr!.resolveURL("/mmd/miku/tex.png")).toBe("blob:mock-url");
    expect(mgr!.resolveURL("/mmd/miku/sub/face.tga")).toBe("blob:mock-url");
    expect(mgr!.resolveURL("/mmd/miku/unknown.png")).toBe("/mmd/miku/unknown.png");
    expect(mgr!.resolveURL("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");

    // 挂场景 + 灯光 + 取景（包围盒中心定相机）
    expect(scene.children).toContain(fakeMmdMeshRef(scene));
    expect(camera.near).toBe(0.05);
    expect(camera.position.z).toBeGreaterThan(0);

    // loading 占位已移除
    expect(loadingEl.parentNode).toBeNull();

    // update 契约：VMD 动画 + IK/追加变换经 updateWithMixer 驱动
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalledWith(
      0.016,
      expect.anything(),
      { ik: true, grant: true },
    );

    // dispose 契约：释放 GPU + 回收 blob URL
    built.dispose();
    expect(hoisted.mmdDisposeMock).toHaveBeenCalled();
    expect(revokeURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("目录扫描失败 → 白模降级不阻断（无纹理映射，模型仍加载）", async () => {
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockRejectedValue(new Error("no dir"));
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(scene.children.length).toBeGreaterThan(0);
    built.dispose();
    // 无纹理 → 仅回收模型本体 blob
    expect(revokeURL).toHaveBeenCalledTimes(1);
  });

  it("同名纹理在不同子目录 → 最长后缀匹配各归其位（不串贴图）", async () => {
    let counter = 0;
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:t${++counter}`);
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) =>
      Promise.resolve(btoa("PNG-" + p)),
    );
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/a/body.png",
      "/mmd/miku/b/body.png",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mgr = hoisted.managerInstances[0]!;
    // 模型 blob 第 1 个（t1）；纹理按 entries 顺序 a→t2、b→t3
    expect(mgr.resolveURL("/mmd/miku/miku.pmx")).toBe("blob:t1");
    expect(mgr.resolveURL("/mmd/miku/a/body.png")).toBe("blob:t2");
    expect(mgr.resolveURL("/mmd/miku/b/body.png")).toBe("blob:t3");
    built.dispose();
    expect(revokeURL).toHaveBeenCalledTimes(3); // 模型 + 2 纹理
  });

  it("假 TGA（头部类型非法）→ 跳过不注册，TGALoader 不会收到它", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // 假 TGA：18 字节头部 + 第 3 字节（索引 2）图像类型 = 100（非法，合法仅 1/2/3/9/10/11）
    const fakeTga = new Uint8Array(18);
    fakeTga[2] = 100;
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.toLowerCase().endsWith(".tga")) {
        return Promise.resolve(btoa(String.fromCharCode(...fakeTga)));
      }
      return Promise.resolve(btoa("PNG"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/tex.png",
      "/mmd/miku/fake.tga",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mgr = hoisted.managerInstances[0]!;
    // 合法 PNG 命中 blob
    expect(mgr.resolveURL("/mmd/miku/tex.png")).toBe("blob:mock-url");
    // 假 TGA 不注册 → 放行原路径（不触发 TGALoader 解析错误）
    expect(mgr.resolveURL("/mmd/miku/fake.tga")).toBe("/mmd/miku/fake.tga");
    built.dispose();
  });

  it("Windows 反斜杠路径形态 → 分隔符统一后纹理键仍命中", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "C:\\mmd\\ziyan\\textures\\ziyan_head.png",
      "C:\\mmd\\ziyan\\ziyan.pmx",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "C:\\mmd\\ziyan\\ziyan.pmx", makePort());
    expect(hoisted.listPathsMock).toHaveBeenCalledWith("C:\\mmd\\ziyan");
    const mgr = hoisted.managerInstances[0]!;
    // PMX 内正斜杠相对路径（textures/ziyan_head.png）→ 命中 rel 键
    expect(mgr.resolveURL("textures/ziyan_head.png")).toBe("blob:mock-url");
    // 反斜杠完整路径 → 统一分隔符后同样命中
    expect(mgr.resolveURL("C:\\mmd\\ziyan\\textures\\ziyan_head.png")).toBe("blob:mock-url");
    // 未知路径仍放行
    expect(mgr.resolveURL("C:\\mmd\\other\\x.png")).toBe("C:\\mmd\\other\\x.png");
    built.dispose();
  });

  it("同目录 VMD → 自动播放 + 播放面板（经菜单项渲染）", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/dance.vmd",
    ]);
    hoisted.vmdParseMock.mockReturnValue({});
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("dance", -1, []));

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // VMD 解析 + 动画构建
    expect(hoisted.vmdParseMock).toHaveBeenCalledTimes(1);
    expect(hoisted.buildAnimMock).toHaveBeenCalledTimes(1);

    // 播放面板（ADR-076 v2 Phase 2：经菜单项 render；初始播放态 → 文案"暂停"）
    const playItem = registeredItems(ctx).find((i) => i.id === "play");
    expect(playItem).toBeDefined();
    const list = document.createElement("div");
    playItem!.render!(list, () => {});
    const playBtn = list.querySelector<HTMLElement>("#mmd-play-btn");
    expect(playBtn).not.toBeNull();
    expect(playBtn!.textContent).toBe("暂停");
    playBtn!.click();
    expect(playBtn!.textContent).toBe("播放");
    playBtn!.click();
    expect(playBtn!.textContent).toBe("暂停");

    // update 契约：updateWithMixer 驱动动画 + IK
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalledWith(
      0.016,
      expect.anything(),
      { ik: true, grant: true },
    );

    built.dispose();
    expect(hoisted.mmdDisposeMock).toHaveBeenCalled();
  });

  it("多个 VMD → select 切换动作，坏文件跳过其余照常", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/bad.vmd",
      "/mmd/miku/idle.vmd",
    ]);
    // 第一个 VMD 解析失败（损坏）→ 跳过；第二个成功（按调用次数分派，不依赖 Once 链语义）
    let vmdCall = 0;
    hoisted.vmdParseMock.mockImplementation(() => {
      vmdCall += 1;
      if (vmdCall === 1) return Promise.reject(new Error("bad vmd"));
      return Promise.resolve({});
    });
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("motion", -1, []));

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // 坏 VMD 被跳过，仅 1 个动画构建成功
    expect(hoisted.buildAnimMock).toHaveBeenCalledTimes(1);

    // 仅 1 个 clip → 播放面板无 select（播放按钮仍在）
    const playItem = registeredItems(ctx).find((i) => i.id === "play");
    expect(playItem).toBeDefined();
    const list = document.createElement("div");
    playItem!.render!(list, () => {});
    expect(list.querySelector("#mmd-motion-sel")).toBeNull();
    expect(list.querySelector("#mmd-play-btn")).not.toBeNull();
    built.dispose();
  });

  it("无 VMD → 无播放按钮，静态渲染照常", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(hoisted.vmdParseMock).not.toHaveBeenCalled();
    // 无 VMD → 不注册 play 菜单项
    expect(registeredItems(ctx).find((i) => i.id === "play")).toBeUndefined();
    // 空 mixer 的 updateWithMixer 无害
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalled();
    built.dispose();
  });
});

describe("buildMmdScene 错误路径", () => {
  it("ReadFileBytes 返回空 → 抛错", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    await expect(buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort())).rejects.toThrow("ReadFileBytes 返回空");
  });

  it("MMDLoader.loadAsync 失败 → 抛错穿透 + 已建 blob 全部回收", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/tex.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockRejectedValue(new Error("parse fail"));
    const { ctx } = makeCtx();
    await expect(buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort())).rejects.toThrow("parse fail");
    // 模型 blob + 已读纹理 blob 均回收，不随会话泄漏
    expect(revokeURL).toHaveBeenCalledTimes(2);
  });
});

/** 从 scene.children 取 mesh（fakeMmd 每次调用新建实例，断言用内容而非引用） */
function fakeMmdMeshRef(scene: THREE.Scene): THREE.Object3D {
  return scene.children.find((c) => c instanceof THREE.Mesh) as THREE.Object3D;
}

describe("KTX2 缓存", () => {
  it("纹理加载后无额外 RPC（getCachedTexture 不再调用，hash 由前端计算）", async () => {
    const createURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      hoisted.readBytesMock.mockImplementation((p: string) => {
        if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
        return Promise.resolve(btoa("PNG_DATA"));
      });
      hoisted.listPathsMock.mockResolvedValue([
        "/mmd/miku/miku.pmx",
        "/mmd/miku/tex.png",
        "/mmd/miku/face.png",
      ]);

      const port: MmdDataPort = {
        readFileBytes: hoisted.readBytesMock,
        readFileBytesBatch: vi.fn().mockImplementation(async (paths: string[]) => {
          const result: Record<string, string | null> = {};
          for (const p of paths) {
            result[p] = await hoisted.readBytesMock(p);
          }
          return result;
        }),
        listAllFilePaths: hoisted.listPathsMock,
        addOpLog: vi.fn().mockResolvedValue(undefined),
      };

      const { ctx } = makeCtx();
      const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

      // 验证 blob URL 数量：模型(1) + 纹理(2) = 3 次（无额外 KTX2 blob）
      expect(createURL).toHaveBeenCalledTimes(3);

      // 模型文件仍走 readFileBytes
      expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");

      built.dispose();
      expect(hoisted.mmdDisposeMock).toHaveBeenCalled();
    } finally {
      createURL.mockRestore();
      revokeURL.mockRestore();
    }
  });
});

// ---- P0-2 GPU 内存释放：SkinnedMesh.skeleton.dispose ----
describe("GPU 内存释放", () => {
  function makeSkinnedMeshForTest() {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    // 添加 skinIndex 和 skinWeight 属性让 SkinnedMesh.computeBoundingBox 不崩
    const boneIndices = new Float32Array(geometry.attributes.position.count * 4);
    const boneWeights = new Float32Array(geometry.attributes.position.count * 4);
    for (let i = 0; i < boneWeights.length; i += 4) {
      boneIndices[i] = 0; boneIndices[i + 1] = 0; boneIndices[i + 2] = 0; boneIndices[i + 3] = 0;
      boneWeights[i] = 1; boneWeights[i + 1] = 0; boneWeights[i + 2] = 0; boneWeights[i + 3] = 0;
    }
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(boneIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(boneWeights, 4));
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.bind(skeleton, new THREE.Matrix4());
    return { mesh, skeleton };
  }

  it("dispose 时释放 SkinnedMesh.skeleton（防 GPU 内存泄漏）", async () => {
    const { mesh, skeleton } = makeSkinnedMeshForTest();
    const skeletonDisposeSpy = vi.spyOn(skeleton, "dispose");

    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve({
        mesh,
        pmx: { bones: [], materials: [], morphs: [] },
        update: hoisted.mmdUpdateMock,
        updateWithMixer: hoisted.mmdUpdateWithMixerMock,
        dispose: hoisted.mmdDisposeMock,
      })
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());
    built.dispose();
    expect(skeletonDisposeSpy).toHaveBeenCalled();
  });

  it("dispose 时无 skeleton 不抛错", async () => {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    // Mesh 没有 skeleton 属性

    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve({
        mesh,
        pmx: { bones: [], materials: [], morphs: [] },
        update: hoisted.mmdUpdateMock,
        updateWithMixer: hoisted.mmdUpdateWithMixerMock,
        dispose: hoisted.mmdDisposeMock,
      })
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());
    expect(() => built.dispose()).not.toThrow();
  });
});

// ---- P1-4 dispose 错误路径 blob URL 回收 ----
describe("dispose 错误路径 blob URL 回收", () => {
  it("dispose 前置步骤抛错时，blob URL 仍在 finally 中被回收", async () => {
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // 模拟 AnimationMixer.stopAllAction 抛错
    vi.spyOn(THREE.AnimationMixer.prototype, "stopAllAction")
      .mockImplementation(() => { throw new Error("mixer failed"); });

    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve(fakeMmd())
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());

    // dispose 不应向外抛错（blob URL 在 finally 中被回收）
    let threw = false;
    try { built.dispose(); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(revokeURL).toHaveBeenCalled();
  });

  it("build 失败时 finally 兜底回收 blob URL（scene.add 后抛错）", async () => {
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // 让 loader.loadAsync 成功，但 scene.add 之后的步骤抛错
    // 通过 mock loaderLoadAsyncMock 成功 + 让后续逻辑抛错
    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve(fakeMmd())
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    // 让 registerModelRoot 抛错（scene.add 后的第一步）
    // registerModelRoot 是模块内部函数，不易直接 mock
    // 改为：mock THREE.Scene.prototype.add 在特定条件下抛错
    const origAdd = THREE.Scene.prototype.add;
    vi.spyOn(THREE.Scene.prototype, "add").mockImplementation(function (this: THREE.Scene, ...args: unknown[]) {
      // 抛错前先执行原方法（让 mesh.parent 被设置）
      origAdd.call(this, ...(args as [THREE.Object3D]));
      // 然后抛错，模拟 scene.add 后 build 中途失败
      throw new Error("scene.add failed");
    });

    const { ctx } = makeCtx();
    let buildError: unknown = null;
    try {
      await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());
    } catch (e) {
      buildError = e;
    }

    // build 确实抛错了
    expect(buildError).toBeInstanceOf(Error);
    // finally 兜底回收了 blob URL
    expect(revokeURL).toHaveBeenCalled();
  });
});

// ---- P0-3 批量读取 fallback：readFileBytesBatch 失败时降级并发分片读取 ----
describe("批量读取降级", () => {
  it("readFileBytesBatch 抛错时，降级为并发分片 readFileBytes 读取纹理", async () => {
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      if (p.endsWith(".png")) return Promise.resolve(btoa("PNX"));
      return Promise.resolve(btoa("DATA"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/tex.png",
      "/mmd/miku/sub.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => Promise.resolve(fakeMmd())
    );

    const port: MmdDataPort = {
      ...makePort(),
      // 批量读取抛错，强制降级
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch RPC failed")),
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku", port, makeMmdPanels());

    // 关键断言：batch 失败后，readFileBytes 仍被并发调用读取所有纹理
    const texCalls = hoisted.readBytesMock.mock.calls
      .map((c: unknown[]) => (c as [string])[0])
      .filter((p: string) => p.endsWith(".png"));
    expect(texCalls.length).toBeGreaterThanOrEqual(2);

    // 模型仍正常加载（URLModifier 已挂载）
    expect(built.update).toBeDefined();
  });

  it("多个纹理并发 fallback 全部成功", async () => {
    // 模拟 6 个纹理文件（> chunkSize=4，触发分片行为）
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      return Promise.resolve(btoa("TEX"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/t1.png",
      "/mmd/miku/t2.png",
      "/mmd/miku/t3.png",
      "/mmd/miku/t4.png",
      "/mmd/miku/t5.png",
      "/mmd/miku/t6.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => Promise.resolve(fakeMmd())
    );

    const port: MmdDataPort = {
      ...makePort(),
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch RPC failed")),
      readFileBytesBatchWithMeta: vi.fn().mockRejectedValue(new Error("meta batch RPC failed")),
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku", port, makeMmdPanels());

    // 6 个纹理 + 1 个模型 = 7 次 readFileBytes 调用
    const allCalls = hoisted.readBytesMock.mock.calls.map(
      (c: unknown[]) => (c as [string])[0]
    );
    expect(allCalls.length).toBeGreaterThanOrEqual(7);

    // 模型仍正常加载
    expect(built.update).toBeDefined();
  });

  it("部分纹理 readFileBytes 失败不阻塞其他纹理", async () => {
    let failCount = 0;
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      // 第二个纹理返回 null（模拟失败）
      if (p.endsWith("t2.png")) { failCount++; return Promise.resolve(null); }
      return Promise.resolve(btoa("TEX"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/t1.png",
      "/mmd/miku/t2.png",
      "/mmd/miku/t3.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => Promise.resolve(fakeMmd())
    );

    const port: MmdDataPort = {
      ...makePort(),
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch RPC failed")),
      readFileBytesBatchWithMeta: vi.fn().mockRejectedValue(new Error("meta batch RPC failed")),
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku", port, makeMmdPanels());

    // 即使有纹理失败，模型仍应加载
    expect(built.update).toBeDefined();
    expect(failCount).toBe(1);
  });
});
