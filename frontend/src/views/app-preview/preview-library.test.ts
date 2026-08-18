// ===== preview-library 测试：_openers 覆盖率 + 注册表一致性 =====
// 审核 P3：验证所有已知资源类型要么有 3D opener，要么在显式豁免列表中。
// 各 createXxx3D 包装器在模块加载时 registerReRoute，测试通过 import 触发注册。
//
// 资源库列表（loadAllModels/多仓库聚合）已移除：3D 内切换模型走 mount-preview-core
// 的 opts.siblings（同目录兄弟）轻量路径，不再全量扫描各仓库。

import { describe, it, expect } from "vitest";
import { ALL_RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getRegisteredRoutes } from "./preview-library.ts";

// 触发注册（import 即有 side effect：模块加载时调用 registerReRoute）
import "./ysm-3d.ts";
import "./mmd-3d.ts";
import "./vrm-3d.ts";
import "./pack-3d.ts";

/** 已知无 3D 预览能力的资源类型（走 YSM 兜底回退或 toast 提示） */
const NO_3D_TYPES = new Set<string>([
  "shaderpack",
  "create-blueprint",
  "litematic",
]);

describe("preview-library _openers 覆盖率", () => {
  it("所有已知资源类型要么有 3D opener，要么在豁免列表中", () => {
    const registered = new Set(getRegisteredRoutes());
    const missing: string[] = [];

    for (const rtype of ALL_RESOURCE_TYPES) {
      if (!registered.has(rtype) && !NO_3D_TYPES.has(rtype)) {
        missing.push(rtype);
      }
    }

    expect(missing, `缺少 3D opener 且未豁免的类型: ${missing.join(", ")}`).toEqual([]);
  });

  it("已注册的 opener 类型全部在已知资源类型列表中", () => {
    const known = new Set(ALL_RESOURCE_TYPES);
    const registered = getRegisteredRoutes();
    const unknown = registered.filter((t) => !known.has(t));

    expect(unknown, `已注册但不在已知类型列表中的类型: ${unknown.join(", ")}`).toEqual([]);
  });

  it("已注册的 opener 类型与豁免列表无交集（豁免 = 暂无 3D，不应有注册）", () => {
    const registered = new Set(getRegisteredRoutes());
    const overlap = [...NO_3D_TYPES].filter((t) => registered.has(t));

    expect(overlap, `既在豁免列表又有注册的类型: ${overlap.join(", ")}`).toEqual([]);
  });
});
