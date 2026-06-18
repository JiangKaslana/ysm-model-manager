// Lightweight Bedrock animation parser/evaluator for preview.
// OpenYSM converts rotation channels to (-X, -Y, +Z) radians at parse time.
// This module keeps degrees in clips for compatibility with the current 2D/3D
// preview surfaces; model3d.js applies the OpenYSM signs and ZYX order.

function foldMolangConstant(str) {
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  const direct = Number(trimmed);
  if (!Number.isNaN(direct)) return direct;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  let m = trimmed.match(
    /^(?:q\.|t\.|query\.|temp\.|math\.)\w+\s*\*\s*0\s*([+-])\s*([+-]?\d+(?:\.\d+)?)$/,
  );
  if (m) {
    const num = Number(m[2]);
    return m[1] === "-" ? -num : num;
  }

  m = trimmed.match(
    /^([+-]?\d+(?:\.\d+)?)\s*[+-]\s*(?:q\.|t\.|query\.|temp\.|math\.)\w+\s*\*\s*0$/,
  );
  if (m) return Number(m[1]);

  if (/^(?:q\.|t\.|query\.|temp\.|math\.)\w+\s*\*\s*0$/.test(trimmed)) {
    return 0;
  }
  return null;
}

function parseScalar(v) {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const folded = foldMolangConstant(v);
    return folded === null ? v.trim() : folded;
  }
  return null;
}

function parseKeyValue(v) {
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const source = v.length >= 3 ? v.slice(0, 3) : [v[0], v[0], v[0]];
    const nums = source.map((item) => parseScalar(item));
    if (nums.every((n) => n !== null)) return nums;
    return nums.map((n) => (n === null ? 0 : n));
  }
  const scalar = parseScalar(v);
  return scalar === null ? null : [scalar, scalar, scalar];
}

function isDirectKeyframeObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return (
    Object.prototype.hasOwnProperty.call(v, "vector") ||
    Object.prototype.hasOwnProperty.call(v, "pre") ||
    Object.prototype.hasOwnProperty.call(v, "post")
  );
}

function normalizeLerpMode(mode, fallback = "linear") {
  const text = String(mode || fallback).toLowerCase();
  if (text === "catmullrom") return "catmullrom";
  if (text === "step") return "step";
  return "linear";
}

function extractKeyframe(kv) {
  if (kv === null || kv === undefined) return null;
  if (Array.isArray(kv) || typeof kv !== "object") {
    const val = parseKeyValue(kv);
    return val ? { post: val, pre: val, lerp: "linear" } : null;
  }

  const vector = kv.vector !== undefined ? parseKeyValue(kv.vector) : null;
  if (vector) {
    return {
      post: vector,
      pre: vector,
      lerp: normalizeLerpMode(kv.easing || kv.lerp_mode),
    };
  }

  const post = kv.post !== undefined ? parseKeyValue(kv.post) : null;
  const pre = kv.pre !== undefined ? parseKeyValue(kv.pre) : post;
  if (!post) return null;
  return {
    post,
    pre,
    lerp: normalizeLerpMode(kv.lerp_mode, pre !== post ? "step" : "linear"),
  };
}

function parseChannel(channelData) {
  if (channelData === null || channelData === undefined) return [];
  if (typeof channelData !== "object" || Array.isArray(channelData)) {
    const kf = extractKeyframe(channelData);
    return kf ? [{ time: 0, post: kf.post, pre: kf.pre, lerp: kf.lerp }] : [];
  }
  if (isDirectKeyframeObject(channelData)) {
    const kf = extractKeyframe(channelData);
    return kf ? [{ time: 0, post: kf.post, pre: kf.pre, lerp: kf.lerp }] : [];
  }

  const times = Object.keys(channelData)
    .map(Number)
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  return times
    .map((time) => {
      const kf = extractKeyframe(channelData[String(time)] ?? channelData[time]);
      return kf ? { time, post: kf.post, pre: kf.pre, lerp: kf.lerp } : null;
    })
    .filter(Boolean);
}

function valueHasMolang(v) {
  if (typeof v === "string") return typeof parseScalar(v) === "string";
  if (Array.isArray(v)) return v.some(valueHasMolang);
  if (v && typeof v === "object") {
    return Object.values(v).some(valueHasMolang);
  }
  return false;
}

function hasMolangInChannelData(data) {
  return valueHasMolang(data);
}

