import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { wailsBindingsResolve } from "./vite-wails-bindings-resolve.ts";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";

export default defineConfig({
  root: ".",
  // 索引 1.6：版本号构建注入（与 vite.web.config.ts 同源，__APP_VERSION__ ← WEB_VERSION
  // 环境变量；web-common.ts 的 webCommonBindings 引用，桌面构建也需定义防 ReferenceError）
  define: {
    __APP_VERSION__: JSON.stringify(process.env.WEB_VERSION || "web"),
  },
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
    watch: {
      // Windows EBUSY 防护（2026-08-16 实测）：外部工具（esbuild/IDE/杀软）原子写
      // 临时目录（.web-fs.ts.<pid>.<uuid>.tmpdir/）时，chokidar 尝试 watch 被占用
      // 的文件会抛 EBUSY 崩溃整个 vite 进程（dev 前端停摆"愣着"）——忽略这些
      // 临时产物目录，watcher 不再触碰
      ignored: [
        /[\\/]\.[^\\/]+\.\d+\.[0-9a-f-]{36}\.tmpdir([\\/]|$)/,
        /\.tmp$/,
      ],
    },
  },
  plugins: [wailsBindingsResolve, wasmDataStubs()],
});
