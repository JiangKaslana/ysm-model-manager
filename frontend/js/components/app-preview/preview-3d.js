import { cacheGet } from "../../utils/preview-cache.js";
import {
  evaluateClip,
  evaluateMolangExpression,
  parseBedrockAnimationJSON,
} from "../../utils/animation.js";
import { AnimationPlayer } from "../../utils/animation-player.js";
import { setPrefer3D } from "./preview-utils.js";
import { applyModelVariant } from "./utils.js";
import {
  applyOpenYsmExpression,
  buildOpenYsmActionOptions,
  buildOpenYsmDefaultVariables,
  buildOpenYsmShapeControls,
} from "./openysm-bundle.js";

function escText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function clipLabel(name) {
  const text = String(name || "animation")
    .replace(/^animation\./, "")
    .replace(/^ysm\./, "");
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
}

function sourceName(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.\w+$/, "");
}

function variantLabel(variant, index) {
  const raw =
    variant?.name ||
    variant?.identifier ||
    sourceName(variant?.source) ||
    `形态 ${index + 1}`;
  const name =
    String(raw).toLowerCase() === "unknown"
      ? sourceName(variant?.source) || `形态 ${index + 1}`
      : raw;
  const count = variant?.cubeCount ? ` · ${variant.cubeCount} 方块` : "";
  return `${index + 1}. ${name}${count}`;
}

