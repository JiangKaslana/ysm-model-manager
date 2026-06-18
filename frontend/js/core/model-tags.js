// ===== 模型标签（本地存储） =====
// 后端暂无标签字段，AI 整理生成的标签先按绝对路径存在 localStorage。

const LS_KEY = "model-tags";

function normalize(path) {
  return (path || "").replace(/\\/g, "/");
}

function loadMap() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveMap(map) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[model-tags] save failed:", err);
  }
}

export function getTags(path) {
  return loadMap()[normalize(path)] || [];
}

export function setTags(path, tags) {
  const map = loadMap();
  const arr = (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag).trim())
    .filter(Boolean);
  if (arr.length) map[normalize(path)] = arr;
  else delete map[normalize(path)];
  saveMap(map);
}
