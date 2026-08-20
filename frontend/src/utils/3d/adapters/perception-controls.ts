// ===== 感知层控件面板（ADR-076：底部根菜单 motion 组）=====
// 对齐 camera-controls.ts 模式：export buildPerceptionControls(list, state) 渲染开关行。
// 感知模块按需显示：有语义骨骼才显示对应开关（无 chest 骨 → 呼吸开关隐藏）。
import { t } from "../../../core/i18n/t.ts";

/** 感知层状态：各模块开关（adapter build 时创建，update 循环读取，面板 UI 写入） */
export interface PerceptionState {
  breath: boolean;
  gaze: boolean;
  blink: boolean;
  lipSync: boolean;
  autoDance: boolean;
}

/** 可用感知模块描述（由 adapter 按实际能力填写） */
export interface PerceptionCapability {
  id: keyof PerceptionState;
  labelKey: string;
  fallback: string;
}

/** 所有可能的感知模块（fallback 文案，i18n 缺失时使用） */
const ALL_MODULES: Array<{ id: keyof PerceptionState; labelKey: string; fallback: string }> = [
  { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
  { id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" },
  { id: "blink", labelKey: "preview.perceptionBlink", fallback: "眨眼" },
  { id: "lipSync", labelKey: "preview.perceptionLipSync", fallback: "口型" },
  { id: "autoDance", labelKey: "preview.perceptionAutoDance", fallback: "律动" },
];

/**
 * 在感知面板内渲染开关行（对齐 camera-controls.ts 范式）。
 * @param list   面板 DOM 容器
 * @param state  感知状态（读写双向绑定）
 * @param caps   该适配器实际可用的模块列表（按需裁剪）
 */
export function buildPerceptionControls(
  list: HTMLElement,
  state: PerceptionState,
  caps: PerceptionCapability[],
): void {
  // 按 ALL_MODULES 顺序排列（保证跨适配器顺序一致）
  const ordered = ALL_MODULES.filter((m) => caps.some((c) => c.id === m.id));

  if (ordered.length === 0) {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = t("preview.noPerception");
    list.appendChild(row);
    return;
  }

  for (const mod of ordered) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";

    const label = document.createElement("span");
    label.style.cssText = "flex:1;font-size:12px;color:rgba(255,255,255,0.85)";
    label.textContent = t(mod.labelKey);
    row.appendChild(label);

    const toggle = document.createElement("button");
    toggle.style.cssText =
      "width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;position:relative;transition:background .2s";
    const updateToggleStyle = (): void => {
      toggle.style.background = state[mod.id] ? "var(--accent,#7c83ff)" : "rgba(255,255,255,0.2)";
    };
    updateToggleStyle();

    const knob = document.createElement("span");
    knob.style.cssText =
      "position:absolute;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s";
    const updateKnob = (): void => {
      knob.style.left = state[mod.id] ? "18px" : "2px";
    };
    updateKnob();
    toggle.appendChild(knob);

    toggle.onclick = (): void => {
      state[mod.id] = !state[mod.id];
      updateToggleStyle();
      updateKnob();
    };

    row.appendChild(toggle);
    list.appendChild(row);
  }
}