function addClipOnce(out, seen, clip) {
  if (!clip?.bones || !clip.name) return;
  const key = `${clip.name}:${clip.length || 0}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(clip);
}

function collectClipsFromValue(out, seen, value) {
  if (!value) return;
  if (typeof value === "string") {
    const { clips } = parseBedrockAnimationJSON(value);
    clips.forEach((clip) => addClipOnce(out, seen, clip));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectClipsFromValue(out, seen, item));
    return;
  }
  if (value.clips) {
    collectClipsFromValue(out, seen, value.clips);
    return;
  }
  if (value.animations && typeof value.animations === "object" && !value.bones) {
    collectClipsFromValue(out, seen, JSON.stringify(value));
    return;
  }
  addClipOnce(out, seen, value);
}

function resolveAnimationClips(model) {
  const clips = [];
  const seen = new Set();
  collectClipsFromValue(clips, seen, model?.animations);
  collectClipsFromValue(clips, seen, model?._animations);
  collectClipsFromValue(clips, seen, model?._animationClips);
  if (model?._modelPath) {
    const cached = cacheGet(model._modelPath);
    collectClipsFromValue(clips, seen, cached?.animations);
    collectClipsFromValue(clips, seen, cached?.geometry?.animations);
    collectClipsFromValue(clips, seen, cached?.geometry?._animationClips);
  }
  return clips;
}

function getOpenYsmMeta(model) {
  if (model?._openYsm) return model._openYsm;
  if (!model?._modelPath) return null;
  const cached = cacheGet(model._modelPath);
  return cached?.openYsm || cached?.geometry?._openYsm || null;
}

function applyOpenYsmActionLabels(openYsm, clips) {
  const actions = buildOpenYsmActionOptions(openYsm, clips);
  if (!actions.length) return clips;

  const out = [];
  const seen = new Set();
  for (const action of actions) {
    if (!action.clip) continue;
    const key = `${action.clip.name}:${action.clip.length || 0}`;
    seen.add(key);
    out.push({
      ...action.clip,
      _actionLabel: action.label,
      _actionGroup: action.group,
      _matchedClip: action.matchedClip,
    });
  }
  for (const clip of clips) {
    const key = `${clip.name}:${clip.length || 0}`;
    if (!seen.has(key)) out.push(clip);
  }
  return out;
}

function hasScaleChannels(clip) {
  return Object.values(clip?.bones || {}).some((channels) => channels?.scale?.length);
}

function normalizeAnimKey(value) {
  return String(value || "")
    .trim()
    .replace(/^animation\./, "")
    .replace(/^controller\.animation\./, "")
    .replace(/^controller\./, "")
    .replace(/^ysm\./, "")
    .toLowerCase();
}

function sameAnimKey(a, b) {
  return normalizeAnimKey(a) === normalizeAnimKey(b);
}

function findClipByName(clips, name) {
  const key = normalizeAnimKey(name);
  if (!key) return null;
  return (
    clips.find((clip) => normalizeAnimKey(clip.name) === key) ||
    clips.find((clip) => normalizeAnimKey(clip.name).endsWith(`.${key}`)) ||
    clips.find((clip) => normalizeAnimKey(clip.name).split(".").pop() === key) ||
    null
  );
}

function findState(states, name) {
  const key = normalizeAnimKey(name);
  if (!key) return null;
  return states.find((state) => normalizeAnimKey(state.name) === key) || null;
}

function evalCondition(expr, variables) {
  const text = String(expr ?? "").trim();
  if (!text) return false;
  if (text === "1" || text.toLowerCase() === "true") return true;
  return Math.abs(evaluateMolangExpression(text, { variables }, 0)) > 0.0001;
}

function resolveControllerStates(openYsm, variables) {
  const out = [];
  for (const controller of openYsm?.controllers || []) {
    const states = controller.states || [];
    if (!states.length) continue;
    let state =
      findState(states, controller.initialState) ||
      findState(states, "default") ||
      states[0];

    for (let guard = 0; guard < 8 && state?.transitions?.length; guard++) {
      const next = state.transitions.find((transition) =>
        evalCondition(transition.expr, variables || {}),
      );
      if (!next) break;
      const nextState = findState(states, next.target);
      if (!nextState || nextState === state) break;
      state = nextState;
    }

    out.push({ controller, state });
  }
  return out;
}

function applyControllerEntryScripts(openYsm, variables) {
  if (!openYsm?.controllers?.length) return variables || {};
  let next = { ...(variables || {}) };
  for (const { state } of resolveControllerStates(openYsm, next)) {
    for (const script of state?.onEntry || []) {
      next = applyOpenYsmExpression(next, script, null, openYsm);
    }
  }
  return next;
}

function resolveControllerPoseClips(openYsm, clips, variables) {
  if (!openYsm?.controllers?.length || !clips?.length) return [];
  const out = [];
  const seen = new Set();
  const addClip = (name) => {
    const clip = findClipByName(clips, name);
    if (!clip || seen.has(clip.name)) return;
    seen.add(clip.name);
    out.push(clip);
  };

  for (const { state } of resolveControllerStates(openYsm, variables || {})) {
    const slots =
      state?.animationSlots?.length
        ? state.animationSlots
        : (state?.animations || []).map((name) => ({ name, expr: "" }));
    for (const slot of slots) {
      if (slot?.expr && !evalCondition(slot.expr, variables || {})) continue;
      addClip(slot?.name || slot);
    }
  }

  if (!out.length) {
    for (const clip of clips) {
      const key = normalizeAnimKey(clip.name).split(".").pop();
      if (!["default", "init", "initial", "base"].includes(key)) continue;
      if (!hasScaleChannels(clip) && !clip.hasMolang) continue;
      addClip(clip.name);
    }
  }
  return out;
}

function mergeTransforms(base, overlay) {
  const out = new Map();
  const copy = (value) => ({
    ...(value || {}),
    rotation: value?.rotation ? [...value.rotation] : undefined,
    position: value?.position ? [...value.position] : undefined,
    scale: value?.scale ? [...value.scale] : undefined,
  });
  for (const [name, t] of base || []) out.set(name, copy(t));
  for (const [name, t] of overlay || []) {
    const prev = out.get(name) || {};
    out.set(name, {
      rotation: t.rotation ? [...t.rotation] : prev.rotation,
      position: t.position ? [...t.position] : prev.position,
      scale: t.scale ? [...t.scale] : prev.scale,
    });
  }
  return out;
}

function clipsForModel(clips, model) {
  const boneNames = new Set((model?.bones || []).map((bone) => bone.name).filter(Boolean));
  if (!boneNames.size) return clips;

  const scored = clips.map((clip) => {
    const names = Object.keys(clip?.bones || {});
    const matched = names.filter((name) => boneNames.has(name)).length;
    return { clip, matched, total: names.length };
  });
  const usable = scored.filter((item) => item.matched > 0);
  return (usable.length ? usable : scored).map((item) => ({
    ...item.clip,
    _matchedBones: item.matched,
    _totalBones: item.total,
  }));
}

function buttonStyle(minWidth = 36) {
  return [
    "height:46px",
    `min-width:${minWidth}px`,
    "padding:0 18px",
    "border-radius:8px",
    "border:1px solid rgba(148,163,184,0.32)",
    "background:linear-gradient(180deg,rgba(23,32,50,0.92),rgba(13,19,32,0.86))",
    "color:rgba(248,250,252,0.96)",
    "font:700 14px/1 system-ui,-apple-system,Segoe UI,sans-serif",
    "cursor:pointer",
    "box-shadow:0 12px 28px rgba(0,0,0,0.26)",
  ].join(";");
}

function selectShellStyle(width = 150) {
  return [
    "position:relative",
    `width:${width}px`,
    `min-width:${Math.min(width, 180)}px`,
    "height:46px",
    "display:inline-block",
    "flex:0 0 auto",
    "z-index:22",
  ].join(";");
}

function selectTriggerStyle() {
  return [
    buttonStyle(0),
    "width:100%",
    "height:46px",
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:12px",
    "box-sizing:border-box",
    "text-align:left",
  ].join(";");
}

let activeOverlaySelect = null;

function createOverlaySelect({ width = 150, value = "", options = [], title = "" } = {}) {
  const root = document.createElement("div");
  root.className = "ysm-select";
  root.style.cssText = selectShellStyle(width);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ysm-select-trigger";
  trigger.style.cssText = selectTriggerStyle();

  const label = document.createElement("span");
  label.className = "ysm-select-label";
  label.style.cssText =
    "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f8fafc";
  trigger.appendChild(label);

  const caret = document.createElement("span");
  caret.className = "ysm-select-caret";
  caret.textContent = "▾";
  caret.style.cssText = "flex:0 0 auto;color:rgba(226,232,240,0.9)";
  trigger.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "ysm-select-menu";
  menu.hidden = true;

  let selectedValue = String(value ?? "");
  let optionList = [];

  const close = () => {
    root.classList.remove("open");
    menu.hidden = true;
    if (activeOverlaySelect === root) activeOverlaySelect = null;
  };
  const open = () => {
    if (activeOverlaySelect && activeOverlaySelect !== root) activeOverlaySelect.close();
    activeOverlaySelect = root;
    root.classList.add("open");
    menu.hidden = false;
    setTimeout(() => {
      const onDocPointer = (event) => {
        if (!root.contains(event.target)) close();
      };
      document.addEventListener("pointerdown", onDocPointer, { once: true });
    }, 0);
  };

  const updateLabel = () => {
    const selected = optionList.find((item) => String(item.value) === selectedValue);
    label.textContent = selected?.label || "";
    trigger.title = selected?.title || title || selected?.label || "";
    for (const child of menu.children) {
      child.classList.toggle("active", child.dataset.value === selectedValue);
    }
  };

  const renderOptions = () => {
    menu.innerHTML = "";
    for (const option of optionList) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ysm-select-option";
      item.dataset.value = String(option.value);
      item.textContent = option.label;
      item.title = option.title || option.label;
      item.disabled = !!option.disabled;
      item.onclick = () => {
        if (item.disabled) return;
        selectedValue = item.dataset.value;
        updateLabel();
        close();
        root.onchange?.({ target: root });
        root.dispatchEvent(new Event("change"));
      };
      menu.appendChild(item);
    }
    updateLabel();
  };

  root.setOptions = (nextOptions = []) => {
    optionList = nextOptions.map((item) => ({
      value: String(item?.value ?? ""),
      label:
        String(item?.label ?? "").trim() ||
        String(item?.title ?? "").trim() ||
        String(item?.value ?? "").trim() ||
        "选项",
      title: item?.title ? String(item.title) : "",
      disabled: !!item?.disabled,
    }));
    if (!optionList.some((item) => item.value === selectedValue) && optionList.length) {
      selectedValue = optionList[0].value;
    }
    renderOptions();
  };
  root.close = close;
  Object.defineProperty(root, "value", {
    get: () => selectedValue,
    set: (nextValue) => {
      selectedValue = String(nextValue ?? "");
      updateLabel();
    },
  });
  Object.defineProperty(root, "disabled", {
    get: () => trigger.disabled,
    set: (nextValue) => {
      trigger.disabled = !!nextValue;
    },
  });

  trigger.onclick = () => {
    if (trigger.disabled) return;
    if (menu.hidden) open();
    else close();
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  root.appendChild(trigger);
  root.appendChild(menu);
  root.setOptions(options);
  return root;
}

function labelStyle() {
  return "font:700 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;color:rgba(203,213,225,0.8)";
}

function parseSelectedIndex(select, fallback = -1) {
  const value = Number.parseInt(select?.value ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function configForms(button) {
  return button?.config_forms || button?.configForms || button?.forms || [];
}

function buttonMap(openYsm) {
  return new Map((openYsm?.extraAnimationButtons || []).map((btn) => [btn.id, btn]));
}

function classifyMap(openYsm) {
  return new Map((openYsm?.extraAnimationClassifies || []).map((group) => [group.id, group]));
}

function buildRouletteMenus(openYsm) {
  const menus = new Map();
  const root = Array.isArray(openYsm?.extraAnimationRoot)
    ? openYsm.extraAnimationRoot
    : [];
  if (root.length) {
    menus.set("", root);
  } else {
    const fallbackRoot = [];
    for (const group of openYsm?.extraAnimationClassifies || []) {
      fallbackRoot.push({
        id: `#${group.id}`,
        label: group.name || group.id,
        target: `#${group.id}`,
      });
    }
    for (const item of openYsm?.extraAnimations || []) fallbackRoot.push(item);
    menus.set("", fallbackRoot);
  }

  for (const group of openYsm?.extraAnimationClassifies || []) {
    menus.set(group.id, group.items || []);
  }
  return menus;
}

