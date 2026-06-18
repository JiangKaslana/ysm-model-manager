export const DEFAULT_STATS = { repo: 0, ver: 0, ok: 0, tot: 0, pending: 0 };

function toArr3(v) {
  if (!v) return [0, 0, 0];
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return [v.x || 0, v.y || 0, v.z || 0];
  return [0, 0, 0];
}

function variantName(source, identifier, index) {
  if (identifier && String(identifier).toLowerCase() !== "unknown") {
    const parts = String(identifier).split(".");
    return parts[parts.length - 1] || identifier;
  }
  if (source) {
    return String(source)
      .split("/")
      .pop()
      .split("\\")
      .pop()
      .replace(/\.\w+$/, "");
  }
  return `model_${index + 1}`;
}

function parseOneGeometry(geo, source = "", index = 0) {
  if (!geo?.bones?.length) return null;
  const bones = [];
  let cubeCount = 0;
  for (const b of geo.bones) {
    const cubes = [];
    for (const c of b.cubes || []) {
      let uv = [0, 0];
      let faceUV = "";
      if (Array.isArray(c.uv)) {
        uv = c.uv;
      } else if (typeof c.uv === "string" && c.uv.startsWith("{")) {
        faceUV = c.uv;
      } else if (typeof c.uv === "object" && c.uv !== null) {
        if (Array.isArray(c.uv.uv)) uv = c.uv.uv;
        faceUV = JSON.stringify(c.uv);
      }
      cubes.push({
        origin: toArr3(c.origin),
        size: toArr3(c.size),
        pivot: toArr3(c.pivot),
        rotation: toArr3(c.rotation),
        uv,
        faceUV,
        texSlot: typeof c.texture === "number" ? c.texture : 0,
        inflate: c.inflate || b.inflate || 0,
        mirror: !!(c.mirror ?? b.mirror),
      });
    }
    bones.push({
      name: b.name,
      parent: b.parent || null,
      pivot: toArr3(b.pivot),
      rotation: toArr3(b.rotation),
      cubes,
    });
    cubeCount += cubes.length;
  }
  const identifier = geo.description?.identifier || "";
  return {
    name: variantName(source, identifier, index),
    identifier,
    source,
    boneCount: bones.length,
    cubeCount,
    texWidth: geo.description?.texture_width || 0,
    texHeight: geo.description?.texture_height || 0,
    bones,
  };
}

function scoreVariant(v, preferred = []) {
  const key = `${v.source || ""} ${v.identifier || ""} ${v.name || ""}`.toLowerCase();
  let score = 1000;
  const source = String(v.source || "").replace(/\\/g, "/").toLowerCase();
  const base = source.split("/").pop();
  preferred.forEach((p, i) => {
    const pp = String(p || "").replace(/\\/g, "/").toLowerCase();
    const pb = pp.split("/").pop();
    if (source === pp || base === pb || source.endsWith(`/${pp}`)) {
      score = Math.min(score, i * 100);
    }
  });
  if (key.includes("main")) score -= 90;
  if (key.includes("default") || key.includes("player") || key.includes("body"))
    score -= 45;
  for (const bad of ["arm", "hand", "item", "wing", "tail", "hair", "extra", "layer"]) {
    if (key.includes(bad)) score += 35;
  }
  if ((v.cubeCount || 0) <= 2) score += 80;
  score -= Math.min(v.cubeCount || 0, 200) / 12;
  return score;
}

export function selectPrimaryVariant(variants, preferred = []) {
  if (!variants?.length) return null;
  let best = 0;
  let bestScore = scoreVariant(variants[0], preferred);
  for (let i = 1; i < variants.length; i++) {
    const score = scoreVariant(variants[i], preferred);
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  }
  const ordered = [variants[best], ...variants.filter((_, i) => i !== best)];
  return { ...ordered[0], activeVariant: 0, variants: ordered };
}

export function applyModelVariant(model, index = 0) {
  if (!model?.variants?.length) return model;
  const safe = Math.max(0, Math.min(model.variants.length - 1, Number(index) || 0));
  const v = model.variants[safe];
  const next = {
    ...model,
    name: v.name,
    identifier: v.identifier,
    source: v.source,
    texIndex: v.texIndex ?? 0,
    texIdx: v.texIdx ?? v.texIndex ?? 0,
    boneCount: v.boneCount,
    cubeCount: v.cubeCount,
    texWidth: v.texWidth,
    texHeight: v.texHeight,
    bones: v.bones,
    activeVariant: safe,
    _subEntityKind: v._subEntityKind,
    _subEntityId: v._subEntityId,
    _variantAliases: v._variantAliases,
  };
  if (next.textures?.length && next.texIndex > 0 && next.textures[next.texIndex]) {
    next.texture = next.textures[next.texIndex];
  }
  return next;
}

export function parseBedrockGeometryVariantsFromJSON(jsonStr, source = "") {
  const raw = JSON.parse(jsonStr);
  const geoList = raw?.["minecraft:geometry"] || raw?.minecraft?.geometry || [];
  if (!Array.isArray(geoList)) return [];
  return geoList
    .map((geo, i) => parseOneGeometry(geo, source, i))
    .filter((model) => model?.bones?.length);
}

export function parseBedrockGeometryFromJSON(jsonStr, source = "") {
  return selectPrimaryVariant(parseBedrockGeometryVariantsFromJSON(jsonStr, source));
}
