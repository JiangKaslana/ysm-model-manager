// ===== preview-library 测试：_openers 注册表一致性 =====
// 审核 P3：验证所有 preview="3d" 的资源类型要么有 3D opener，要么在显式豁免列表中。
// 各 createXxx3D 包装器在模块加载时 registerReRoute，测试通过 import 触发注册。
//
// 派生化原则：NO_3D_TYPES / NEED_3D_TYPES 全部从 resource_types.json preview 字段
// 单一事实来源派生，禁止手写快照——新增资源类型只改 JSON 即可自动纳入测试覆盖。

import { describe, it, expect } from "vitest";
import { ALL_RESOURCE_TYPES, NO_3D_TYPES } from "../../utils/resource/types.ts";
import { getRegisteredRoutes } from "./preview-library.ts";

// 触发注册（import 即有 side effect：模块加载时调用 registerReRoute）
import "./ysm-3d.ts";
import "./mmd-3d.ts";
import "./vrm-3d.ts";
import "./pack-3d.ts";
import "./litematic-3d.ts"; // 投影/蓝图已注册 opener
import "./scene-3d.ts"; // 场景模型已注册 opener (SceneModel)
import "./maid-3d.ts"; // 车万女仆已注册 opener (maid-model)

describe("preview-library _openers 注册表一致性", () => {
  it("所有 preview='3d' 的类型要么有 3D opener，要么在 NO_3D_TYPES 豁免列表中", () => {
    const registered = new Set(getRegisteredRoutes());
    // 派生：preview 字段 !== "3d" 的类型即为需豁免的集合（单一事实来源）
    const need3d = new Set(ALL_RESOURCE_TYPES.filter((id) => !NO_3D_TYPES.has(id)));
    const missing: string[] = [];

    for (const rtype of need3d) {
      if (!registered.has(rtype)) {
        missing.push(rtype);
      }
    }

    expect(missing, `preview=3d 但缺少 3D opener 的类型: ${missing.join(", ")}`).toEqual([]);
  });

  it("已注册的 opener 类型全部在已知资源类型列表中", () => {
    const known = new Set(ALL_RESOURCE_TYPES);
    const registered = getRegisteredRoutes();
    const unknown = registered.filter((t) => !known.has(t));

    expect(unknown, `已注册但不在已知类型列表中的类型: ${unknown.join(", ")}`).toEqual([]);
  });

  it("preview=none 的类型不应注册 3D opener", () => {
    const registered = new Set(getRegisteredRoutes());
    // mmd-shader 是 preview=none 的唯一类型，绝对不应有 3D opener
    const absolutelyNo3d = ALL_RESOURCE_TYPES.filter(
      (id) => NO_3D_TYPES.has(id) && id !== "resourcepack" && id !== "shaderpack",
    );
    const overlap = absolutelyNo3d.filter((t) => registered.has(t));

    expect(overlap, `preview=none 但注册了 3D opener 的类型: ${overlap.join(", ")}`).toEqual([]);
  });
});
