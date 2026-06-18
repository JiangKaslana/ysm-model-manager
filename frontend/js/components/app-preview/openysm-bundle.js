import {
  parseBedrockGeometryVariantsFromJSON,
  selectPrimaryVariant,
} from "./utils.js";
import {
  evaluateMolangExpression,
  parseBedrockAnimationJSON,
} from "../../utils/animation.js";

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

export async function buildOpenYsmPreviewBundleFromJsonPath(
  ysmJsonPath,
  root,
  readFileBytes,
  options = {},
) {
  if (!root?.files?.player || typeof readFileBytes !== "function") return null;
  const files = [
    {
      path: "ysm.json",
      data: encoder.encode(JSON.stringify(root)),
    },
  ];
  const refs = collectReferencedPaths(root);
  for (const ref of refs) {
    const abs = resolveSiblingPath(ysmJsonPath, ref);
    if (!abs) continue;
    try {
      const data = await readFileBytes(abs);
      const bytes = toUint8Array(data);
      if (bytes?.length) files.push({ path: ref, data: bytes });
    } catch (_) {}
  }
  if (typeof options.listFunctionFiles === "function") {
    try {
      const functionPaths = (await options.listFunctionFiles(ysmJsonPath)) || [];
      for (const abs of functionPaths.slice(0, 256)) {
        const rel = relativeYsmPath(ysmJsonPath, abs);
        if (!isOpenYsmFunctionPath(rel)) continue;
        try {
          const data = await readFileBytes(abs);
          const bytes = toUint8Array(data);
          if (bytes?.length) files.push({ path: rel, data: bytes });
        } catch (_) {}
      }
    } catch (e) {
      options.devLog?.(`[OpenYSM] functions 目录读取失败：${e?.message || e}`);
    }
  }
  return buildOpenYsmPreviewBundle(files, options);
}

export function buildOpenYsmPreviewBundle(files, options = {}) {
  const devLog = options.devLog || (() => {});
  const ysmFile = findYsmJson(files);
  if (!ysmFile) return null;

  let root;
  try {
    root = JSON.parse(readText(ysmFile));
  } catch (e) {
    devLog(`[OpenYSM] ysm.json 解析失败：${e?.message || e}`);
    return null;
  }

  const player = root?.files?.player || {};
  const subEntities = collectOpenYsmSubEntities(root);
  const modelRefs = parsePlayerModelRefs(player.model);
  const textureRefs = [
    ...parseTextureRefs(player.texture),
    ...subEntities.flatMap((entity) => entity.textures),
  ];
  const textures = collectOpenYsmTextures(files, textureRefs, root?.properties);
  const mainEntry = parseMainGeometry(files, modelRefs, textures, devLog, subEntities);
  if (!mainEntry?.geometry?.bones?.length) return null;

  const animations = mergeOpenYsmAnimations(
    parseOpenYsmAnimations(files, player.animation, devLog),
    parseOpenYsmSubEntityAnimations(files, subEntities, devLog),
  );
  const controllers = parseOpenYsmControllers(files, player.animation_controllers, devLog);
  const molangFunctions = parseOpenYsmFunctions(files, devLog);
  const openYsm = {
    schema: "openysm-preview/v1",
    ysmPath: ysmFile.path,
    source: "wasm-bundle",
    metadata: root.metadata || {},
    properties: normalizeProperties(root.properties || {}),
    mainModelPath: modelRefs.main || mainEntry.path || "",
    armModelPath: modelRefs.arm || "",
    legacyModelPaths: modelRefs.legacy || [],
    textures: textures.items,
    animationFiles: animations.files,
    controllers,
    functions: molangFunctions.functions,
    events: molangFunctions.events,
    extraAnimationRoot: parseExtraAnimationRoot(root.properties || {}),
    extraAnimations: parseExtraAnimations(root.properties || {}),
    extraAnimationClassifies: parseExtraClassifies(root.properties || {}),
    extraAnimationButtons: Array.isArray(root.properties?.extra_animation_buttons)
      ? root.properties.extra_animation_buttons
      : [],
    vehicles: subEntities.filter((item) => item.kind === "vehicle").map((item) => item.id),
    projectiles: subEntities.filter((item) => item.kind === "projectile").map((item) => item.id),
    textureMode: "skin",
  };

  const geometry = {
    ...mainEntry.geometry,
    texture: textures.items[0]?.url || null,
    textures: textures.items.map((item) => item.url).filter(Boolean),
    texWidth: Math.max(
      mainEntry.geometry.texWidth || 0,
      textures.maxWidth || 0,
      mainEntry.uvBounds?.w || 0,
      64,
    ),
    texHeight: Math.max(
      mainEntry.geometry.texHeight || 0,
      textures.maxHeight || 0,
      mainEntry.uvBounds?.h || 0,
      64,
    ),
    variants: mainEntry.variants || [mainEntry.geometry],
    activeVariant: 0,
    _openYsm: openYsm,
    _preferLocalSpec: true,
    _animationClips: animations.clips,
    _texMappingLog: mainEntry.texMappingLog,
  };

  applyTextureMetaToBones(geometry, textures.items[0], geometry.texWidth, geometry.texHeight);

  devLog(
    `[OpenYSM] 主模型 ${openYsm.mainModelPath || "-"}，贴图 ${textures.items.length}，动作 ${animations.clips.length}，控制器 ${controllers.length}，函数 ${molangFunctions.functions.length}`,
  );

  return {
    texture: geometry.texture,
    geometry,
    animations: animations.clips,
    openYsm,
  };
}