function parseLoopType(value) {
  if (value === true) return "loop";
  if (value === false || value === null || value === undefined) return "play_once";
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "loop") return "loop";
  if (text === "hold_on_last_frame") return "hold_on_last_frame";
  return "play_once";
}

export function parseBedrockAnimationJSON(jsonStr) {
  const errors = [];
  let root;
  try {
    root = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
  } catch (e) {
    return { clips: [], errors: [`JSON parse failed: ${e.message}`] };
  }

  const anims = root?.animations;
  if (!anims || typeof anims !== "object") {
    return { clips: [], errors: ["Missing animations field"] };
  }

  const clips = [];
  for (const [name, anim] of Object.entries(anims)) {
    if (!anim || typeof anim !== "object") continue;
    const bones = anim.bones;
    if (!bones || typeof bones !== "object") continue;

    const loopType = parseLoopType(anim.loop);
    const clip = {
      name,
      loop: loopType === "loop",
      loopType,
      length: Number(anim.animation_length) || 0,
      bones: {},
      hasMolang: false,
    };

    for (const [boneName, boneData] of Object.entries(bones)) {
      if (!boneData || typeof boneData !== "object") continue;
      const channels = {};
      for (const ch of ["rotation", "position", "scale"]) {
        if (!clip.hasMolang && hasMolangInChannelData(boneData[ch])) {
          clip.hasMolang = true;
        }
        const kfs = parseChannel(boneData[ch]);
        if (kfs.length > 0) channels[ch] = kfs;
      }
      if (Object.keys(channels).length > 0) clip.bones[boneName] = channels;
    }

    if (Object.keys(clip.bones).length === 0) continue;
    if (!clip.length) {
      let maxT = 0;
      for (const chs of Object.values(clip.bones)) {
        for (const ch of ["rotation", "position", "scale"]) {
          const kfs = chs[ch];
          if (kfs?.length) maxT = Math.max(maxT, kfs[kfs.length - 1].time);
        }
      }
      clip.length = maxT || 1;
    }
    clips.push(clip);
  }

  return { clips, errors };
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function evaluateKeyframes(keyframes, t, context = {}) {
  if (!keyframes?.length) return null;
  if (t <= keyframes[0].time) return evalVecAtTime(keyframes[0].post, t, context);
  if (t >= keyframes[keyframes.length - 1].time) {
    return evalVecAtTime(keyframes[keyframes.length - 1].post, t, context);
  }

  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= t) lo = mid;
    else hi = mid;
  }

  const a = keyframes[lo];
  const b = keyframes[hi];
  if (a.lerp === "step") return evalVecAtTime(a.post, t, context);

  const dt = b.time - a.time;
  if (dt <= 0) return a.post ? evalVecAtTime(a.post, t, context) : [0, 0, 0];
  const frac = (t - a.time) / dt;
  const start = evalVecAtTime(a.post || [0, 0, 0], t, context);
  const end = evalVecAtTime(b.pre || b.post || [0, 0, 0], t, context);

  if (a.lerp === "catmullrom") {
    const left = evalVecAtTime(keyframes[Math.max(0, lo - 1)]?.post || start, t, context);
    const right = evalVecAtTime(keyframes[Math.min(keyframes.length - 1, hi + 1)]?.pre || end, t, context);
    return [0, 1, 2].map((i) => catmullRom(left[i], start[i], end[i], right[i], frac));
  }

  return [0, 1, 2].map((i) => start[i] + (end[i] - start[i]) * frac);
}

function evalVecAtTime(vec, t, context = {}) {
  const source = Array.isArray(vec) ? vec : [0, 0, 0];
  return [0, 1, 2].map((i) => evalScalarAtTime(source[i], t, context));
}

function evalScalarAtTime(value, t, context = {}) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const folded = foldMolangConstant(value);
  if (folded !== null) return folded;

  let expr = value.trim().toLowerCase();
  expr = expr.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
  expr = expr
    .replace(/\bmath\.pi\b/g, "Math.PI")
    .replace(/\bmath\.(sin|cos|tan|abs|min|max|floor|ceil|round|sqrt|pow)\b/g, "Math.$1")
    .replace(/\bmath\.(clamp|lerp)\b/g, "$1")
    .replace(/\b(query|q)\.(anim_time|life_time|delta_time)\b/g, "t")
    .replace(/\b(query|q|variable|v|temp|t|ctrl|c|ysm)\.[a-z_][a-z0-9_.]*\b/g, (name) =>
      String(resolveMolangVariable(name, context)),
    )
    .replace(/\bmath\./g, "Math.");
  if (!/^[0-9+\-*/%().,?:<>=!&|\s_a-zA-Z]+$/.test(expr)) return 0;
  if (/[a-zA-Z_]/.test(expr.replace(/\b(Math|PI|sin|cos|tan|abs|min|max|floor|ceil|round|sqrt|pow|clamp|lerp|t)\b/g, ""))) {
    return 0;
  }
  try {
    const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
    const lerp = (a, b, f) => a + (b - a) * f;
    const result = Function("Math", "t", "clamp", "lerp", `"use strict"; return (${expr});`)(
      Math,
      t,
      clamp,
      lerp,
    );
    return Number.isFinite(result) ? result : 0;
  } catch (_) {
    return 0;
  }
}

