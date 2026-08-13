// ===== 设置页：3D 预览操作（ADR-040 拆分自 init.ts）=====
// 持久化于 localStorage，与 model3d.ts 同源。
// _activeCapture 随本段迁移（原 init.ts 模块级）：单一捕获守卫——同一时刻仅允许
// 一个键位捕获，且设置页卸载后自动失效，杜绝全局 keydown 劫持。
import { bus } from "../../../bus.ts";
import { loadTdKeymap, type TdKeyAction } from "../../../utils/3d/model3d.ts";
import { safeGet, safeSet, safeRemove } from "../../../utils/dom/storage.ts";

// 单一捕获守卫：同一时刻仅允许一个键位捕获，且设置页卸载后自动失效，杜绝全局 keydown 劫持
let _activeCapture: ((e: KeyboardEvent) => void) | null = null;

const TD_ACTIONS: Array<{ key: TdKeyAction; label: string }> = [
  { key: "forward", label: "前移" },
  { key: "back", label: "后移" },
  { key: "left", label: "左移" },
  { key: "right", label: "右移" },
  { key: "up", label: "上升" },
  { key: "down", label: "下降" },
];

const tdKeyLabel = (code: string): string => {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  const map: Record<string, string> = {
    Space: "空格",
    ShiftLeft: "Shift",
    ShiftRight: "Shift(右)",
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl(右)",
    AltLeft: "Alt",
    AltRight: "Alt(右)",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "⌫",
  };
  return map[code] || code;
};

const tdSaveKeymap = (km: Record<TdKeyAction, string>): void => {
safeSet("td-keymap", JSON.stringify(km));
};

function tdRenderKeymap(root: ShadowRoot): void {
  // 重建网格前取消任何进行中的捕获，避免叠加/残留
  if (_activeCapture) {
    document.removeEventListener("keydown", _activeCapture, true);
    _activeCapture = null;
  }
  const grid = root.getElementById("td-keymap-grid");
  if (!grid) return;
  const km = loadTdKeymap();
  grid.innerHTML = "";
  TD_ACTIONS.forEach(({ key, label }) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-sm)";
    const name = document.createElement("span");
    name.textContent = label;
    name.style.color = "var(--muted)";
    const btn = document.createElement("button");
    btn.className = "btn-base sm";
    btn.textContent = tdKeyLabel(km[key]);
    btn.style.minWidth = "64px";
    btn.addEventListener("click", () => {
      // 取消上一次未完成的捕获，保证同一时刻仅一个
      if (_activeCapture) {
        document.removeEventListener("keydown", _activeCapture, true);
        _activeCapture = null;
      }
      btn.textContent = "按键…";
      const onKey = (ev: KeyboardEvent): void => {
        // 设置页已卸载（grid 不存在）则放弃捕获，先判后拦截，杜绝全局 keydown 劫持
        if (!root.getElementById("td-keymap-grid")) {
          document.removeEventListener("keydown", onKey, true);
          _activeCapture = null;
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener("keydown", onKey, true);
        _activeCapture = null;
        if (ev.code === "Escape") {
          tdRenderKeymap(root);
          return;
        }
        const cur = loadTdKeymap();
        const conflict = TD_ACTIONS.find((a) => a.key !== key && cur[a.key] === ev.code);
        if (conflict) {
          bus.emit("toast:show", {
            msg: `⚠️ ${tdKeyLabel(ev.code)} 已被「${conflict.label}」占用`,
            duration: 2500,
            type: "warn",
          });
          tdRenderKeymap(root);
          return;
        }
        cur[key] = ev.code;
        tdSaveKeymap(cur);
        tdRenderKeymap(root);
          bus.emit("toast:show", {
            msg: `✅ ${label} → ${tdKeyLabel(ev.code)}`,
            duration: 1500,
            type: "success",
          });
      };
      _activeCapture = onKey;
      document.addEventListener("keydown", onKey, true);
    });
    row.appendChild(name);
    row.appendChild(btn);
    grid.appendChild(row);
  });
}

/** 初始化 3D 预览操作：键位网格 + 恢复默认 + 相机速度 + 默认旋转模式 */
export function initKeymap(root: ShadowRoot): void {
  tdRenderKeymap(root);
  root.getElementById("td-keymap-reset")?.addEventListener("click", () => {
    safeRemove("td-keymap");
    tdRenderKeymap(root);
    bus.emit("toast:show", {
      msg: "↩️ 已恢复默认键位",
      duration: 1500,
      type: "success",
    });
  });

  // 相机移动速度
  const csEl = root.getElementById("td-camspeed") as HTMLInputElement | null;
  const csVal = root.getElementById("td-camspeed-val");
  if (csEl) {
    csEl.value = safeGet("td-cam-speed") || "20";
    if (csVal) csVal.textContent = csEl.value;
    csEl.addEventListener("input", () => {
      if (csVal) csVal.textContent = csEl!.value;
safeSet("td-cam-speed", csEl!.value);
    });
  }
  // 默认旋转模式
  const rmEl = root.getElementById("td-rotmode") as HTMLSelectElement | null;
  if (rmEl) {
    rmEl.value = safeGet("td-rot-mode") === "free" ? "free" : "orbit";
    rmEl.addEventListener("change", () => {
safeSet("td-rot-mode", rmEl.value);
    });
  }
}