function collectReferencedPaths(root) {
  const out = [];
  const add = (value) => {
    const text = String(value || "").trim();
    if (text && !out.includes(text)) out.push(text);
  };
  const player = root?.files?.player || {};
  const modelRefs = parsePlayerModelRefs(player.model);
  add(modelRefs.main);
  add(modelRefs.arm);
  modelRefs.legacy.forEach(add);
  parseTextureRefs(player.texture).forEach((ref) => {
    add(ref.uv);
    add(ref.normal);
    add(ref.specular);
  });
  if (typeof player.animation === "string") add(player.animation);
  if (Array.isArray(player.animation)) player.animation.forEach(add);
  if (player.animation && typeof player.animation === "object" && !Array.isArray(player.animation)) {
    Object.values(player.animation).forEach(add);
  }
  if (typeof player.animation_controllers === "string") add(player.animation_controllers);
  if (Array.isArray(player.animation_controllers)) player.animation_controllers.forEach(add);
  for (const entity of collectOpenYsmSubEntities(root)) {
    add(entity.model);
    entity.textures.forEach((ref) => {
      add(ref.uv);
      add(ref.normal);
      add(ref.specular);
    });
    entity.animations.forEach((ref) => add(ref.path));
    entity.controllers.forEach(add);
  }
  return out;
}

function collectOpenYsmSubEntities(root) {
  const out = [];
  const collect = (section, kind) => {
    for (const entry of subEntityEntries(section, kind)) {
      const item = entry.item || {};
      const id = entry.id || subEntityLabel(item, kind, out.length);
      const model = firstPath(item.model);
      const textures = parseTextureRefs(item.texture).map((ref, index) => ({
        ...ref,
        key: ref.key || `${kind}_${id}_${index + 1}`,
        label: ref.label || `${kind === "vehicle" ? "载具" : "投射物"} ${id}`,
        owner: id,
        kind,
      }));
      const animations = animationRefsFromValue(item.animation, `${kind}_${id}`);
      const controllers = pathsFromValue(item.animation_controllers);
      if (!model && !textures.length && !animations.length && !controllers.length) continue;
      out.push({
        id,
        kind,
        label: item.name || item.label || id,
        matchIds: matchIdsFromValue(item.match),
        model,
        textures,
        animations,
        controllers,
      });
    }
  };
  collect(root?.files?.vehicles, "vehicle");
  collect(root?.files?.projectiles, "projectile");
  return out;
}

function subEntityEntries(section, kind) {
  if (!section) return [];
  if (Array.isArray(section)) {
    return section
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        id: subEntityLabel(item, kind, index),
        item,
      }));
  }
  if (typeof section !== "object") return [];
  return Object.entries(section)
    .filter(([, item]) => item && typeof item === "object")
    .map(([id, item], index) => ({
      id: id || subEntityLabel(item, kind, index),
      item,
    }));
}

function subEntityLabel(item, kind, index) {
  const match = Array.isArray(item?.match) ? item.match[0] : item?.match;
  return item?.id || item?.identifier || item?.name || match || `${kind}_${index + 1}`;
}

function matchIdsFromValue(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((item) => String(item || "")).filter(Boolean);
  return [];
}

function firstPath(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item) => typeof item === "string") || "";
  if (typeof value === "object") {
    return value.main || value.path || value.model || value.geometry || "";
  }
  return "";
}

function pathsFromValue(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value === "object") return Object.values(value).filter((item) => typeof item === "string");
  return [];
}

function animationRefsFromValue(value, keyPrefix = "animation") {
  if (!value) return [];
  if (typeof value === "string") return [{ key: keyPrefix, path: value }];
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((path, index) => ({ key: `${keyPrefix}_${index + 1}`, path }));
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, path]) => typeof path === "string")
      .map(([key, path]) => ({ key, path }));
  }
  return [];
}

function resolveSiblingPath(basePath, ref) {
  const cleanRef = String(ref || "").replace(/^[/\\]+/, "");
  if (!cleanRef) return "";
  const sep = basePath.includes("\\") ? "\\" : "/";
  const base = String(basePath || "").replace(/[\\/][^\\/]*$/, "");
  return `${base}${sep}${cleanRef.replace(/[\\/]/g, sep)}`;
}

function relativeYsmPath(basePath, absPath) {
  const normalizedAbs = String(absPath || "").replace(/\\/g, "/");
  const base = String(basePath || "").replace(/\\/g, "/").replace(/\/[^/]*$/, "");
  if (base && normalizedAbs.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return normalizedAbs.slice(base.length + 1);
  }
  const marker = "/functions/";
  const idx = normalizedAbs.toLowerCase().lastIndexOf(marker);
  if (idx >= 0) return normalizedAbs.slice(idx + 1);
  return normalizedAbs.replace(/^[/\\]+/, "");
}

function isOpenYsmFunctionPath(path) {
  const low = normalizePath(path);
  return low.startsWith("functions/") && low.endsWith(".molang");
}

function toUint8Array(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") {
    const raw = atob(data);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new Uint8Array(data);
}

