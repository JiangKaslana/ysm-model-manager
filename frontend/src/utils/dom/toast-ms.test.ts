// ===== utils/dom/toast-ms 契约测试 =====
// 断言语义档位与实际 duration 值 —— 任何一处档位调整必须同时修本测试，
// 避免「改了常量但消费方仍写死旧数字」的漂移。
import { describe, it, expect } from "vitest";
import { TOAST_MS, type ToastType } from "./toast-ms.ts";

describe("TOAST_MS", () => {
  it("所有档位均为有限正整数（ms）", () => {
    for (const [key, v] of Object.entries(TOAST_MS)) {
      expect(typeof v).toBe("number");
      expect(Number.isFinite(v)).toBe(true);
      expect(v > 0).toBe(true);
      expect(v).toBe(Math.floor(v)); // 整数毫秒，无亚毫秒级
      expect(key).toMatch(/^(quick|success|info|normal|verbose|long|persist|sticky)$/);
    }
  });

  it("8 档全部覆盖，无遗漏 / 无多余", () => {
    expect(Object.keys(TOAST_MS).sort()).toEqual(
      ["info", "long", "normal", "persist", "quick", "sticky", "success", "verbose"],
    );
  });

  it("档位单调递增（语义明确）", () => {
    const entries = Object.entries(TOAST_MS) as [string, number][];
    const ordered = [
      ["quick", 1500],
      ["success", 2000],
      ["info", 2500],
      ["normal", 3000],
      ["verbose", 4000],
      ["long", 5000],
      ["persist", 10000],
      ["sticky", 60000],
    ];
    expect(entries).toEqual(ordered);
  });

  it("ToastType 为四元字面量联合（与 bus ToastPayload.type 对齐）", () => {
    const types: ToastType[] = ["success", "error", "warn", "info"];
    expect(types).toHaveLength(4);
    expect(new Set(types).size).toBe(4);
  });
});
