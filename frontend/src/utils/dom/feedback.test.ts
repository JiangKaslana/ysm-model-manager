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
    expect(el.classList.remove).not.toHaveBeenCalledWith("flash");
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("自定义 duration 生效", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { duration: 100 });
    vi.advanceTimersByTime(99);
    expect(el.classList.remove).not.toHaveBeenCalledWith("flash");
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("非法 duration（NaN）回退默认时长", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { duration: NaN });
    vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    expect(el.classList.remove).not.toHaveBeenCalledWith("flash");
    vi.advanceTimersByTime(1);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("非法 duration（非正数）回退默认时长", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { duration: -1 });
    vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    expect(el.classList.remove).not.toHaveBeenCalledWith("flash");
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

  it("tone: error → 追加 flash--error 并同步移除", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { tone: "error" });
    expect(el.classList.add).toHaveBeenCalledWith("flash--error");
    vi.advanceTimersByTime(FLASH_DURATION_MS);
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
    expect(el.classList.remove).toHaveBeenCalledWith("flash--error");
  });

  it("跨 tone 连点：warn→success 清除旧 flash--warn 残留（P2 回归锁）", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el, { tone: "warn" }); // 旧定时器已清，旧修饰符必须被 add 前清除
    flashBtn(el); // 切回 success
    expect(el.classList.remove).toHaveBeenCalledWith("flash--warn");
    vi.advanceTimersByTime(FLASH_DURATION_MS);
    // 回调统一移除三者，最终无残留
    expect(el.classList.remove).toHaveBeenCalledWith("flash");
    expect(el.classList.remove).toHaveBeenCalledWith("flash--warn");
    expect(el.classList.remove).toHaveBeenCalledWith("flash--error");
  });

  it("多元素并发：各自独立计时收尾", () => {
    vi.useFakeTimers();
    const elA = makeEl();
    const elB = makeEl();
    flashBtn(elA);
    flashBtn(elB);
    vi.advanceTimersByTime(FLASH_DURATION_MS);
    expect(elA.classList.remove).toHaveBeenCalledWith("flash");
    expect(elB.classList.remove).toHaveBeenCalledWith("flash");
  });

  it("连点防重入：第二次调用重置计时（旧定时器被清，仅移除一次）", () => {
    vi.useFakeTimers();
    const el = makeEl();
    flashBtn(el); // t=0 起 400ms
    vi.advanceTimersByTime(200);
    flashBtn(el); // t=200 重置，新 400ms 至 t=600
    vi.advanceTimersByTime(200); // t=400，距第二次 200ms 未到期
    expect(el.classList.remove).not.toHaveBeenCalledWith("flash");
    vi.advanceTimersByTime(FLASH_DURATION_MS); // t=800，第二次已到期
    // "flash" 仅被移除一次（旧定时器已清，只有新定时器回调触发）
    const removeMock = el.classList.remove as unknown as { mock: { calls: string[][] } };
    const flashRemovals = removeMock.mock.calls.filter((c) => c[0] === "flash").length;
    expect(flashRemovals).toBe(1);
  });

  it("no-animations 开→关恢复闪烁（真实序列）", () => {
    vi.useFakeTimers();
    const el = makeEl();
    document.documentElement.classList.add("no-animations");
    flashBtn(el);
    expect(el.classList.add).not.toHaveBeenCalled();
    document.documentElement.classList.remove("no-animations");
    flashBtn(el);
    expect(el.classList.add).toHaveBeenCalledWith("flash");
  });
});