export function buildOpenYsmActionOptions(openYsm, clips) {
  if (!openYsm) return [];
  const states = flattenControllerStates(openYsm.controllers || []);
  const out = [];
  const seen = new Set();

  const pushAction = (id, label, candidates, group = "") => {
    const key = `${group}:${id}:${label}`;
    if (!id && !label) return;
    if (seen.has(key)) return;
    seen.add(key);
    const clip = resolveClipForCandidates(candidates, clips, states);
    out.push({
      id,
      label: label || id,
      group,
      candidates,
      clip,
      matchedClip: clip?.name || "",
    });
  };

  const preview = openYsm.properties?.previewAnimation;
  if (preview) {
    pushAction("preview", `预览动作 · ${preview}`, [preview], "OpenYSM");
  }

  const buttonNames = new Map(
    (openYsm.extraAnimationButtons || []).map((btn) => [btn.id, btn.name || btn.id]),
  );
  const classifyNames = new Map(
    (openYsm.extraAnimationClassifies || []).map((group) => [
      group.id,
      group.name || group.label || group.id,
    ]),
  );

  for (const group of openYsm.extraAnimationClassifies || []) {
    const groupName = classifyNames.get(group.id) || group.id || "额外动作";
    for (const item of group.items || []) {
      if (String(item.target || "").startsWith("#")) {
        const btnId = String(item.target).slice(1);
        const btnName = buttonNames.get(btnId);
        if (btnName) pushAction(item.id, `${groupName} · ${btnName}`, [btnId, item.id], groupName);
        continue;
      }
      pushAction(item.id, `${groupName} · ${item.label || item.id}`, [item.id, item.target], groupName);
    }
  }

  for (const item of openYsm.extraAnimations || []) {
    if (String(item.target || "").startsWith("#")) continue;
    pushAction(item.id, item.label || item.id, [item.id, item.target], "额外动作");
  }

  for (const state of states) {
    if (!state.animations?.length) continue;
    pushAction(
      state.name,
      `${state.controllerLabel || "控制器"} · ${state.name}`,
      [state.name, ...state.animations],
      "控制器",
    );
  }

  return out.filter((item) => item.clip);
}

export function buildOpenYsmConfigControls(openYsm) {
  if (!openYsm?.extraAnimationButtons?.length) return [];
  const controls = [];
  for (const [buttonIndex, button] of (openYsm.extraAnimationButtons || []).entries()) {
    for (const [formIndex, form] of configFormsFromButton(button).entries()) {
      if (!form || form.type !== "radio" || !form.labels || typeof form.labels !== "object") {
        continue;
      }
      const title = form.title || button.name || form.value || "";
      const entries = Object.entries(form.labels);
      const valueKey = form.value || "";
      const likelyShape = isLikelyShapeControl(title, button.name || "");
      const options = Object.entries(form.labels).map(([label, script], index) => {
        const assignments = parseMolangAssignments(script);
        const fallbackAssignments = {};
        if (!Object.keys(assignments).length && valueKey) fallbackAssignments[valueKey] = index;
        return {
          label: String(label || "").trim() || `选项 ${index + 1}`,
          value: String(index),
          script,
          assignments: fallbackAssignments,
        };
      });
      if (entries.length > 1) {
        controls.push({
          id: `${button.id || button.name || buttonIndex}:${valueKey || title || formIndex}`,
          value: valueKey,
          title: title || `配置 ${formIndex + 1}`,
          button: button.name || button.id || "",
          buttonId: button.id || "",
          likelyShape,
          order: controls.length,
          options,
        });
      }
    }
  }
  return controls.sort((a, b) => {
    if (a.likelyShape !== b.likelyShape) return a.likelyShape ? -1 : 1;
    return a.order - b.order;
  });
}

export function buildOpenYsmShapeControls(openYsm) {
  return buildOpenYsmConfigControls(openYsm);
}

export function buildOpenYsmDefaultVariables(openYsm) {
  let vars = {
    "q.rendering_in_inventory": 1,
    "query.rendering_in_inventory": 1,
    "q.rendering_in_paperdoll": 1,
    "query.rendering_in_paperdoll": 1,
    "q.all_animations_finished": 1,
    "query.all_animations_finished": 1,
    "q.any_animation_finished": 1,
    "query.any_animation_finished": 1,
    "q.is_on_ground": 1,
    "query.is_on_ground": 1,
    "q.ground_speed": 0,
    "query.ground_speed": 0,
    "q.vertical_speed": 0,
    "query.vertical_speed": 0,
    "q.is_first_person": 0,
    "query.is_first_person": 0,
    "ctrl.idle": 1,
    "c.idle": 1,
    "ctrl.walk": 0,
    "ctrl.run": 0,
    "ctrl.jump": 0,
    "ctrl.fly": 0,
    "ctrl.elytra_fly": 0,
    "ctrl.sneak": 0,
    "ctrl.sneaking": 0,
    "ctrl.playing_extra_animation": 0,
    "c.playing_extra_animation": 0,
    "ctrl.model_switching": 0,
    "c.model_switching": 0,
    "ysm.head_yaw": 0,
    "ysm.head_pitch": 0,
    "ysm.has_mainhand": 0,
    "ysm.has_offhand": 0,
  };
  for (const button of openYsm?.extraAnimationButtons || []) {
    for (const form of configFormsFromButton(button)) {
      if (form?.value) vars[form.value] = 0;
      if (form?.type === "radio" && form?.labels && typeof form.labels === "object") {
        const firstScript = Object.values(form.labels)[0];
        if (firstScript !== undefined) {
          vars = applyOpenYsmExpression(
            vars,
            firstScript,
            {
              key: form.value,
              value: 0,
            },
            openYsm,
          );
        }
      }
      for (const script of Object.values(form?.labels || {})) {
        for (const key of Object.keys(parseMolangAssignments(script))) {
          if (vars[key] === undefined) vars[key] = 0;
        }
      }
    }
  }
  for (const script of openYsm?.events?.player_init || []) {
    vars = applyOpenYsmExpression(vars, script, null, openYsm);
  }
  for (const script of openYsm?.events?.player_update || []) {
    vars = applyOpenYsmExpression(vars, script, null, openYsm);
  }
  return vars;
}

