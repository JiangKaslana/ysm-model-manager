// ===== 资源类型映射测试（ADR-021 扩展）=====
// TS 常量（RESOURCE_TYPES/LABELS/ALL）与 resource_types.json（单一事实来源）对账。
import { describe, it, expect } from "vitest";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  ALL_RESOURCE_TYPES,
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
    expect(RESOURCE_TYPE_LABELS["ysm"]).toBe("模型");
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
