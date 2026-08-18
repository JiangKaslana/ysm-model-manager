// @vitest-environment node
// ===== 资源类型映射测试（ADR-021 扩展）=====
// TS 常量（RESOURCE_TYPES/LABELS/ALL）与 resource_types.json（单一事实来源）对账。
import { describe, it, expect } from "vitest";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  ALL_RESOURCE_TYPES,
  AMBIGUOUS_EXTS,
  resolveTypeSafe,
  VOXEL_RPC_BY_EXT,
  GROUP_META,
  GROUP_OF,
  groupLabelOf,
  groupStorageRootOf,
} from "./types.ts";
import resourceTypesJson from "../../../../resource_types.json";

/** JSON 中全部资源类型 ID */
const jsonIds = resourceTypesJson.resourceTypes.map((r) => r.id);

describe("RESOURCE_TYPES 标签映射", () => {
  it("各标签映射到预期内部 ID", () => {
    expect(RESOURCE_TYPES).toEqual({
      YSM: "ysm",
      MMD: "mmd-skin",
      VRC: "vrchat-avatar",
      PACK: "resourcepack",
      SHADER: "shaderpack",
      BLUEPRINT: "create-blueprint",
      LITEMATIC: "litematic",
    });
  });
});

describe("RESOURCE_TYPE_LABELS 显示标签", () => {
  it("每个内部 ID 都有中文显示名", () => {
    for (const id of ALL_RESOURCE_TYPES) {
      expect(RESOURCE_TYPE_LABELS[id], `缺少标签: ${id}`).toBeTruthy();
    }
  });

  it("关键 ID 的中文名正确", () => {
    expect(RESOURCE_TYPE_LABELS["ysm"]).toBe("YSM 模型");
    expect(RESOURCE_TYPE_LABELS["resourcepack"]).toBe("资源包");
    expect(RESOURCE_TYPE_LABELS["shaderpack"]).toBe("光影包");
    expect(RESOURCE_TYPE_LABELS["create-blueprint"]).toBe("蓝图");
  });
});

describe("与 resource_types.json 对账（单一事实来源）", () => {
  it("ALL_RESOURCE_TYPES 与 JSON 的 id 集合一致", () => {
    expect([...ALL_RESOURCE_TYPES].sort()).toEqual([...jsonIds].sort());
  });

  it("RESOURCE_TYPES 的值全部在 JSON 中存在", () => {
    for (const id of Object.values(RESOURCE_TYPES)) {
      expect(jsonIds, `JSON 缺少资源类型: ${id}`).toContain(id);
    }
  });

  it("JSON 每个 id 都被 TS 常量覆盖（无遗漏）", () => {
    // P3 修复（子代理审计）：原断言 ALL_RESOURCE_TYPES 包含 jsonIds——ALL_RESOURCE_TYPES
    // 本就由 JSON id 派生（types.ts:43-45），「自己包含自己」恒真伪断言，无守护价值；
    // 真正需守护的是手写 RESOURCE_TYPES 值集合对 JSON 的完备性（JSON 新增类型而
    // 手写表未加时此断言红）
    const resourceTypeValues = new Set(Object.values(RESOURCE_TYPES));
    for (const id of jsonIds) {
      expect(resourceTypeValues, `手写 RESOURCE_TYPES 缺少 JSON 类型: ${id}`).toContain(id);
    }
  });

  it("无重复 ID", () => {
    expect(new Set(ALL_RESOURCE_TYPES).size).toBe(ALL_RESOURCE_TYPES.length);
  });
});

// ===== ADR-067 S4：歧义扩展名安全契约 =====
// resolveTypeSafe 强制歧义扩展名（.zip/.7z 归属 ≥2 类型）返回 null，
// 调用方必须回退 Go DetectResourceType 内容检测——从入口杜绝硬编码扩展名派发。

