const dirCache = new Map();

export async function resolvePreviewSelection(selection) {
  const path =
    typeof selection === "string" ? selection : String(selection?.path || "");
  if (!path) return { kind: "empty", path: "" };

  if (selection?.isDir === true) {
    dirCache.set(path, true);
    return { kind: "directory", path };
  }

  if (await isDirectoryPath(path)) {
    return { kind: "directory", path };
  }

  return { kind: "file", path };
}

export async function isDirectoryPath(path) {
  if (!path) return false;
  if (dirCache.has(path)) return dirCache.get(path);

  try {
    const api = await import("../../../wailsjs/go/main/App.js");
    if (typeof api.IsDirectory === "function") {
      const isDir = await api.IsDirectory(path);
      dirCache.set(path, !!isDir);
      return !!isDir;
    }
  } catch (err) {
    console.warn("[preview-selection] directory check skipped:", err);
  }

  return false;
}
