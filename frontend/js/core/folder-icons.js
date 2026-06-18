// ===== 文件夹自定义图标 =====
// 文件夹只显示用户手动指定的图片；不要为文件夹自动解析或渲染模型缩略图。

const LS_KEY = "gallery-folder-icons";

function normalize(path) {
  return (path || "").replace(/\\/g, "/").replace(/\/+$/, "");
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
    return true;
  } catch (err) {
    console.warn("[folder-icons] save failed:", err);
    return false;
  }
}

export function getFolderIcon(path) {
  return loadMap()[normalize(path)] || "";
}

export function setFolderIcon(path, dataURL) {
  const map = loadMap();
  map[normalize(path)] = dataURL;
  return saveMap(map);
}

export function removeFolderIcon(path) {
  const map = loadMap();
  delete map[normalize(path)];
  return saveMap(map);
}

export function pickImageDataURL({ maxSize = 256 } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve("");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let width = img.width || maxSize;
          let height = img.height || maxSize;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          try {
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/png"));
          } catch {
            resolve(String(reader.result || ""));
          }
        };
        img.onerror = () => resolve("");
        img.src = String(reader.result || "");
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}