function resolveMolangVariable(name, context = {}) {
  const vars = context.variables || context.vars || context || {};
  if (vars[name] !== undefined) return Number(vars[name]) || 0;
  const bare = String(name)
    .replace(/^(variable|v|temp|t|query|q|ctrl|c|ysm)\./, "");
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
  for (const key of aliases) {
    if (vars[key] !== undefined) return Number(vars[key]) || 0;
  }
  const lowerMap = context._lowerVars || null;
  if (lowerMap && lowerMap[name] !== undefined) return Number(lowerMap[name]) || 0;
  const lowered = {};
  for (const [key, value] of Object.entries(vars)) lowered[String(key).toLowerCase()] = value;
  for (const key of aliases) {
    const lowerKey = key.toLowerCase();
    if (lowered[lowerKey] !== undefined) return Number(lowered[lowerKey]) || 0;
  }
  return 0;
}

export function evaluateMolangExpression(expression, context = {}, time = 0) {
  return evalScalarAtTime(expression, time, context);
}

export function evaluateClip(clip, time, boneHierarchy, localOnly, context = {}) {
  const result = new Map();
  if (!clip?.bones) return result;

  let t = time;
  if (clip.loop && clip.length > 0) {
    t = ((t % clip.length) + clip.length) % clip.length;
  } else if (t > clip.length) {
    t = clip.length;
  }

  const local = new Map();
  for (const [boneName, channels] of Object.entries(clip.bones)) {
    const transform = {};
    for (const ch of ["rotation", "position", "scale"]) {
      const val = evaluateKeyframes(channels[ch], t, context);
      if (val) transform[ch] = val;
    }
    if (Object.keys(transform).length > 0) local.set(boneName, transform);
  }

  if (localOnly) return local;

  const parentMap = new Map();
  if (boneHierarchy) {
    for (const b of boneHierarchy) {
      if (b.parent) parentMap.set(b.name, b.parent);
    }
  }

  const allBoneNames = new Set([...local.keys()]);
  if (boneHierarchy) {
    for (const b of boneHierarchy) allBoneNames.add(b.name);
  }

  const sorted = [];
  const visited = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    const p = parentMap.get(name);
    if (p && allBoneNames.has(p)) visit(p);
    sorted.push(name);
  };
  for (const name of allBoneNames) visit(name);

  for (const name of sorted) {
    const tLocal = local.get(name) || {};
    const parentName = parentMap.get(name);
    if (parentName && result.has(parentName)) {
      const pt = result.get(parentName);
      result.set(name, {
        rotation:
          pt.rotation || tLocal.rotation
            ? [
                (pt.rotation?.[0] || 0) + (tLocal.rotation?.[0] || 0),
                (pt.rotation?.[1] || 0) + (tLocal.rotation?.[1] || 0),
                (pt.rotation?.[2] || 0) + (tLocal.rotation?.[2] || 0),
              ]
            : undefined,
        position:
          pt.position || tLocal.position
            ? [
                (pt.position?.[0] || 0) + (tLocal.position?.[0] || 0),
                (pt.position?.[1] || 0) + (tLocal.position?.[1] || 0),
                (pt.position?.[2] || 0) + (tLocal.position?.[2] || 0),
              ]
            : undefined,
        scale:
          pt.scale || tLocal.scale
            ? [
                (pt.scale?.[0] ?? 1) * (tLocal.scale?.[0] ?? 1),
                (pt.scale?.[1] ?? 1) * (tLocal.scale?.[1] ?? 1),
                (pt.scale?.[2] ?? 1) * (tLocal.scale?.[2] ?? 1),
              ]
            : undefined,
      });
    } else if (Object.keys(tLocal).length > 0) {
      result.set(name, { ...tLocal });
    }
  }

  return result;
}