function findYsmJson(files) {
  return files.find((f) => normalizePath(f.path).endsWith("ysm.json")) || null;
}

function readText(file) {
  return decoder.decode(file.data);
}

function normalizePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}

function baseName(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
}

function stripExt(path) {
  return baseName(path).replace(/\.[^.]+$/, "");
}

function sourceName(path) {
  return stripExt(path);
}

function findFile(files, ref) {
  const wanted = normalizePath(ref);
  if (!wanted) return null;
  const wantedNoExt = wanted.replace(/\.[^.]+$/, "");
  const exact = files.find((f) => {
    const p = normalizePath(f.path);
    return p === wanted || p.endsWith(`/${wanted}`);
  });
  if (exact) return exact;

  return (
    files.find((f) => {
      const p = normalizePath(f.path);
      const pNoExt = p.replace(/\.[^.]+$/, "");
      return pNoExt === wantedNoExt || pNoExt.endsWith(`/${wantedNoExt}`);
    }) ||
    files.find((f) => stripExt(f.path).toLowerCase() === stripExt(wanted).toLowerCase()) ||
    null
  );
}

function parsePlayerModelRefs(modelField) {
  const refs = { main: "", arm: "", legacy: [] };
  if (!modelField) return refs;
  if (typeof modelField === "string") {
    refs.main = modelField;
    refs.legacy = [modelField];
    return refs;
  }
  if (Array.isArray(modelField)) {
    refs.legacy = modelField.filter((item) => typeof item === "string");
    refs.main = refs.legacy[0] || "";
    return refs;
  }
  if (typeof modelField === "object") {
    refs.main = typeof modelField.main === "string" ? modelField.main : "";
    refs.arm = typeof modelField.arm === "string" ? modelField.arm : "";
  }
  return refs;
}

