// @vitest-environment node
// ===== UUID 生成测试（uuid.ts）=====
import { describe, it, expect } from "vitest";
import { generateUuid } from "./uuid.ts";

describe("generateUuid — UUID v4 生成", () => {
  it("返回字符串", () => {
    expect(typeof generateUuid()).toBe("string");
  });

  it("符合 UUID v4 格式", () => {
    const uuid = generateUuid();
    // 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("版本号位为 4", () => {
    const uuid = generateUuid();
    expect(uuid[14]).toBe("4");
  });

  it("变体位为 8/9/a/b", () => {
    const uuid = generateUuid();
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });

  it("长度为 36", () => {
    expect(generateUuid().length).toBe(36);
  });

  it("两次调用生成不同 UUID（随机性）", () => {
    const a = generateUuid();
    const b = generateUuid();
    expect(a).not.toBe(b);
  });

  it("批量生成 100 个 UUID 全部格式正确", () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 100; i++) {
      expect(generateUuid()).toMatch(pattern);
    }
  });
});
