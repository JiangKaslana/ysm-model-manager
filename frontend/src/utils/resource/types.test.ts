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
  GROUP_TYPE_OPTIONS,
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
      MMD: "EntityPlayer",
      VRC: "vrchat-avatar",
      PACK: "resourcepack",
      SHADER: "shaderpack",
      BLUEPRINT: "blueprint",
      LITEMATIC: "litematic",
      MAID: "maid-model",
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
    expect(RESOURCE_TYPE_LABELS["EntityPlayer"]).toBe("PMX 模型");
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

  it("无重复 ID", () => {
    expect(new Set(ALL_RESOURCE_TYPES).size).toBe(ALL_RESOURCE_TYPES.length);
  });
});

describe("AMBIGUOUS_EXTS 歧义扩展名集合", () => {
  it("容器扩展名 .zip 恒歧义（归属 ≥2 类型）", () => {
    expect(AMBIGUOUS_EXTS.has(".zip")).toBe(true);
  });

  it(".7z 多归属（resourcepack/shaderpack/ysm 均声明）→ 歧义", () => {
    expect(AMBIGUOUS_EXTS.has(".7z")).toBe(true);
  });

  it("单归属扩展名不歧义", () => {
    expect(AMBIGUOUS_EXTS.has(".ysm")).toBe(false);
    // .pmx 被 EntityPlayer 和 SceneModel 共享（扁平化后 MMD 类型共享扩展名）
    expect(AMBIGUOUS_EXTS.has(".pmx")).toBe(true);
    expect(AMBIGUOUS_EXTS.has(".vrca")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".nbt")).toBe(false);
    expect(AMBIGUOUS_EXTS.has(".schematic")).toBe(false);
  });

  it("与 resource_types.json 派生一致（新增类型自动纳入）", () => {
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
    expect(resolveTypeSafe("build.nbt")).toBe("blueprint");
    expect(resolveTypeSafe("proj.litematic")).toBe("litematic");
    expect(resolveTypeSafe("old.schematic")).toBe("blueprint");
  });

  it("歧义扩展名返回 null（强制回退 Go 内容检测）", () => {
    expect(resolveTypeSafe("pack.zip")).toBeNull();
    expect(resolveTypeSafe("pack.7z")).toBeNull();
    // .pmx 被 EntityPlayer/SceneModel 共享（扁平化后 MMD 类型共享扩展名）
    expect(resolveTypeSafe("avatar.pmx")).toBeNull();
  });

  it("未知/无扩展名返回 null", () => {
    expect(resolveTypeSafe("readme.txt")).toBeNull();
    expect(resolveTypeSafe("noext")).toBeNull();
  });

  it("大小写不敏感（与注册表口径一致）", () => {
    expect(resolveTypeSafe("MODEL.YSM")).toBe("ysm");
  });
});

