import { describe, it, expect } from "vitest";
import { extractAnimGroupsAndConfigs, type YsmProperties } from "./ysm-anim-config.ts";

describe("extractAnimGroupsAndConfigs", () => {
  it("分类组：提取组名与动画项", () => {
    const p: YsmProperties = {
      extra_animation: { "#extra0": "模型配置", 打招呼: "打招呼", 点头: "点头" },
      extra_animation_classify: [
        { id: "extra0", name: "其他动画", extra_animation: { 打招呼: "打招呼", 点头: "点头" } },
      ],
      extra_animation_buttons: [{ id: "btn0", name: "模型配置" }],
    };
    const { animGroups, configMenus } = extractAnimGroupsAndConfigs(p);
    expect(animGroups).toHaveLength(1);
    expect(animGroups[0].name).toBe("其他动画");
    expect(animGroups[0].items).toEqual(["打招呼", "点头"]);
    expect(configMenus).toEqual([{ id: "btn0", name: "模型配置" }]);
  });

  it("组名为空时按 #id 回查 extra_animation 取中文名", () => {
    const p: YsmProperties = {
      extra_animation: { "#extra0": "表情组" },
      extra_animation_classify: [
        { id: "extra0", extra_animation: { 自定义表情1: "自定义表情1" } },
      ],
    };
    const { animGroups } = extractAnimGroupsAndConfigs(p);
    expect(animGroups[0].name).toBe("表情组");
    expect(animGroups[0].items).toEqual(["自定义表情1"]);
  });

  it("未分类的松散动画兜底归入「其他动画」组", () => {
    const p: YsmProperties = {
      extra_animation: { 打招呼: "打招呼", 点头: "点头" },
      extra_animation_classify: [],
    };
    const { animGroups } = extractAnimGroupsAndConfigs(p);
    expect(animGroups).toHaveLength(1);
    expect(animGroups[0].name).toBe("其他动画");
    expect(animGroups[0].items).toEqual(["打招呼", "点头"]);
  });

  it("整组皆内部引用（# 开头）时跳过该组", () => {
    const p: YsmProperties = {
      extra_animation: { "#extra0": "模型配置" },
      extra_animation_classify: [
        { id: "extra0", name: "空组", extra_animation: { "#inner": "#inner" } },
      ],
    };
    const { animGroups } = extractAnimGroupsAndConfigs(p);
    expect(animGroups).toHaveLength(0);
  });

  it("properties 为 null/undefined → 返回空数组", () => {
    expect(extractAnimGroupsAndConfigs(null).animGroups).toEqual([]);
    expect(extractAnimGroupsAndConfigs(undefined).configMenus).toEqual([]);
  });

  it("按钮配置菜单：每个按钮即一项（含基础/细节配置）", () => {
    const p: YsmProperties = {
      extra_animation_buttons: [
        { id: "b1", name: "模型配置" },
        { id: "b2", name: "自定义表情1基础配置" },
        { id: "b3", name: "自定义表情1细节配置" },
      ],
    };
    const { configMenus } = extractAnimGroupsAndConfigs(p);
    expect(configMenus.map((c) => c.name)).toEqual([
      "模型配置",
      "自定义表情1基础配置",
      "自定义表情1细节配置",
    ]);
  });
});