function parseTextureRefs(textureField) {
  const out = [];
  const push = (item, key = "") => {
    if (!item) return;
    if (typeof item === "string") {
      out.push({ key: key || stripExt(item), label: key || stripExt(item), uv: item });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => push(child, key ? `${key}_${index + 1}` : ""));
      return;
    }
    if (typeof item !== "object") return;
    if (item.uv || item.path) {
      out.push({
        key: key || stripExt(item.uv || item.path || ""),
        label: item.name || item.label || key || stripExt(item.uv || item.path || ""),
        uv: item.uv || item.path || "",
        normal: item.normal || "",
        specular: item.specular || "",
      });
      return;
    }
    for (const [childKey, childValue] of Object.entries(item)) {
      push(childValue, childKey);
    }
  };
  push(textureField);
  const seen = new Set();
  return out.filter((item) => {
    const uv = String(item?.uv || "").trim();
    const key = normalizePath(uv);
    if (!uv || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectOpenYsmTextures(files, refs, properties = {}) {
  const imageFiles = files.filter((f) => {
    const low = normalizePath(f.path);
    return (
      !low.startsWith("avatar/") &&
      (low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg"))
    );
  });

  const orderedRefs = refs.length
    ? refs
    : imageFiles
        .filter((file) => isLikelyPlayerTexturePath(file.path))
        .map((file) => ({ uv: file.path }));
  const used = new Set();
  const items = [];

  for (const ref of orderedRefs) {
    const file = findFile(files, ref.uv);
    if (!file || used.has(file.path)) continue;
    used.add(file.path);
    items.push(textureItemFromFile(file, ref));
  }
  if (!refs.length && items.length === 0) {
    for (const file of imageFiles.filter((item) => !isNonPlayerImagePath(item.path))) {
      if (used.has(file.path)) continue;
      used.add(file.path);
      items.push(textureItemFromFile(file, { uv: file.path }));
      if (items.length >= 4) break;
    }
  }

  const defaultTexture = stripExt(properties.default_texture || "");
  if (defaultTexture && items.length > 1) {
    const idx = items.findIndex(
      (item) =>
        item.key.toLowerCase() === defaultTexture.toLowerCase() ||
        stripExt(item.path).toLowerCase() === defaultTexture.toLowerCase(),
    );
    if (idx > 0) {
      const [item] = items.splice(idx, 1);
      items.unshift(item);
    }
  }

  return {
    items,
    maxWidth: Math.max(0, ...items.map((item) => item.width || 0)),
    maxHeight: Math.max(0, ...items.map((item) => item.height || 0)),
  };
}

function isNonPlayerImagePath(path) {
  const low = normalizePath(path);
  return /(^|\/)(avatar|background|gui|icon|icons|preview|previews|vehicle|vehicles|projectile|projectiles|item|items|arm|arms|sound|sounds)\//i.test(low);
}

function isLikelyPlayerTexturePath(path) {
  const low = normalizePath(path);
  if (isNonPlayerImagePath(low)) return false;
  if (/(^|\/)(textures?|skins?|skin|player|main)\//i.test(low)) return true;
  const name = baseName(low).toLowerCase();
  return /(default|main|player|skin|texture|tex)/i.test(name);
}

function configFormsFromButton(button) {
  return button?.config_forms || button?.configForms || button?.forms || [];
}

function isLikelyShapeControl(title, buttonName) {
  const text = `${title} ${buttonName}`.toLowerCase();
  const positive =
    /(形态|形態|模型|人物|身体|身體|本体|本體|模式|种类|種類|类型|類型|样式|樣式|预设|預設|外观|外觀|skin|form|body|model|type|style|preset)/i;
  const negative =
    /(眼|瞳|嘴|口|眉|表情|高光|大小|位置|位移|旋转|旋轉|颜色|顏色|透明|睫毛|mouth|eye|brow|face|size|position|rotation|color)/i;
  return positive.test(text) && !negative.test(text);
}

export function parseOpenYsmAssignments(script, variables = {}) {
  const out = {};
  const working = { ...(variables || {}) };
  for (const assignment of extractMolangAssignments(script)) {
    const value = evaluateAssignmentValue(assignment.expr, working);
    out[assignment.key] = value;
    working[assignment.key] = value;
  }
  return out;
}

export function applyOpenYsmExpression(variables = {}, expression = "", fallback = null, openYsm = null) {
  const next = { ...(variables || {}) };
  const script = expandOpenYsmFunctionStatements(stripMolangComments(expression), openYsm);
  const afterBranches = applySimpleMolangBranches(next, script, openYsm);
  const assignments = extractMolangAssignments(afterBranches.remaining);
  const assigned = new Set();
  for (const assignment of assignments) {
    afterBranches.variables[assignment.key] = evaluateAssignmentValue(
      assignment.expr,
      afterBranches.variables,
    );
    assigned.add(assignment.key);
  }
  if (fallback?.key && !assigned.has(fallback.key)) {
    afterBranches.variables[fallback.key] = Number(fallback.value) || 0;
  }
  return afterBranches.variables;
}

function parseMolangAssignments(script) {
  return parseOpenYsmAssignments(script);
}

function stripMolangComments(script) {
  return String(script || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function functionScriptMap(openYsm) {
  const map = new Map();
  for (const fn of openYsm?.functions || []) {
    const name = String(fn?.name || "").trim().toLowerCase();
    if (!name || map.has(name)) continue;
    map.set(name, fn.script || "");
  }
  return map;
}

function expandOpenYsmFunctionStatements(script, openYsm, depth = 0) {
  const text = String(script || "");
  if (!openYsm?.functions?.length || depth > 3) return text;
  const functions = functionScriptMap(openYsm);
  if (!functions.size) return text;

  const parts = text.split(/([;\n\r]+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const statement = parts[i].trim();
    const match = statement.match(/^(?:function\.)?([A-Za-z_][\w]*)\s*\([^)]*\)$/);
    if (!match) continue;
    const fnScript = functions.get(match[1].toLowerCase());
    if (fnScript) parts[i] = expandOpenYsmFunctionStatements(fnScript, openYsm, depth + 1);
  }
  return parts.join("");
}

function applySimpleMolangBranches(variables, script, openYsm) {
  let vars = variables;
  let remaining = String(script || "");
  const branchRe = /if\s*\(([^{};]+)\)\s*\{([^{}]*)\}(?:\s*else\s*\{([^{}]*)\})?/gi;
  remaining = remaining.replace(branchRe, (_all, condition, truthy, falsy = "") => {
    const selected =
      Math.abs(evaluateMolangExpression(condition, { variables: vars }, 0)) > 0.0001
        ? truthy
        : falsy;
    if (selected) {
      vars = applyOpenYsmExpression(vars, selected, null, openYsm);
    }
    return ";";
  });
  return { variables: vars, remaining };
}

function extractMolangAssignments(script) {
  const text = stripMolangComments(script);
  const out = [];
  const re = /(?:^|[;{}\n\r])\s*((?:(?:v|variable|temp|t|q|query)\.)?[A-Za-z_][\w.]*)\s*=(?!=)\s*([^;{}\n\r]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const expr = String(m[2] || "").trim();
    if (!expr || expr.includes("=>")) continue;
    out.push({ key: m[1], expr });
  }
  return out;
}

function evaluateAssignmentValue(expr, variables) {
  const text = String(expr || "").trim();
  if (!text) return 0;
  if (/^true$/i.test(text)) return 1;
  if (/^false$/i.test(text)) return 0;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const value = evaluateMolangExpression(text, { variables }, 0);
  return Number.isFinite(value) ? value : 0;
}

function textureItemFromFile(file, ref) {
  const low = normalizePath(file.path);
  const mime = low.endsWith(".jpg") || low.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  const blob = new Blob([file.data], { type: mime });
  const dim = readImageDimensions(file.data);
  const key = ref.key || stripExt(ref.uv || file.path);
  return {
    key,
    label: ref.label || key || baseName(file.path),
    path: file.path,
    url: URL.createObjectURL(blob),
    width: dim.w,
    height: dim.h,
    normalPath: ref.normal || "",
    specularPath: ref.specular || "",
  };
}

function parseMainGeometry(files, modelRefs, textures, devLog, subEntities = []) {
  const mainFile =
    findFile(files, modelRefs.main) ||
    findFile(files, "models/main.json") ||
    findLikelyGeometryFile(files);
  if (!mainFile) return null;

  const variants = [];
  const parseOne = (file, forceName = "") => {
    try {
      const jsonStr = readText(file);
      const parsed = parseBedrockGeometryVariantsFromJSON(jsonStr, file.path);
      const first = parsed[0] || selectPrimaryVariant(parsed)?.variants?.[0];
      if (!first?.bones?.length) return null;
      if (forceName) first.name = forceName;
      return first;
    } catch (e) {
      devLog(`[OpenYSM] ${file.path} 几何解析失败：${e?.message || e}`);
      return null;
    }
  };

  const parseMany = (file, preferred = []) => {
    try {
      const parsed = parseBedrockGeometryVariantsFromJSON(readText(file), file.path);
      const selected = selectPrimaryVariant(parsed, preferred);
      const ordered = selected?.variants?.length ? selected.variants : parsed;
      return ordered.filter((variant) => variant?.bones?.length);
    } catch (e) {
      devLog(`[OpenYSM] ${file.path} 几何解析失败：${e?.message || e}`);
      return [];
    }
  };

  variants.push(...parseMany(mainFile, [modelRefs.main, "main"]));
  const main = variants[0];
  if (!main) return null;

  if (modelRefs.legacy.length > 1) {
    for (const ref of modelRefs.legacy.slice(1, 8)) {
      const file = findFile(files, ref);
      if (!file || file.path === mainFile.path) continue;
      const extraVariants = parseMany(file, [ref]).slice(0, 4);
      for (const variant of extraVariants) {
        if (!variant.name || variant.name === "unknown") variant.name = stripExt(ref);
        variants.push(variant);
      }
    }
  }

  for (const entity of subEntities || []) {
    if (!entity.model) continue;
    const file = findFile(files, entity.model);
    if (!file || file.path === mainFile.path) continue;
    const texIndex = textureIndexForEntity(textures, entity);
    const extraVariants = parseMany(file, [entity.model]).slice(0, 3);
    for (const [index, variant] of extraVariants.entries()) {
      const prefix = entity.kind === "vehicle" ? "载具" : "投射物";
      const base = entity.label || entity.id || stripExt(entity.model);
      variant.name = `${prefix} · ${base}${extraVariants.length > 1 ? ` ${index + 1}` : ""}`;
      variant.texIndex = texIndex;
      variant.texIdx = texIndex;
      variant._subEntityKind = entity.kind;
      variant._subEntityId = entity.id;
      variant._variantAliases = [
        entity.id,
        entity.label,
        entity.model,
        sourceName(entity.model),
        ...entity.matchIds,
        ...entity.animations.flatMap((ref) => [ref.key, ref.path, sourceName(ref.path)]),
      ].filter(Boolean);
      variants.push(variant);
    }
  }

  const uvBounds = detectUVBounds(main);
  const tex = textures.items[0] || null;
  for (const variant of variants) {
    const texIndex = Number.isInteger(variant.texIndex) ? variant.texIndex : 0;
    const variantTex = textures.items[texIndex] || tex;
    const variantUvBounds = detectUVBounds(variant);
    const texW = Math.max(variant.texWidth || 0, variantTex?.width || 0, variantUvBounds.w, 64);
    const texH = Math.max(variant.texHeight || 0, variantTex?.height || 0, variantUvBounds.h, 64);
    variant.texIndex = texIndex;
    variant.texIdx = texIndex;
    variant.texWidth = texW;
    variant.texHeight = texH;
    applyTextureMetaToBones(variant, variantTex, texW, texH);
  }

  return {
    path: mainFile.path,
    geometry: main,
    variants,
    uvBounds,
    texMappingLog: [
      {
        file: baseName(mainFile.path),
        texKey: tex?.key || "-",
        texIdx: 0,
        pngSize: tex?.width ? `${tex.width}x${tex.height}` : "-",
        geoSize: main.texWidth ? `${main.texWidth}x${main.texHeight}` : "-",
        uvSize: `${uvBounds.w}x${uvBounds.h}`,
        finalSize: `${main.texWidth || 64}x${main.texHeight || 64}`,
      },
    ],
  };
}

function textureIndexForEntity(textures, entity) {
  const refs = entity?.textures || [];
  for (const ref of refs) {
    const wanted = normalizePath(ref.uv);
    if (!wanted) continue;
    const index = (textures.items || []).findIndex((item) => {
      const path = normalizePath(item.path);
      return path === wanted || path.endsWith(`/${wanted}`) || wanted.endsWith(`/${path}`);
    });
    if (index >= 0) return index;
  }
  return 0;
}

function findLikelyGeometryFile(files) {
  return (
    files.find((f) => normalizePath(f.path).endsWith("models/main.json")) ||
    files.find((f) => normalizePath(f.path).startsWith("models/") && normalizePath(f.path).endsWith(".json")) ||
    null
  );
}

function applyTextureMetaToBones(model, texture, texW, texH) {
  for (const bone of model?.bones || []) {
    for (const cube of bone.cubes || []) {
      cube._texIdx = 0;
      cube._texUrl = texture?.url || null;
      cube._texWidth = texW || texture?.width || model.texWidth || 64;
      cube._texHeight = texH || texture?.height || model.texHeight || 64;
    }
  }
}

function parseOpenYsmSubEntityAnimations(files, subEntities, devLog) {
  const refs = {};
  for (const entity of subEntities || []) {
    for (const ref of entity.animations || []) {
      if (!ref.path) continue;
      refs[`${entity.kind}_${entity.id}_${ref.key || "animation"}`] = ref.path;
    }
  }
  if (!Object.keys(refs).length) return { clips: [], files: [] };
  return parseOpenYsmAnimations(files, refs, devLog);
}

function mergeOpenYsmAnimations(...bundles) {
  const clips = [];
  const files = [];
  const seen = new Set();
  for (const bundle of bundles || []) {
    files.push(...(bundle?.files || []));
    for (const clip of bundle?.clips || []) {
      const key = `${clip.name}:${clip.length || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clips.push(clip);
    }
  }
  return { clips, files };
}

function parseOpenYsmAnimations(files, animationField, devLog) {
  const refs = [];
  if (typeof animationField === "string") refs.push({ key: "main", path: animationField });
  if (Array.isArray(animationField)) {
    animationField.forEach((path, i) => {
      if (typeof path === "string") refs.push({ key: `animation_${i + 1}`, path });
    });
  }
  if (animationField && typeof animationField === "object" && !Array.isArray(animationField)) {
    for (const [key, path] of Object.entries(animationField)) {
      if (typeof path === "string") refs.push({ key, path });
    }
  }

  const filesToParse = refs.length
    ? refs.map((ref) => ({ ...ref, file: findFile(files, ref.path) })).filter((ref) => ref.file)
    : files
        .filter((f) => {
          const low = normalizePath(f.path);
          return low.endsWith(".json") && low.includes("animation") && !low.includes("controller");
        })
        .map((file) => ({ key: stripExt(file.path), path: file.path, file }));

  const clips = [];
  const parsedFiles = [];
  const seen = new Set();
  for (const ref of filesToParse) {
    try {
      const jsonStr = readText(ref.file);
      const { clips: parsedClips } = parseBedrockAnimationJSON(jsonStr);
      const names = [];
      for (const clip of parsedClips) {
        const key = `${clip.name}:${clip.length || 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        clip._openYsmFile = ref.path;
        clip._openYsmGroup = ref.key;
        names.push(clip.name);
        clips.push(clip);
      }
      parsedFiles.push({ key: ref.key, path: ref.path, clipNames: names });
    } catch (e) {
      devLog(`[OpenYSM] ${ref.path} 动画解析失败：${e?.message || e}`);
    }
  }
  return { clips, files: parsedFiles };
}

function parseOpenYsmControllers(files, controllerField, devLog) {
  const refs = Array.isArray(controllerField)
    ? controllerField.filter((item) => typeof item === "string")
    : typeof controllerField === "string"
      ? [controllerField]
      : [];
  const out = [];
  for (const ref of refs) {
    const file = findFile(files, ref);
    if (!file) continue;
    try {
      const root = JSON.parse(readText(file));
      const controllers = root.animation_controllers || {};
      for (const [name, controller] of Object.entries(controllers)) {
        const states = [];
        for (const [stateName, state] of Object.entries(controller?.states || {})) {
          const animationSlots = parseControllerAnimations(state?.animations);
          states.push({
            name: stateName,
            animations: animationSlots.map((slot) => slot.name),
            animationSlots,
            transitions: parseControllerTransitions(state?.transitions),
            onEntry: parseControllerScriptList(state?.on_entry),
            onExit: parseControllerScriptList(state?.on_exit),
          });
        }
        out.push({
          name,
          label: stripControllerName(name),
          path: ref,
          initialState: controller?.initial_state || "",
          states,
        });
      }
    } catch (e) {
      devLog(`[OpenYSM] ${ref} 控制器解析失败：${e?.message || e}`);
    }
  }
  return out;
}

function parseOpenYsmFunctions(files, devLog) {
  const functions = [];
  const events = {};
  for (const file of files || []) {
    if (!isOpenYsmFunctionPath(file.path)) continue;
    try {
      const script = readText(file);
      const id = stripExt(file.path);
      const rawName = baseName(id);
      const atIndex = rawName.indexOf("@");
      const name = atIndex > 0 ? rawName.slice(0, atIndex) : rawName;
      const event = atIndex >= 0 ? rawName.slice(atIndex + 1).toLowerCase() : "";
      const item = {
        name,
        event,
        path: file.path,
        script,
        assignments: parseOpenYsmAssignments(script),
      };
      functions.push(item);
      if (event) {
        if (!events[event]) events[event] = [];
        events[event].push(script);
      }
    } catch (e) {
      devLog(`[OpenYSM] ${file.path} 函数解析失败：${e?.message || e}`);
    }
  }
  return { functions, events };
}

function parseControllerAnimations(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push({ name: item, expr: "" });
    } else if (item && typeof item === "object") {
      for (const [name, expr] of Object.entries(item)) {
        out.push({ name, expr: String(expr ?? "") });
      }
    }
  }
  return out.filter((item) => item.name);
}

function parseControllerAnimationNames(value) {
  return parseControllerAnimations(value).map((item) => item.name);
}

function parseControllerScriptList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "")).filter(Boolean);
  if (typeof value === "string") return [value];
  return [];
}

function parseControllerTransitions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      for (const [target, expr] of Object.entries(item)) out.push({ target, expr: String(expr) });
    }
  }
  return out;
}