function itemKind(item) {
  if (String(item?.id || "").startsWith("#")) return "submenu";
  return "action";
}

function itemLabel(item, buttons, groups) {
  if (!item) return "";
  if (itemKind(item) === "submenu") {
    const id = String(item.id || "").slice(1);
    return groups.get(id)?.name || item.label || item.target || id;
  }
  if (itemKind(item) === "config") {
    const id = String(item.target || "").slice(1);
    return buttons.get(id)?.name || item.label || id;
  }
  return item.label || item.target || item.id || "动作";
}

function normalizeSwitchKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.\w+$/, "")
    .replace(/^animation\./, "")
    .replace(/^geometry\./, "")
    .replace(/^ysm\./, "")
    .replace(/^#/, "")
    .toLowerCase();
}

function readVariableValue(vars, key, fallback = 0) {
  if (!key) return fallback;
  if (vars?.[key] !== undefined) return Number(vars[key]) || 0;
  const bare = String(key).replace(/^(variable|v|temp|t|query|q|ctrl|c|ysm)\./, "");
  const aliases = [
    bare,
    `v.${bare}`,
    `variable.${bare}`,
    `temp.${bare}`,
    `t.${bare}`,
    `q.${bare}`,
    `query.${bare}`,
    `ctrl.${bare}`,
    `c.${bare}`,
    `ysm.${bare}`,
  ];
  for (const alias of aliases) {
    if (vars?.[alias] !== undefined) return Number(vars[alias]) || 0;
  }
  const lowered = {};
  for (const [k, v] of Object.entries(vars || {})) lowered[String(k).toLowerCase()] = v;
  for (const alias of aliases) {
    const lower = alias.toLowerCase();
    if (lowered[lower] !== undefined) return Number(lowered[lower]) || 0;
  }
  return fallback;
}

function isSimpleVariableRef(value) {
  return /^(?:(?:v|variable|temp|t|q|query|ctrl|c|ysm)\.)?[A-Za-z_][\w.]*$/.test(
    String(value || "").trim(),
  );
}

function readFormValue(vars, expression, fallback = 0) {
  const text = String(expression || "").trim();
  if (!text) return fallback;
  if (isSimpleVariableRef(text)) return readVariableValue(vars, text, fallback);
  const value = evaluateMolangExpression(text, { variables: vars || {} }, 0);
  return Number.isFinite(value) ? value : fallback;
}

function setVariableValue(vars, key, value) {
  if (!key) return vars || {};
  return { ...(vars || {}), [key]: Number(value) || 0 };
}

function setVariableAliases(vars, key, value) {
  const bare = String(key || "").replace(/^(variable|v|query|q|ctrl|c|ysm)\./, "");
  const numeric = Number(value) || 0;
  return {
    ...(vars || {}),
    [bare]: numeric,
    [`v.${bare}`]: numeric,
    [`variable.${bare}`]: numeric,
    [`q.${bare}`]: numeric,
    [`query.${bare}`]: numeric,
    [`ctrl.${bare}`]: numeric,
    [`c.${bare}`]: numeric,
    [`ysm.${bare}`]: numeric,
  };
}

function withExtraAnimationState(vars, active) {
  let next = setVariableAliases(vars, "playing_extra_animation", active ? 1 : 0);
  next = setVariableAliases(next, "model_switching", active ? 1 : 0);
  next = setVariableAliases(next, "all_animations_finished", active ? 0 : 1);
  next = setVariableAliases(next, "any_animation_finished", active ? 0 : 1);
  return next;
}

function configControlReadExpression(control) {
  return control?.value || control?.id || "";
}

function configControlIndex(vars, control) {
  const max = Math.max(0, (control?.options?.length || 1) - 1);
  return Math.max(
    0,
    Math.min(max, Math.round(readFormValue(vars, configControlReadExpression(control), 0))),
  );
}

function configControlLabel(control) {
  if (!control) return "";
  const title = control.title || control.value || control.id || "配置";
  const button = control.button || "";
  const prefix = control.likelyShape ? "形态" : "配置";
  return button && button !== title ? `${prefix} · ${button} / ${title}` : `${prefix} · ${title}`;
}

function configControlFromForm(button, form, formIndex = 0) {
  const title = form?.title || form?.value || button?.name || `配置 ${formIndex + 1}`;
  const value = form?.value || "";
  return {
    id: `${button?.id || button?.name || "button"}:${value || title || formIndex}`,
    value,
    title,
    button: button?.name || button?.id || "",
    buttonId: button?.id || "",
    likelyShape: false,
    options: Object.entries(form?.labels || {}).map(([label, script], index) => ({
      value: String(index),
      label: String(label || "").trim() || `选项 ${index + 1}`,
      script,
    })),
  };
}

function applyConfigControlOption(vars, control, index, openYsm) {
  const option = control?.options?.[index];
  if (!option) return vars || {};
  let nextVars = applyOpenYsmExpression(
    vars,
    option.script || "",
    {
      key: configControlReadExpression(control),
      value: index,
    },
    openYsm,
  );
  for (const [key, value] of Object.entries(option.assignments || {})) {
    nextVars = setVariableValue(nextVars, key, value);
  }
  return nextVars;
}

function findActionClipIndex(item, clips, openYsm) {
  const candidates = [item?.id, item?.target, item?.label].filter(Boolean);
  for (const candidate of candidates) {
    const clip = findClipByName(clips, candidate);
    if (clip) return clips.findIndex((itemClip) => itemClip.name === clip.name);
  }

  for (const controller of openYsm?.controllers || []) {
    for (const state of controller.states || []) {
      if (!candidates.some((candidate) => sameAnimKey(candidate, state.name))) continue;
      for (const name of state.animations || []) {
        const clip = findClipByName(clips, name);
        if (clip) return clips.findIndex((itemClip) => itemClip.name === clip.name);
      }
    }
  }
  return -1;
}