describe("VOXEL_RPC_BY_EXT voxelFn 映射", () => {
  const voxelTypeIds = ["blueprint", "litematic"];
  const voxelExts = new Set<string>();
  for (const rt of resourceTypesJson.resourceTypes) {
    if (voxelTypeIds.includes(rt.id)) {
      for (const e of rt.extensions || []) voxelExts.add(e.toLowerCase());
    }
  }

  it("体素类扩展名（.nbt/.schematic/.litematic）全部有 RPC 映射", () => {
    for (const ext of voxelExts) {
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

describe("GROUP_META 分组元数据", () => {
  it("关键分组存在且 icon/name 正确", () => {
    expect(GROUP_META["minecraft"]).toMatchObject({ name: "Minecraft 原版" });
    expect(GROUP_META["minecraft-mod"]).toMatchObject({ name: "Minecraft 模组" });
    expect(GROUP_META["mmd"]).toMatchObject({ name: "MMD" });
  });

  it("分组按首次出现顺序排列", () => {
    const groups = Object.values(GROUP_META).sort((a, b) => a.order - b.order);
    expect(groups.map((g) => g.order)).toEqual([0, 1, 2]);
  });

  it("无类型使用的分组不出现（other 组无类型，不展示）", () => {
    expect(GROUP_META["other"]).toBeUndefined();
  });

  it("每个分组 name/icon 非空（从注册表 groupLabel/groupIcon 派生）", () => {
    for (const [gid, meta] of Object.entries(GROUP_META)) {
      expect(meta.name).toBeTruthy();
      expect(meta.icon).toBeTruthy();
    }
  });
});

describe("GROUP_OF 类型→分组映射", () => {
  it("原版资源归 minecraft", () => {
    expect(GROUP_OF["resourcepack"]).toBe("minecraft");
    expect(GROUP_OF["shaderpack"]).toBe("minecraft");
  });

  it("模组资源归 minecraft-mod", () => {
    expect(GROUP_OF["ysm"]).toBe("minecraft-mod");
    expect(GROUP_OF["blueprint"]).toBe("minecraft-mod");
    expect(GROUP_OF["litematic"]).toBe("minecraft-mod");
  });

  it("MMD 生态归 mmd（VRM 寄生并入）", () => {
    expect(GROUP_OF["EntityPlayer"]).toBe("mmd");
    expect(GROUP_OF["SceneModel"]).toBe("mmd");
    expect(GROUP_OF["vrchat-avatar"]).toBe("mmd");
  });
});

describe("GROUP_TYPE_OPTIONS — 平铺展示各类型", () => {
  it("minecraft 组：资源包/光影包平铺", () => {
    const mc = GROUP_TYPE_OPTIONS["minecraft"] || [];
    const rtypes = mc.map((o) => o.rtype);
    expect(rtypes).toContain("resourcepack");
    expect(rtypes).toContain("shaderpack");
    expect(mc[0].subdir).toBe("");
  });

  it("minecraft-mod 组：ysm/blueprint/litematic/maid-model 平铺", () => {
    const mod = GROUP_TYPE_OPTIONS["minecraft-mod"] || [];
    const rtypes = mod.map((o) => o.rtype);
    expect(rtypes).toContain("ysm");
    expect(rtypes).toContain("blueprint");
    expect(rtypes).toContain("litematic");
    expect(rtypes).toContain("maid-model");
  });

  it("mmd 组：7 个独立 MMD 类型 + vrchat-avatar", () => {
    const mmd = GROUP_TYPE_OPTIONS["mmd"] || [];
    expect(mmd.length).toBe(9); // EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/mmd-shader/DefaultAnim/DefaultMorph + vrchat-avatar
    const rtypes = mmd.map((o) => o.rtype);
    expect(rtypes).toContain("EntityPlayer");
    expect(rtypes).toContain("SceneModel");
    expect(rtypes).toContain("CustomAnim");
    expect(rtypes).toContain("CustomMorph");
    expect(rtypes).toContain("StageAnim");
    expect(rtypes).toContain("mmd-shader");
    expect(rtypes).toContain("DefaultAnim");
    expect(rtypes).toContain("DefaultMorph");
    expect(rtypes).toContain("vrchat-avatar");
  });

  it("所有选项 subdir 为空（平铺，无子目录展开）", () => {
    for (const opts of Object.values(GROUP_TYPE_OPTIONS)) {
      for (const o of opts) {
        expect(o.subdir).toBe("");
      }
    }
  });
});

describe("groupStorageRootOf 两层路由（从 JSON 动态派生，防快照漂移）", () => {
  // 从 resource_types.json 动态计算期望值，避免手写快照导致 21 次推倒重来
  const rts = resourceTypesJson.resourceTypes as Array<{
    id: string;
    group?: string;
    storageSubDir?: string;
  }>;

  it("所有类型：groupStorageRootOf 与 JSON 派生一致", () => {
    for (const rt of rts) {
      const group = rt.group || "";
      const sub = rt.storageSubDir || rt.id;
      const expected = group ? `${group}/${sub}` : sub;
      expect(groupStorageRootOf(rt.id), `${rt.id} 路径漂移`).toBe(expected);
    }
  });

  it("锚点哨兵：已知类型存储根硬编码钉死（防 JSON 数值漂移）", () => {
    // 派生化只防结构漂移；storageSubDir/group 值被改错时派生循环自证通过，锚点兜底
    const anchors: Array<[string, string]> = [
      ["resourcepack", "minecraft/resourcepacks"],
      ["shaderpack", "minecraft/shaderpacks"],
      ["ysm", "minecraft-mod/ysm"],
      ["maid-model", "minecraft-mod/maid-model"],
      ["EntityPlayer", "mmd/EntityPlayer"],
      ["vrchat-avatar", "mmd/vrchat"],
    ];
    for (const [typeId, want] of anchors) {
      expect(groupStorageRootOf(typeId), `${typeId} 锚点`).toBe(want);
    }
  });

  it("未知 typeId 回退到 typeId 自身", () => {
    expect(groupStorageRootOf("nonexistent")).toBe("nonexistent");
  });

  it("防快照守卫：无废弃壳层前缀", () => {
    const deprecated = ["3d-skin/", "mmd-skin/", "{instance}", "{installDir}"];
    for (const rt of rts) {
      const root = groupStorageRootOf(rt.id);
      for (const prefix of deprecated) {
        expect(root.startsWith(prefix), `${rt.id} 不应含废弃前缀 ${prefix}`).toBe(false);
      }
    }
  });
});

describe("groupLabelOf 分组显示名", () => {
  it("已知分组返回中文名", () => {
    expect(groupLabelOf("minecraft")).toBe("Minecraft 原版");
    expect(groupLabelOf("mmd")).toBe("MMD");
  });

  it("未知分组返回空串", () => {
    expect(groupLabelOf("nonexistent")).toBe("");
    expect(groupLabelOf("")).toBe("");
  });
});