function normalizeProperties(properties) {
  return {
    defaultTexture: properties.default_texture || "",
    previewAnimation: properties.preview_animation || "",
    widthScale: Number(properties.width_scale) || 0.7,
    heightScale: Number(properties.height_scale) || 0.7,
    allCutout: !!properties.all_cutout,
    renderLayersFirst: !!properties.render_layers_first,
    disablePreviewRotation: !!properties.disable_preview_rotation,
    guiNoLighting: !!properties.gui_no_lighting,
  };
}

function parseExtraAnimations(properties) {
  const raw = properties.extra_animation || {};
  return Object.entries(raw)
    .map(([id, value]) => {
      const label = typeof value === "string" ? value : value?.name || value?.label || id;
      const target = typeof value === "string" ? value : value?.animation || value?.target || id;
      return { id, label, target };
    })
    .filter((item) => item.id && !item.id.startsWith("#"));
}

function parseExtraAnimationRoot(properties) {
  const raw = properties.extra_animation || {};
  return Object.entries(raw)
    .map(([id, value]) => {
      const text = typeof value === "string" ? value : value?.name || value?.label || id;
      const target = typeof value === "string" ? value : value?.animation || value?.target || id;
      return { id, label: text || id, target: target || id };
    })
    .filter((item) => item.id);
}

