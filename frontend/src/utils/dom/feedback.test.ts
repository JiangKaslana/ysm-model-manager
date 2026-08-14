// ===== utils/dom/feedback 测试（ADR-021 扩展）=====
// flashBtn：加 flash class、duration 后移除、null 安全、连点防重入、tone 修饰符、非法 duration 回退、
// no-animations 偏好跳过。
import { describe, it, expect, vi, afterEach } from "vitest";
import { flashBtn, FLASH_DURATION_MS } from "./feedback.ts";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove("no-animations");
});

function makeEl() {
  return {
    classList: { add: vi.fn(), remove: vi.fn() },
  } as unknown as HTMLElement;
}

describe("flashBtn", () => {
  it("null 入参不抛错", () => {
    expect(() => flashBtn(null)).not.toThrow();
  });

  it("添加 flash class（默认 success 不加修饰符）", () => {
    const el = makeEl();
    flashBtn(el);
    expect(el.classList.add).toHaveBeenCalledWith("flash");
    expect(el.classList.add).not.toHaveBeenCalledWith("flash--success");
  });

  it("默认时长后移除 flash class", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el);
    vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("自定义 duration 生效", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { duration: 100 });
    vi.advanceTimersByTime(99);
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("非法 duration（NaN）回退默认时长", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { duration: NaN });
    vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("非法 duration（非正数）回退默认时长", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { duration: -1 });
    vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("tone: warn → 追加 flash--warn 并同步移除", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { tone: "warn" });
    expect(el.classList.add).toHaveBeenCalledWith("flash--warn");
    vi.advanceTimersByTime(FLASH_DURATION_MS);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
    expect(el.classList.remove).toHaveBeenCalledWith("flash--warn");
  });

  it("连点防重入：第二次调用重置计时（旧定时器被清，仅移除一次）", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el); // t=0 起 400ms
    vi.advanceTimersByTime(200);
    flashBtn(el); // t=200 重置，新 400ms 至 t=600
    vi.advanceTimersByTime(200); // t=400，距第二次 200ms 未到期
    expect(el.classList.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLASH_DURATION_MS); // t=800，第二次已到期
    expect(el.classList.remove).toHaveBeenCalledTimes(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("no-animations 开启时跳过闪烁（不添加 class）", () => {
    document.documentElement.classList.add("no-animations");
    const el = makeEl();
    flashBtn(el);
    expect(el.classList.add).not.toHaveBeenCalled();
  });

  it("no-animations 关闭后恢复闪烁", () => {
    const el = makeEl();
    flashBtn(el);
    expect(el.classList.add).toHaveBeenCalledWith("flash");
  });
});
