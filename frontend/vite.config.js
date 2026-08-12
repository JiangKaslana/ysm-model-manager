import { defineConfig } from "vite";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { resolve } from "path";

// Wails v3 generates .ts bindings but frontend imports them as .js.
// This plugin resolves .js imports to .ts when the .ts file exists.
const wailsBindingsResolve = {
  name: "wails-bindings-resolve",
  resolveId(source, importer) {
    if (!importer) return null;
    if (!source.includes("/bindings/") || !source.endsWith(".js")) return null;
    const tsSource = source.replace(/\.js$/, ".ts");
    const dir = resolve(importer, "..");
    const tsPath = resolve(dir, tsSource);
    if (existsSync(tsPath)) {
      return this.resolve(tsSource, importer, { skipSelf: true });
    }
    return null;
  },
};

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  // utils/resource/{types,extensions}.ts 直接 import 仓库根 resource_types.json
  // （单一事实来源，构建期内联）。Vite 6 显式 allow 会完全替换默认 workspace root，
  // 必须同时放行 frontend/ 自身（new URL(".", import.meta.url)），否则 dev 首页 403；
  // 仓库根仅放行该单个 JSON 文件，不过度放开上级目录
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../resource_types.json", import.meta.url)),
      ],
    },
  },
  plugins: [wailsBindingsResolve],
});