function parseExtraClassifies(properties) {
  const rootNames = properties.extra_animation || {};
  return (properties.extra_animation_classify || []).map((group) => {
    const id = group.id || "";
    const groupName = group.name || rootNames[`#${id}`] || id || "额外动作";
    const items = Object.entries(group.extra_animation || {}).map(([key, value]) => ({
      id: key,
      label: typeof value === "string" && !value.startsWith("#") ? value : key,
      target: typeof value === "string" ? value : key,
    }));
    return { id, name: groupName, items };
  });
}

function listSubEntityKeys(section) {
  if (!section) return [];
  if (Array.isArray(section)) {
    return section.map((item, i) => item?.match || item?.model || `entity_${i + 1}`);
  }
  if (typeof section === "object") return Object.keys(section);
  return [];
}

function flattenControllerStates(controllers) {
  const out = [];
  for (const controller of controllers || []) {
    for (const state of controller.states || []) {
      out.push({
        ...state,
        controller: controller.name,
        controllerLabel: controller.label || controller.name,
        animationSlots:
          state.animationSlots ||
          (state.animations || []).map((name) => ({ name, expr: "" })),
      });
    }
  }
  return out;
}

function resolveClipForCandidates(candidates, clips, states) {
  const expanded = [];
  for (const candidate of candidates || []) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    expanded.push(text);
    const state = states.find((item) => sameKey(item.name, text));
    if (state) expanded.push(...(state.animations || []));
  }
  for (const candidate of expanded) {
    const clip = matchClip(candidate, clips);
    if (clip) return clip;
  }
  return null;
}