function wheelStyle() {
  return `
    .ysm-select.open {
      z-index: 80;
    }
    .ysm-select-trigger:focus {
      outline: 2px solid rgba(56,189,248,0.55);
      outline-offset: 2px;
    }
    .ysm-select-trigger:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .ysm-select-menu {
      position: absolute;
      left: 0;
      top: calc(100% + 8px);
      z-index: 90;
      min-width: 100%;
      width: max-content;
      max-width: min(440px, calc(100vw - 32px));
      max-height: 280px;
      overflow: auto;
      padding: 6px;
      box-sizing: border-box;
      border: 1px solid rgba(148,163,184,0.32);
      border-radius: 10px;
      background: rgba(8,13,24,0.98);
      color-scheme: dark;
      box-shadow: 0 22px 48px rgba(0,0,0,0.42), 0 0 0 1px rgba(56,189,248,0.08);
      backdrop-filter: blur(16px);
    }
    .ysm-select-menu[hidden] {
      display: none;
    }
    .ysm-select-option {
      width: 100%;
      min-height: 36px;
      display: block;
      padding: 8px 12px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: rgba(248,250,252,0.96) !important;
      cursor: pointer;
      font: 800 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;
      text-align: left;
      white-space: nowrap;
    }
    .ysm-select-option:hover,
    .ysm-select-option.active {
      background: rgba(56,189,248,0.18);
      color: #fff !important;
    }
    .ysm-select-option:disabled {
      color: rgba(203,213,225,0.74) !important;
      cursor: default;
    }
    #ysm-roulette-panel {
      position: absolute;
      right: 18px;
      top: 18px;
      bottom: 18px;
      width: min(620px, calc(100vw - 36px));
      display: grid;
      grid-template-columns: 260px minmax(240px, 1fr);
      gap: 14px;
      z-index: 8;
      pointer-events: auto;
      padding: 14px;
      border: 1px solid rgba(148,163,184,0.24);
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(10,16,28,0.9), rgba(18,28,46,0.84));
      box-shadow: 0 24px 60px rgba(0,0,0,0.34);
      backdrop-filter: blur(18px);
      box-sizing: border-box;
      overflow: hidden;
    }
    .ysm-roulette-left, .ysm-roulette-config {
      min-width: 0;
      min-height: 0;
      position: relative;
      border: 1px solid rgba(148,163,184,0.16);
      border-radius: 10px;
      background: rgba(4,8,18,0.36);
      overflow: hidden;
    }
    .ysm-roulette-head {
      height: 42px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border-bottom: 1px solid rgba(148,163,184,0.14);
      color: rgba(241,245,249,0.94);
      font: 800 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;
    }
    .ysm-roulette-head button, .ysm-page-btn {
      height: 30px;
      min-width: 34px;
      border: 1px solid rgba(148,163,184,0.24);
      border-radius: 8px;
      background: rgba(15,23,42,0.82);
      color: rgba(241,245,249,0.94);
      cursor: pointer;
      font: 800 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;
    }
    .ysm-roulette-wheel {
      position: absolute;
      inset: 54px 10px 50px;
      min-height: 220px;
    }
    .ysm-wheel-ring {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 210px;
      height: 210px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      border: 1px solid rgba(125,211,252,0.28);
      background:
        radial-gradient(circle at center, rgba(34,211,238,0.16) 0 26%, transparent 27%),
        conic-gradient(from -22.5deg, rgba(125,211,252,0.16), rgba(167,139,250,0.16), rgba(52,211,153,0.14), rgba(125,211,252,0.16));
      box-shadow: inset 0 0 34px rgba(125,211,252,0.12);
    }
    .ysm-wheel-center {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 76px;
      height: 76px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      border: 1px solid rgba(226,232,240,0.22);
      background: rgba(8,13,24,0.92);
      color: rgba(241,245,249,0.92);
      font: 800 12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;
      display: grid;
      place-items: center;
      text-align: center;
      padding: 6px;
      box-sizing: border-box;
    }
    .ysm-wheel-item {
      position: absolute;
      width: 82px;
      height: 46px;
      margin-left: -41px;
      margin-top: -23px;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.28);
      background: linear-gradient(180deg, rgba(30,41,59,0.92), rgba(15,23,42,0.88));
      color: rgba(248,250,252,0.96);
      cursor: pointer;
      font: 800 11px/1.15 system-ui,-apple-system,Segoe UI,sans-serif;
      text-align: center;
      padding: 4px 6px;
      overflow: hidden;
      box-shadow: 0 12px 28px rgba(0,0,0,0.25);
    }
    .ysm-wheel-item.config {
      border-color: rgba(52,211,153,0.36);
      color: rgba(220,252,231,0.98);
    }
    .ysm-wheel-item.submenu {
      border-color: rgba(251,191,36,0.38);
      color: rgba(254,243,199,0.98);
    }
    .ysm-roulette-pages {
      position: absolute;
      left: 10px;
      right: 10px;
      bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: rgba(203,213,225,0.74);
      font: 800 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;
    }
    .ysm-config-body {
      height: calc(100% - 42px);
      overflow: auto;
      padding: 12px;
      box-sizing: border-box;
    }
    .ysm-config-row {
      padding: 10px 0;
      border-bottom: 1px solid rgba(148,163,184,0.12);
    }
    .ysm-config-title {
      color: rgba(241,245,249,0.94);
      font: 800 12px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;
      margin-bottom: 8px;
    }
    .ysm-config-desc {
      color: rgba(148,163,184,0.82);
      font: 600 11px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;
      margin: -4px 0 8px;
    }
    .ysm-radio-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
      gap: 8px;
    }
    .ysm-radio-btn, .ysm-config-button {
      min-height: 36px;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.2);
      background: rgba(15,23,42,0.78);
      color: rgba(226,232,240,0.9);
      cursor: pointer;
      font: 800 12px/1.15 system-ui,-apple-system,Segoe UI,sans-serif;
      padding: 7px 9px;
      text-align: center;
    }
    .ysm-radio-btn.active, .ysm-config-button.active {
      border-color: rgba(56,189,248,0.62);
      background: rgba(14,116,144,0.34);
      color: white;
      box-shadow: inset 0 0 0 1px rgba(125,211,252,0.18);
    }
    .ysm-check-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: rgba(226,232,240,0.92);
      font: 800 12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;
    }
    .ysm-check-line input {
      width: 22px;
      height: 22px;
      accent-color: var(--accent,#38bdf8);
    }
    .ysm-range-line {
      display: grid;
      grid-template-columns: 1fr 54px;
      align-items: center;
      gap: 10px;
    }
    .ysm-range-line input {
      width: 100%;
      accent-color: var(--accent,#38bdf8);
    }
    .ysm-range-value {
      text-align: right;
      color: rgba(226,232,240,0.92);
      font: 800 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;
    }
    @media (max-width: 780px) {
      #ysm-roulette-panel {
        left: 12px;
        right: 12px;
        top: 12px;
        bottom: 12px;
        width: auto;
        grid-template-columns: 1fr;
      }
      .ysm-roulette-left {
        min-height: 310px;
      }
    }
  `;
}

