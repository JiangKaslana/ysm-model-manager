/** Wait until the DOM has been upgraded and painted before exposing the native window. */
export async function revealMainWindow(
  show: () => void | Promise<void>,
  nextFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): Promise<void> {
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  }

  await new Promise<void>((resolve) => nextFrame(() => resolve()));
  await new Promise<void>((resolve) => nextFrame(() => resolve()));
  document.documentElement.classList.add("app-ready");

  try {
    await show();
  } catch (error) {
    // Browser development mode has no native Wails window; the CSS reveal above is enough.
    console.debug("[startup] native window show unavailable", error);
  }
}