function matchClip(candidate, clips) {
  const target = normalizeAnimName(candidate);
  if (!target) return null;
  return (
    clips.find((clip) => normalizeAnimName(clip.name) === target) ||
    clips.find((clip) => normalizeAnimName(clip.name).endsWith(`.${target}`)) ||
    clips.find((clip) => normalizeAnimName(clip.name).split(".").pop() === target) ||
    null
  );
}

function normalizeAnimName(value) {
  return String(value || "")
    .trim()
    .replace(/^animation\./, "")
    .replace(/^controller\.animation\./, "")
    .toLowerCase();
}

function sameKey(a, b) {
  return normalizeAnimName(a) === normalizeAnimName(b);
}

function stripControllerName(name) {
  return String(name || "")
    .replace(/^controller\.animation\./, "")
    .replace(/^controller\./, "")
    .replace(/^ysm\./, "");
}

function detectUVBounds(parsed) {
  let w = 2;
  let h = 2;
  for (const b of parsed?.bones || []) {
    for (const c of b.cubes || []) {
      const [sx, sy, sz] = c.size || [0, 0, 0];
      if (Array.isArray(c.uv) && c.uv.length >= 2) {
        const [u, v] = c.uv;
        w = Math.max(w, u + 2 * (Math.abs(sx) + Math.abs(sz)));
        h = Math.max(h, v + Math.abs(sy) + Math.abs(sz) * 2);
      } else if (c.faceUV) {
        try {
          const faces = JSON.parse(c.faceUV);
          for (const face of Object.values(faces)) {
            if (!face?.uv) continue;
            const fw = Math.abs(face.uv_size?.[0] || 0);
            const fh = Math.abs(face.uv_size?.[1] || 0);
            w = Math.max(w, face.uv[0] + fw);
            h = Math.max(h, face.uv[1] + fh);
          }
        } catch (_) {}
      }
    }
  }
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

function readImageDimensions(data) {
  const arr = new Uint8Array(data);
  if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e) {
    return {
      w: (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19],
      h: (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23],
    };
  }
  if (arr[0] === 0xff && arr[1] === 0xd8) {
    for (let i = 2; i < Math.min(arr.length - 8, 4096); i++) {
      if (arr[i] === 0xff && (arr[i + 1] & 0xf0) === 0xc0) {
        return {
          h: (arr[i + 5] << 8) | arr[i + 6],
          w: (arr[i + 7] << 8) | arr[i + 8],
        };
      }
    }
  }
  return { w: 0, h: 0 };
}