export function create3DPreview(model) {
  let model3d = null;
  let overlay3d = null;
  let is3D = false;
  let animPlayer = null;
  let currentModel = applyModelVariant(model, model?.activeVariant || 0);
  let selectedTexIdx = currentModel.texIndex || currentModel.texIdx || 0;
  let selectedBg = "openysm";
  let selectedClip = -1;
  let speed = 1;
  let openYsmVariables = null;
  let rouletteVisible = true;
  let rouletteNav = [];
  let roulettePage = 0;
  let activeConfigId = "";
  let activeShapeControlId = "";

  function cleanupOverlay() {
    if (animPlayer) {
      animPlayer.stop();
      animPlayer = null;
    }
    if (model3d) {
      clearInterval(model3d._timeTimer);
      if (model3d._keyHandler) {
        document.removeEventListener("keydown", model3d._keyHandler);
      }
      model3d.cleanup();
      model3d = null;
    }
    if (overlay3d?.parentNode) overlay3d.parentNode.removeChild(overlay3d);
    overlay3d = null;
    is3D = false;
    setPrefer3D(false);
  }

  function reopen3D() {
    cleanupOverlay();
    is3D = false;
    requestAnimationFrame(() => toggle3D());
  }

  async function toggle3D() {
    is3D = !is3D;
    setPrefer3D(is3D);
    if (!is3D) {
      cleanupOverlay();
      return;
    }

    const openYsm = getOpenYsmMeta(currentModel);
    if (!openYsmVariables) {
      openYsmVariables = applyControllerEntryScripts(
        openYsm,
        buildOpenYsmDefaultVariables(openYsm),
      );
    }
    const rawClips = clipsForModel(resolveAnimationClips(currentModel), currentModel);
    const clips = applyOpenYsmActionLabels(openYsm, rawClips);
    let applyCurrentPose = () => {};
    let playClip = () => {};
    let stopClip = () => {};
    let commitVariables = (nextVars) => {
      openYsmVariables = nextVars;
    };

    console.info("[3D] preview model", {
      activeVariant: currentModel.activeVariant || 0,
      variants: currentModel.variants?.length || 0,
      textures: currentModel.textures?.length || 0,
      clips: clips.length,
      openYsm: !!openYsm,
      mainModel: openYsm?.mainModelPath || "",
      bones: currentModel.bones?.length || 0,
      cubes: currentModel.cubeCount || 0,
    });

    const overlay = document.createElement("div");
    overlay.id = "ysm-overlay-3d";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:var(--z-fullscreen);background:#0f1218;display:flex;flex-direction:column;color:#e5e7eb";
    overlay3d = overlay;

    const topBar = document.createElement("div");
    topBar.id = "ysm-topbar-3d";
    topBar.style.cssText =
      "min-height:62px;display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.76));border-bottom:1px solid rgba(148,163,184,0.18);box-shadow:0 12px 32px rgba(0,0,0,0.3);backdrop-filter:blur(18px);flex-shrink:0;pointer-events:auto;position:relative;z-index:10;flex-wrap:wrap";

    const closeBtn = document.createElement("button");
    closeBtn.id = "ysm-close-3d";
    closeBtn.textContent = "关闭 3D";
    closeBtn.title = "关闭 3D 预览";
    closeBtn.style.cssText = buttonStyle(108);
    closeBtn.onclick = cleanupOverlay;
    topBar.appendChild(closeBtn);

    const menus = buildRouletteMenus(openYsm);
    const shapeControls = buildOpenYsmShapeControls(openYsm);
    const hasRoulette =
      !!openYsm &&
      ((menus.get("") || []).length > 0 || (openYsm.extraAnimationButtons || []).length > 0);
    let rouletteBtn = null;
    let renderRoulettePanel = () => {};
    let syncShapeSelectors = () => {};
    const revealConfigPanelForControl = (control) => {
      if (!control?.buttonId || !hasRoulette) return;
      activeConfigId = control.buttonId;
      rouletteVisible = true;
      renderRoulettePanel();
    };
    if (hasRoulette) {
      rouletteBtn = document.createElement("button");
      rouletteBtn.textContent = rouletteVisible ? "收起轮盘" : "轮盘";
      rouletteBtn.title = "OpenYSM 动作轮盘";
      rouletteBtn.style.cssText = buttonStyle(112);
      rouletteBtn.onclick = () => {
        rouletteVisible = !rouletteVisible;
        renderRoulettePanel();
      };
      topBar.appendChild(rouletteBtn);
    }

    if (currentModel.variants?.length > 1) {
      const variantLabelEl = document.createElement("span");
      variantLabelEl.textContent = "形态";
      variantLabelEl.style.cssText = labelStyle();
      topBar.appendChild(variantLabelEl);

      const variantSel = createOverlaySelect({
        width: 236,
        value: String(currentModel.activeVariant || 0),
        options: currentModel.variants.map((variant, i) => {
          const label = variantLabel(variant, i);
          return {
            value: String(i),
            label,
            title: variant.source || variant.identifier || label,
          };
        }),
      });
      variantSel.onchange = () => {
        const nextIndex = Number.parseInt(variantSel.value, 10) || 0;
        currentModel = applyModelVariant(currentModel, nextIndex);
        currentModel._modelPath = model._modelPath;
        selectedTexIdx = currentModel.texIndex || currentModel.texIdx || 0;
        selectedClip = -1;
        reopen3D();
      };
      topBar.appendChild(variantSel);
    }

    if (shapeControls.length > 0) {
      let activeShapeControl =
        shapeControls.find((control) => control.id === activeShapeControlId) ||
        shapeControls[0];
      activeShapeControlId = activeShapeControl.id;

      const shapeLabel = document.createElement("span");
      shapeLabel.textContent = shapeControls.length > 1 ? "形态/配置" : activeShapeControl.likelyShape ? "形态" : "配置";
      shapeLabel.style.cssText = labelStyle();
      topBar.appendChild(shapeLabel);

      let shapeControlSel = null;
      if (shapeControls.length > 1) {
        shapeControlSel = createOverlaySelect({
          width: 214,
          value: activeShapeControlId,
          options: shapeControls.map((control) => ({
            value: control.id,
            label: configControlLabel(control),
            title: control.value || control.id,
          })),
        });
        topBar.appendChild(shapeControlSel);
      }

      const shapeSel = createOverlaySelect({
        width: 196,
        value: String(configControlIndex(openYsmVariables, activeShapeControl)),
        options: activeShapeControl.options.map((option, index) => ({
          value: String(index),
          label: option.label || `选项 ${index + 1}`,
          title: activeShapeControl.title,
        })),
      });
      const syncShapeValueSelect = () => {
        activeShapeControl =
          shapeControls.find((control) => control.id === activeShapeControlId) ||
          shapeControls[0];
        if (!activeShapeControl) return;
        shapeSel.setOptions(
          activeShapeControl.options.map((option, index) => ({
            value: String(index),
            label: option.label || `选项 ${index + 1}`,
            title: activeShapeControl.title,
          })),
        );
        shapeSel.value = String(configControlIndex(openYsmVariables, activeShapeControl));
        shapeSel.title = configControlLabel(activeShapeControl);
      };
      syncShapeSelectors = () => {
        if (shapeControlSel) shapeControlSel.value = activeShapeControlId;
        syncShapeValueSelect();
      };
      if (shapeControlSel) {
        shapeControlSel.onchange = () => {
          activeShapeControlId = shapeControlSel.value;
          syncShapeValueSelect();
          revealConfigPanelForControl(activeShapeControl);
        };
      }
      shapeSel.onchange = () => {
        const index = parseSelectedIndex(shapeSel, 0);
        revealConfigPanelForControl(activeShapeControl);
        commitVariables(applyConfigControlOption(openYsmVariables, activeShapeControl, index, openYsm));
        syncShapeSelectors();
      };
      topBar.appendChild(shapeSel);
    }

    if (currentModel.textures?.length > 1) {
      const texLabel = document.createElement("span");
      texLabel.textContent = "贴图";
      texLabel.style.cssText = labelStyle();
      topBar.appendChild(texLabel);

      const textureLabels = openYsm?.textures || [];
      const texSel = createOverlaySelect({
        width: 146,
        value: String(selectedTexIdx),
        options: currentModel.textures.map((_, i) => {
          const label = textureLabels[i]?.label || `贴图 ${i + 1}`;
          return {
            value: String(i),
            label,
            title: textureLabels[i]?.path || label,
          };
        }),
      });
      texSel.onchange = () => {
        selectedTexIdx = Number.parseInt(texSel.value, 10) || 0;
        reopen3D();
      };
      topBar.appendChild(texSel);
    }

    const bgLabel = document.createElement("span");
    bgLabel.textContent = "背景";
    bgLabel.style.cssText = labelStyle();
    topBar.appendChild(bgLabel);

    const bgSel = createOverlaySelect({
      width: 150,
      value: selectedBg,
      options: [
        ["openysm", "OpenYSM"],
        ["studio", "工作室"],
        ["plain", "纯色"],
      ].map(([value, label]) => ({
        value,
        label,
      })),
    });
    topBar.appendChild(bgSel);

    const animLabel = document.createElement("span");
    animLabel.textContent = "动作";
    animLabel.style.cssText = labelStyle();
    topBar.appendChild(animLabel);

    const animOptions = [
      {
        value: "-1",
        label: clips.length ? "默认姿态" : "未找到动作",
      },
    ];
    clips.forEach((clip, i) => {
      const match = clip._totalBones ? ` (${clip._matchedBones}/${clip._totalBones})` : "";
      animOptions.push({
        value: String(i),
        label: `${clip._actionLabel || clipLabel(clip.name)}${match}`,
        title: clip._matchedClip || clip.name,
      });
    });
    const animSel = createOverlaySelect({
      width: 320,
      value: selectedClip < 0 ? "-1" : String(selectedClip),
      options: animOptions,
    });
    topBar.appendChild(animSel);

    const playBtn = document.createElement("button");
    playBtn.textContent = "播放";
    playBtn.title = "播放或暂停当前动作";
    playBtn.style.cssText = buttonStyle(76);
    playBtn.disabled = clips.length === 0;
    topBar.appendChild(playBtn);

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "停止";
    stopBtn.title = "停止动作并恢复默认姿态";
    stopBtn.style.cssText = buttonStyle(76);
    stopBtn.disabled = clips.length === 0;
    topBar.appendChild(stopBtn);

    const speedSel = createOverlaySelect({
      width: 96,
      value: String(speed),
      options: [0.25, 0.5, 1, 1.5, 2, 4].map((item) => ({
        value: String(item),
        label: `${item}x`,
      })),
    });
    topBar.appendChild(speedSel);

    const timeLabel = document.createElement("span");
    timeLabel.textContent = "0.0 / 0.0s";
    timeLabel.style.cssText =
      "min-width:88px;text-align:center;font:700 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;color:rgba(226,232,240,0.76)";
    topBar.appendChild(timeLabel);

    const timeline = document.createElement("input");
    timeline.type = "range";
    timeline.min = "0";
    timeline.max = "1000";
    timeline.value = "0";
    timeline.disabled = clips.length === 0;
    timeline.style.cssText =
      "width:230px;max-width:24vw;accent-color:var(--accent,#38bdf8);cursor:pointer";
    topBar.appendChild(timeline);

    const spacer = document.createElement("div");
    spacer.style.cssText = "flex:1 1 auto;min-width:12px";
    topBar.appendChild(spacer);

    const rotLabel = document.createElement("span");
    rotLabel.style.cssText = labelStyle();
    rotLabel.textContent = "镜头";
    topBar.appendChild(rotLabel);

    const rotSel = createOverlaySelect({
      width: 130,
      value: "true",
      options: [
        [true, "环绕"],
        [false, "自由"],
      ].map(([value, label]) => ({
        value: String(value),
        label,
      })),
    });
    topBar.appendChild(rotSel);

    const resetViewBtn = document.createElement("button");
    resetViewBtn.textContent = "取景";
    resetViewBtn.title = "重置镜头取景";
    resetViewBtn.style.cssText = buttonStyle(76);
    topBar.appendChild(resetViewBtn);

    const spdSlider = document.createElement("input");
    spdSlider.type = "range";
    spdSlider.min = "2";
    spdSlider.max = "200";
    spdSlider.value = "20";
    spdSlider.title = "镜头速度";
    spdSlider.style.cssText =
      "width:120px;cursor:pointer;accent-color:var(--accent,#38bdf8)";
    topBar.appendChild(spdSlider);

    const spdVal = document.createElement("span");
    spdVal.style.cssText = labelStyle() + ";min-width:24px";
    spdVal.textContent = "20";
    topBar.appendChild(spdVal);

    overlay.appendChild(topBar);

    const viewContainer = document.createElement("div");
    viewContainer.style.cssText = "flex:1;position:relative;min-height:0;overflow:hidden";

    const progStyle = document.createElement("style");
    progStyle.textContent =
      `@keyframes ysm-prog{0%{margin-left:-30%}100%{margin-left:130%}}${wheelStyle()}`;
    overlay.appendChild(progStyle);
    overlay.appendChild(viewContainer);
    document.body.appendChild(overlay);

    const loadingEl = document.createElement("div");
    loadingEl.style.cssText =
      "position:absolute;inset:62px 0 0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(226,232,240,0.76);font-size:14px;gap:12px;z-index:10;background:rgba(15,18,24,0.92)";
    loadingEl.innerHTML =
      '<div style="font-size:42px;letter-spacing:0">3D</div><div>正在加载模型...</div><div style="width:260px;height:3px;background:rgba(148,163,184,0.16);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#38bdf8);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';
    overlay.appendChild(loadingEl);

    const tryApplyModelSwitch = (item) => {
      const variants = currentModel.variants || [];
      if (variants.length <= 1) return false;
      const candidates = [item?.id, item?.target, item?.label]
        .map(normalizeSwitchKey)
        .filter(Boolean);
      const nextIndex = variants.findIndex((variant) => {
        const keys = [
          variant.name,
          variant.identifier,
          variant.source,
          sourceName(variant.source),
          variant._subEntityId,
          ...(variant._variantAliases || []),
        ]
          .map(normalizeSwitchKey)
          .filter(Boolean);
        return candidates.some((candidate) => keys.includes(candidate));
      });
      if (nextIndex < 0 || nextIndex === (currentModel.activeVariant || 0)) return false;
      currentModel = applyModelVariant(currentModel, nextIndex);
      currentModel._modelPath = model._modelPath;
      selectedClip = -1;
      reopen3D();
      return true;
    };

    try {
      const texUrl = currentModel.texture || null;
      const { renderModel3D } = await import("../../utils/model3d.js");
      model3d = await renderModel3D(viewContainer, currentModel, texUrl, selectedTexIdx);
      loadingEl.remove();
      model3d.setBackgroundMode(selectedBg);

      const boneHierarchy = (currentModel.bones || []).map((bone) => ({
        name: bone.name,
        parent: bone.parent,
      }));
      const evalBaseTransforms = (t = 0) => {
        const baseClips = resolveControllerPoseClips(
          openYsm,
          rawClips,
          openYsmVariables || {},
        );
        let base = new Map();
        for (const clip of baseClips) {
          base = mergeTransforms(
            base,
            evaluateClip(clip, t, boneHierarchy, true, {
              variables: openYsmVariables || {},
            }),
          );
        }
        return base;
      };
      const layerTransforms = (transforms, t = 0) =>
        mergeTransforms(evalBaseTransforms(t), transforms);
      applyCurrentPose = () => {
        if (!model3d) return;
        if (animPlayer?.currentClip) {
          animPlayer.seek(animPlayer.time || 0);
        } else {
          model3d.setBoneTransforms(layerTransforms(null, 0));
        }
      };

      commitVariables = (nextVars) => {
        openYsmVariables = nextVars;
        animPlayer?.setVariables(openYsmVariables);
        applyCurrentPose();
        renderRoulettePanel();
        syncShapeSelectors();
      };

      const renderConfigForm = (body, button, form, formIndex) => {
        const row = document.createElement("div");
        row.className = "ysm-config-row";

        const title = document.createElement("div");
        title.className = "ysm-config-title";
        title.textContent = form.title || form.value || `配置 ${formIndex + 1}`;
        row.appendChild(title);

        if (form.description) {
          const desc = document.createElement("div");
          desc.className = "ysm-config-desc";
          desc.textContent = form.description;
          row.appendChild(desc);
        }

        if (form.type === "radio" && form.labels && typeof form.labels === "object") {
          const formControl = configControlFromForm(button, form, formIndex);
          const grid = document.createElement("div");
          grid.className = "ysm-radio-grid";
          const current = configControlIndex(openYsmVariables, formControl);
          formControl.options.forEach((option, index) => {
            const btn = document.createElement("button");
            btn.className = `ysm-radio-btn${index === current ? " active" : ""}`;
            btn.textContent = option.label;
            btn.title = String(option.script || "");
            btn.onclick = () => {
              const matchedTopbarControl =
                shapeControls.find(
                  (control) =>
                    control.value &&
                    formControl.value &&
                    control.value === formControl.value,
                ) ||
                shapeControls.find(
                  (control) =>
                    control.buttonId === formControl.buttonId &&
                    control.title === formControl.title,
                );
              if (matchedTopbarControl) activeShapeControlId = matchedTopbarControl.id;
              commitVariables(applyConfigControlOption(openYsmVariables, formControl, index, openYsm));
            };
            grid.appendChild(btn);
          });
          row.appendChild(grid);
        } else if (form.type === "checkbox") {
          const line = document.createElement("label");
          line.className = "ysm-check-line";
          const span = document.createElement("span");
          span.textContent = form.title || form.value || button.name || button.id;
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = readFormValue(openYsmVariables, form.value, 0) > 0;
          input.onchange = () => {
            commitVariables(setVariableValue(openYsmVariables, form.value, input.checked ? 1 : 0));
          };
          line.appendChild(span);
          line.appendChild(input);
          row.appendChild(line);
        } else if (form.type === "range") {
          const min = Number(form.min ?? 0);
          const max = Number(form.max ?? 100);
          const step = Number(form.step || 1);
          const value = readFormValue(openYsmVariables, form.value, min);
          const line = document.createElement("div");
          line.className = "ysm-range-line";
          const input = document.createElement("input");
          input.type = "range";
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          input.value = String(Math.max(min, Math.min(max, value)));
          const val = document.createElement("span");
          val.className = "ysm-range-value";
          val.textContent = input.value;
          input.oninput = () => {
            val.textContent = input.value;
            commitVariables(setVariableValue(openYsmVariables, form.value, Number(input.value)));
          };
          line.appendChild(input);
          line.appendChild(val);
          row.appendChild(line);
        }

        body.appendChild(row);
      };

      renderRoulettePanel = () => {
        if (!hasRoulette) return;
        if (rouletteBtn) rouletteBtn.textContent = rouletteVisible ? "收起轮盘" : "轮盘";
        let panel = viewContainer.querySelector("#ysm-roulette-panel");
        if (!rouletteVisible) {
          if (panel) panel.style.display = "none";
          return;
        }
        if (!panel) {
          panel = document.createElement("div");
          panel.id = "ysm-roulette-panel";
          viewContainer.appendChild(panel);
        }
        panel.style.display = "grid";
        panel.innerHTML = "";

        const buttons = buttonMap(openYsm);
        const groups = classifyMap(openYsm);
        const menuId = rouletteNav[rouletteNav.length - 1] || "";
        const menuItems = menus.get(menuId) || [];
        const maxPage = Math.max(0, Math.ceil(menuItems.length / 8) - 1);
        roulettePage = Math.max(0, Math.min(maxPage, roulettePage));
        const pageItems = menuItems.slice(roulettePage * 8, roulettePage * 8 + 8);

        const left = document.createElement("div");
        left.className = "ysm-roulette-left";
        const head = document.createElement("div");
        head.className = "ysm-roulette-head";
        if (rouletteNav.length) {
          const back = document.createElement("button");
          back.textContent = "返回";
          back.onclick = () => {
            rouletteNav = rouletteNav.slice(0, -1);
            roulettePage = 0;
            activeConfigId = "";
            renderRoulettePanel();
          };
          head.appendChild(back);
        }
        const title = document.createElement("span");
        title.textContent = groups.get(menuId)?.name || "OpenYSM 轮盘";
        title.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        head.appendChild(title);
        left.appendChild(head);

        const wheel = document.createElement("div");
        wheel.className = "ysm-roulette-wheel";
        const ring = document.createElement("div");
        ring.className = "ysm-wheel-ring";
        wheel.appendChild(ring);
        const center = document.createElement("button");
        center.className = "ysm-wheel-center";
        center.textContent = activeConfigId
          ? buttons.get(activeConfigId)?.name || "配置"
          : "停止";
        center.onclick = () => {
          activeConfigId = "";
          stopClip();
          renderRoulettePanel();
        };
        wheel.appendChild(center);

        pageItems.forEach((item, i) => {
          const angle = -Math.PI / 2 + i * (Math.PI / 4);
          const btn = document.createElement("button");
          const kind = itemKind(item);
          btn.className = `ysm-wheel-item ${kind}`;
          btn.style.left = `${50 + Math.cos(angle) * 38}%`;
          btn.style.top = `${50 + Math.sin(angle) * 38}%`;
          btn.textContent = itemLabel(item, buttons, groups);
          btn.title = `${item.id || ""} ${item.target || ""}`.trim();
          btn.onclick = () => {
            if (kind === "submenu") {
              const id = String(item.id || "").slice(1);
              if (menus.has(id)) {
                rouletteNav = [...rouletteNav, id];
                roulettePage = 0;
                activeConfigId = "";
                renderRoulettePanel();
              }
              return;
            }
            if (kind === "config") {
              activeConfigId = String(item.target || "").slice(1);
              renderRoulettePanel();
              return;
            }
            if (tryApplyModelSwitch(item)) return;
            const index = findActionClipIndex(item, clips, openYsm);
            if (index >= 0) {
              playClip(index, item?.id || item?.target || item?.label || "");
              return;
            }
          };
          wheel.appendChild(btn);
        });

        const pages = document.createElement("div");
        pages.className = "ysm-roulette-pages";
        const prev = document.createElement("button");
        prev.className = "ysm-page-btn";
        prev.textContent = "<";
        prev.disabled = roulettePage <= 0;
        prev.onclick = () => {
          roulettePage = Math.max(0, roulettePage - 1);
          renderRoulettePanel();
        };
        const info = document.createElement("span");
        info.textContent = `${roulettePage + 1}/${maxPage + 1}`;
        const next = document.createElement("button");
        next.className = "ysm-page-btn";
        next.textContent = ">";
        next.disabled = roulettePage >= maxPage;
        next.onclick = () => {
          roulettePage = Math.min(maxPage, roulettePage + 1);
          renderRoulettePanel();
        };
        pages.appendChild(prev);
        pages.appendChild(info);
        pages.appendChild(next);
        wheel.appendChild(pages);
        left.appendChild(wheel);
        panel.appendChild(left);

        const config = document.createElement("div");
        config.className = "ysm-roulette-config";
        const configHead = document.createElement("div");
        configHead.className = "ysm-roulette-head";
        configHead.textContent = activeConfigId
          ? buttons.get(activeConfigId)?.name || activeConfigId
          : "配置";
        config.appendChild(configHead);
        const body = document.createElement("div");
        body.className = "ysm-config-body";

        const activeButton = activeConfigId ? buttons.get(activeConfigId) : null;
        if (activeButton) {
          configForms(activeButton).forEach((form, index) =>
            renderConfigForm(body, activeButton, form, index),
          );
        } else {
          for (const button of openYsm?.extraAnimationButtons || []) {
            const btn = document.createElement("button");
            btn.className = "ysm-config-button";
            btn.style.cssText = "width:100%;margin-bottom:8px";
            btn.textContent = button.name || button.id;
            btn.title = button.description || button.id;
            btn.onclick = () => {
              activeConfigId = button.id;
              renderRoulettePanel();
            };
            body.appendChild(btn);
          }
        }

        config.appendChild(body);
        panel.appendChild(config);
      };

      bgSel.onchange = () => {
        selectedBg = bgSel.value;
        model3d?.setBackgroundMode(selectedBg);
      };
      rotSel.onchange = () => model3d?.setRotationMode(rotSel.value === "true");
      resetViewBtn.onclick = () => model3d?.resetView?.();
      spdSlider.oninput = () => {
        spdVal.textContent = spdSlider.value;
        model3d?.setSpeed(Number(spdSlider.value));
      };

      if (clips.length > 0) {
        animPlayer = new AnimationPlayer(clips, boneHierarchy, {
          localOnly: true,
          variables: openYsmVariables || {},
        });
        animPlayer.setSpeed(speed);

        const syncTime = (t, clip) => {
          const length = clip?.length || animPlayer?.length || 0;
          timeLabel.textContent = `${t.toFixed(1)} / ${length.toFixed(1)}s`;
          timeline.value = length > 0 ? String(Math.round((t / length) * 1000)) : "0";
        };

        animPlayer.onUpdate = (transforms, t, clip) => {
          model3d?.setBoneTransforms(layerTransforms(transforms, t));
          syncTime(t, clip);
        };
        animPlayer.onStop = (state = {}) => {
          playBtn.textContent = "播放";
          if (state.hold) return;
          openYsmVariables = withExtraAnimationState(openYsmVariables, false);
          timeline.value = "0";
          model3d?.setBoneTransforms(layerTransforms(null, 0));
          syncTime(0, animPlayer?.currentClip || clips[selectedClip] || null);
        };

        playClip = (index, actionId = "") => {
          selectedClip = Math.max(0, Math.min(clips.length - 1, index));
          animSel.value = String(selectedClip);
          openYsmVariables = withExtraAnimationState(openYsmVariables, true);
          animPlayer.setVariables(openYsmVariables);
          animPlayer.play(selectedClip, 0);
          playBtn.textContent = "暂停";
          syncTime(0, clips[selectedClip]);
        };

        stopClip = () => {
          selectedClip = -1;
          animSel.value = "-1";
          openYsmVariables = withExtraAnimationState(openYsmVariables, false);
          animPlayer?.setVariables(openYsmVariables);
          animPlayer?.stop();
        };

        animSel.onchange = () => {
          const index = parseSelectedIndex(animSel, -1);
          selectedClip = index;
          if (index < 0) {
            stopClip();
            return;
          }
          playClip(index, clips[index]?.name || "");
        };
        playBtn.onclick = () => {
          if (!animPlayer) return;
          const selected = parseSelectedIndex(animSel, -1);
          if (selected < 0) {
            playClip(0, clips[0]?.name || "");
            return;
          }
          selectedClip = selected;
          if (animPlayer.playing) {
            animPlayer.pause();
            playBtn.textContent = "播放";
          } else if (animPlayer.currentIndex < 0) {
            playClip(selected, clips[selected]?.name || "");
          } else {
            animPlayer.resume();
            playBtn.textContent = "暂停";
          }
        };
        stopBtn.onclick = stopClip;
        speedSel.onchange = () => {
          speed = Number.parseFloat(speedSel.value) || 1;
          animPlayer?.setSpeed(speed);
        };
        timeline.oninput = () => {
          if (!animPlayer?.currentClip) return;
          const length = animPlayer.length || 0;
          animPlayer.seek((Number(timeline.value) / 1000) * length);
        };

        if (selectedClip >= 0 && clips[selectedClip]) {
          playClip(selectedClip, clips[selectedClip]?.name || "");
        } else {
          syncTime(0, null);
          model3d.setBoneTransforms(layerTransforms(null, 0));
        }
      } else {
        stopClip = () => {
          selectedClip = -1;
          openYsmVariables = withExtraAnimationState(openYsmVariables, false);
          model3d?.setBoneTransforms(layerTransforms(null, 0));
        };
        model3d.setBoneTransforms(layerTransforms(null, 0));
      }

      model3d.resetView?.();
      renderRoulettePanel();

      const tip = document.createElement("div");
      tip.style.cssText =
        "padding:8px 12px;background:rgba(56,189,248,0.14);border-bottom:1px solid rgba(148,163,184,0.14);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:700";
      tip.textContent =
        "WASD 移动 | 空格/Shift 上下 | 拖拽旋转 | 滚轮缩放 | ESC 关闭";
      overlay.insertBefore(tip, viewContainer);
      setTimeout(() => {
        if (tip.parentNode) tip.remove();
      }, 6000);

      const onKey = (e) => {
        if (e.key !== "Escape") return;
        cleanupOverlay();
      };
      document.addEventListener("keydown", onKey);
      model3d._keyHandler = onKey;
    } catch (e) {
      console.error("[3D] 加载失败:", e);
      const message = escText(e?.message || e);
      viewContainer.innerHTML = `<div style="padding:40px;color:#ff6b6b;font-size:14px">3D 预览加载失败：${message}</div>`;
      loadingEl.remove();
    }
  }

  function close3D() {
    cleanupOverlay();
  }

  function cleanup() {
    cleanupOverlay();
  }

  return { toggle3D, close3D, cleanup };
}