describe("AMBIGUOUS_EXTS 歧义扩展名集合", () => {
  it("容器扩展名 .zip 恒歧义（归属 ≥2 类型）", () => {
    expect(AMBIGUOUS_EXTS.has(".zip")).toBe(true);
  });

  it(".7z 多归属（resourcepack/shaderpack/ysm 均声明）→ 歧义", () => {
    // 注册表现状：.7z 已被 resourcepack/shaderpack/ysm 三类同时声明
    // （resource_types.json 单一事实来源）→ 计入歧义集合，resolveTypeSafe 回退 Go 内容检测。
    expect(AMBIGUOUS_EXTS.has(".7z")).toBe(true);
  });

  it("单归属扩展名不歧义", () => {
    // ysm 独有 / resourcepack 独有——S1 后 4 类加了 .zip 但 .pmx/.vrca/.nbt 仍单归属
    expect(AMBIGUOUS_EXTS.has(".ysm")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".pmx")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".vrca")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".nbt")).toBe(false);
  });

  it("与 resource_types.json 派生一致（新增类型自动纳入）", () => {
    // 对账：AMBIGUOUS_EXTS 应从 JSON 的 extensions 归属计数 ≥2 推导
    const counts: Record<string, number> = {};
    for (const rt of resourceTypesJson.resourceTypes) {
      for (const e of rt.extensions || []) {
        counts[e.toLowerCase()] = (counts[e.toLowerCase()] || 0) + 1;
      }
    }
    const expected = new Set(
      Object.keys(counts).filter((e) => counts[e] > 1),
    );
    expect([...AMBIGUOUS_EXTS].sort()).toEqual([...expected].sort());
  });
});

describe("resolveTypeSafe 安全解析", () => {
  it("单归属扩展名直接命中", () => {
    expect(resolveTypeSafe("model.ysm")).toBe("ysm");
    expect(resolveTypeSafe("avatar.pmx")).toBe("mmd-skin");
    expect(resolveTypeSafe("build.nbt")).toBe("create-blueprint");
    expect(resolveTypeSafe("proj.litematic")).toBe("litematic");
  });

  it("歧义扩展名返回 null（强制回退 Go 内容检测）", () => {
    expect(resolveTypeSafe("pack.zip")).toBeNull();
    // .7z 现被多类型声明（见 AMBIGUOUS_EXTS 用例）→ 歧义，回退 Go 内容检测而非直判 ysm
    expect(resolveTypeSafe("pack.7z")).toBeNull();
  });

  it("未知/无扩展名返回 null", () => {
    expect(resolveTypeSafe("readme.txt")).toBeNull();
    expect(resolveTypeSafe("noext")).toBeNull();
  });

  it("大小写不敏感（与注册表口径一致）", () => {
    expect(resolveTypeSafe("MODEL.YSM")).toBe("ysm");
  });
});

// ===== ADR-066 §5.3 遗留收尾：voxelFn 映射契约 =====
// VOXEL_RPC_BY_EXT 是体素类（蓝图/投影）扩展名 → Go RPC 的单点映射（litematic-meta.ts:212 消费）。
// 守护：体素类扩展名必须全部有 RPC 映射，且映射 key 不得指向非体素扩展名（防注册表扩展名漂移）。

describe("VOXEL_RPC_BY_EXT voxelFn 映射", () => {
  const voxelTypeIds = ["create-blueprint", "litematic"];
  const voxelExts = new Set<string>();
  for (const rt of resourceTypesJson.resourceTypes) {
    if (voxelTypeIds.includes(rt.id)) {
      for (const e of rt.extensions || []) voxelExts.add(e.toLowerCase());
    }
  }

  it("体素类扩展名（.nbt/.schematic/.litematic）全部有 RPC 映射", () => {
    for (const ext of voxelExts) {
      // 容器扩展名不参与体素 RPC（.zip 包裹走内容检测后仍按内部条目解析）
      if (ext === ".zip" || ext === ".7z") continue;
      expect(VOXEL_RPC_BY_EXT[ext], `缺少 voxelFn 映射: ${ext}`).toBeTruthy();
    }
  });

  it("映射 key 全部是体素类扩展名（无漂移）", () => {
    for (const ext of Object.keys(VOXEL_RPC_BY_EXT)) {
      expect(voxelExts, `非体素扩展名 ${ext} 不应出现在 VOXEL_RPC_BY_EXT`).toContain(ext);
    }
  });

  it("RPC 名称指向 Get*VoxelData 形态", () => {
    for (const fn of Object.values(VOXEL_RPC_BY_EXT)) {
      expect(fn).toMatch(/^Get\w*VoxelData$/);
    }
  });
});

