import { Call as $Call } from "@wailsio/runtime";
import { bus } from "../bus.ts";
import { getApp } from "../backend/app.ts";
import { pickDirectory } from "../utils/dom/directory-picker.ts";
import { esc } from "../utils/dom/html.ts";
import { saveCfg } from "../views/app-content/settings/path-cards.ts";
import { cfg, cardRefreshers, isBusy, setBusy, toastError } from "../views/app-content/settings/store.ts";

interface LauncherInstance {
  launcher: string;
  name: string;
  gameVersion: string;
  gameRoot: string;
  gameDir: string;
  customDir: string;
  exists: boolean;
}

interface LauncherSelection {
  instance: LauncherInstance;
  useAsYsmRoot: boolean;
}

function detectLauncherInstances(launcherDir: string): Promise<LauncherInstance[] | null> {
  // Keep this small runtime shim until the next Wails binding regeneration.
  return $Call.ByID(2842612456, launcherDir) as unknown as Promise<LauncherInstance[] | null>;
}

function showLauncherInstancePicker(instances: LauncherInstance[]): Promise<LauncherSelection | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.dataset.launcherPicker = "1";
    overlay.style.cssText = "position:fixed;z-index:100000;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:12px;padding:16px;max-width:720px;width:92%;max-height:78vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);color:var(--txt,#cdd6f4)";
    const rows = instances.map((instance, index) => `
      <button data-launcher-instance="${index}" style="display:block;width:100%;text-align:left;margin:6px 0;padding:10px;border:1px solid var(--bd,#444);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-family:inherit">
        <div style="display:flex;justify-content:space-between;gap:8px;font-weight:600">
          <span>${esc(instance.launcher)} · ${esc(instance.name)}</span>
          <span style="color:var(--accent,#89b4fa)">${esc(instance.gameVersion)}</span>
        </div>
        <div style="font-size:10px;color:var(--muted,#888);margin-top:5px">Game: ${esc(instance.gameDir)}</div>
        <div style="font-size:10px;color:${instance.exists ? "var(--status-success,#a6e3a1)" : "var(--muted,#888)"};margin-top:2px">YSM: ${esc(instance.customDir)}${instance.exists ? "" : " · pending"}</div>
      </button>`).join("");
    box.innerHTML = `<div style="font-weight:650;font-size:14px">🎮 HMCL / PCL</div>
      <div style="font-size:10px;color:var(--muted,#888);margin:5px 0 10px">Select a Minecraft instance and its YSM custom directory.</div>
      ${rows}
      <label style="display:flex;align-items:center;gap:7px;margin-top:10px;font-size:11px"><input data-launcher-default type="checkbox" checked> Use YSM custom directory as default download path</label>
      <div style="margin-top:12px;text-align:right"><button data-launcher-cancel class="btn-base sm">Cancel</button></div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelectorAll<HTMLElement>("[data-launcher-instance]").forEach((row) => {
      row.addEventListener("click", () => {
        const index = Number(row.dataset.launcherInstance || "0");
        const useAsYsmRoot = !!box.querySelector<HTMLInputElement>("[data-launcher-default]")?.checked;
        overlay.remove();
        resolve(instances[index] ? { instance: instances[index], useAsYsmRoot } : null);
      });
    });
    box.querySelector("[data-launcher-cancel]")?.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
  });
}

async function handleLauncherDetect(): Promise<void> {
  if (isBusy()) return;
  setBusy(true);
  try {
    const launcherDir = await pickDirectory();
    if (!launcherDir) return;
    const instances = await detectLauncherInstances(launcherDir);
    if (!instances?.length) {
      bus.emit("toast:show", { msg: "No HMCL/PCL Minecraft instance found", duration: 3500, type: "warn" });
      return;
    }
    const selection = await showLauncherInstancePicker(instances);
    if (!selection) return;

    const previousMcRoot = cfg?.mcRoot || "";
    await saveCfg({ mcRoot: selection.instance.gameRoot });
    if (selection.useAsYsmRoot) {
      try {
        const { SetResourceRoot } = await getApp();
        await SetResourceRoot("ysm", selection.instance.customDir);
      } catch (error) {
        await saveCfg({ mcRoot: previousMcRoot });
        throw error;
      }
      const mutableCfg = cfg as unknown as Record<string, unknown>;
      mutableCfg.ysmRoot = selection.instance.customDir;
      const customRoots = (mutableCfg.customRoots as Record<string, string> | undefined) || {};
      customRoots.ysm = selection.instance.customDir;
      mutableCfg.customRoots = customRoots;
    }
    cardRefreshers.forEach((refresh) => refresh());
    bus.emit("stats:refresh");
    bus.emit("toast:show", {
      msg: `✅ ${selection.instance.launcher} · Minecraft ${selection.instance.gameVersion}`,
      duration: 3000,
      type: "success",
    });
  } catch (error) {
    toastError(error);
  } finally {
    setBusy(false);
  }
}

function installIntoSettings(root: ShadowRoot): void {
  const anchor = root.getElementById("set-mc-detect");
  if (!anchor || root.getElementById("set-launcher-detect")) return;
  const button = document.createElement("button");
  button.id = "set-launcher-detect";
  button.className = "btn-base sm";
  button.textContent = "🎮 HMCL / PCL";
  button.style.marginRight = "5px";
  button.addEventListener("click", () => void handleLauncherDetect());
  anchor.parentElement?.insertBefore(button, anchor);
}

/** Install a low-conflict launcher detector into the settings view.
 * A MutationObserver keeps it available after language/theme rerenders. */
export function registerLauncherDetection(): void {
  if (typeof document === "undefined") return;
  const attach = (): void => {
    const host = document.querySelector("app-content") as HTMLElement | null;
    const root = host?.shadowRoot;
    if (!root) return;
    installIntoSettings(root);
    const observer = new MutationObserver(() => installIntoSettings(root));
    observer.observe(root, { childList: true, subtree: true });
  };
  queueMicrotask(attach);
}
