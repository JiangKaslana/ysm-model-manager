// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { revealMainWindow } from "./startup-reveal.ts";

describe("startup reveal", () => {
  it("reveals the native window only after two painted frames", async () => {
    const frames: FrameRequestCallback[] = [];
    const show = vi.fn();
    document.documentElement.classList.remove("app-ready");

    const pending = revealMainWindow(show, (callback) => {
      frames.push(callback);
      return frames.length;
    });

    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
    frames.shift()?.(0);
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
    frames.shift()?.(16);
    await pending;

    expect(document.documentElement.classList.contains("app-ready")).toBe(true);
    expect(show).toHaveBeenCalledOnce();
  });
});