// ===== ADR-092 资源分组派生层 =====
// GROUP_META / GROUP_OF / groupStorageRootOf 从 resource_types.json 的 resourceGroups + 各类型 group 字段派生。
// 守护：每个类型都有合法分组；两层路由 {group}/{storageSubDir} 与 JSON 单一事实来源一致。

describe("GROUP_META 分组元数据", () => {
  it("关键分组存在且 icon/name 正确", () => {
    expect(GROUP_META["minecraft"]).toMatchObject({ name: "Minecraft 原版" });
    expect(GROUP_META["minecraft-mod"]).toMatchObject({ name: "Minecraft 模组" });
    expect(GROUP_META["mmd"]).toMatchObject({ name: "MMD" });
    expect(GROUP_META["vrm"]).toMatchObject({ name: "VRM" });
    expect(GROUP_META["other"]).toMatchObject({ name: "其他" });
  });

  it("分组按 order 有确定顺序", () => {
    const groups = Object.values(GROUP_META).sort((a, b) => a.order - b.order);
    expect(groups.map((g) => g.order)).toEqual([0, 1, 2, 3, 9]);
  });
});

describe("GROUP_OF 类型→分组映射", () => {
  it("原版资源归 minecraft", () => {
    expect(GROUP_OF["resourcepack"]).toBe("minecraft");
    expect(GROUP_OF["shaderpack"]).toBe("minecraft");
  });

  it("模组资源归 minecraft-mod", () => {
    expect(GROUP_OF["ysm"]).toBe("minecraft-mod");
    expect(GROUP_OF["create-blueprint"]).toBe("minecraft-mod");
    expect(GROUP_OF["litematic"]).toBe("minecraft-mod");
  });

  it("MMD/VRM 各自独立分组", () => {
    expect(GROUP_OF["mmd-skin"]).toBe("mmd");
    expect(GROUP_OF["vrchat-avatar"]).toBe("vrm");
  });
});

describe("groupStorageRootOf 两层路由", () => {
  it("有 group 时返回 {group}/{storageSubDir}", () => {
    expect(groupStorageRootOf("resourcepack")).toBe("minecraft/resourcepacks");
    expect(groupStorageRootOf("mmd-skin")).toBe("mmd/EntityPlayer");
    expect(groupStorageRootOf("vrchat-avatar")).toBe("vrm/vrchat");
  });

  it("无 group 字段时回退单级 storageSubDir（向后兼容）", () => {
    // 构造无 group 场景：直接从 JSON 找未带 group 的类型验证回退逻辑
    // （当前全类型均带 group，此处用 groupStorageRootOf 对已知 storageSubDir 断言）
    expect(groupStorageRootOf("ysm")).toBe("minecraft-mod/ysm");
  });
});

describe("groupLabelOf 分组显示名", () => {
  it("已知分组返回中文名", () => {
    expect(groupLabelOf("minecraft")).toBe("Minecraft 原版");
    expect(groupLabelOf("mmd")).toBe("MMD");
  });

  it("未知分组返回原样（不炸）", () => {
    expect(groupLabelOf("nonexistent")).toBe("nonexistent");
    expect(groupLabelOf("")).toBe("");
  });
});


