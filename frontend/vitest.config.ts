import { defineConfig } from "vitest/config";

// 测试环境分流约定（瓶颈治理，参照 MikuMikuAR ADR-255）：
// isolate=true 下 happy-dom 是每文件重建（~1.2s/文件），环境累加曾是墙钟大头。
// 纯逻辑测试（不触碰 window/document 等 DOM 全局）首行标注
// `// @vitest-environment node` 切 node 环境（成本 ~0ms），依赖 DOM 的保持默认 happy-dom。
// 源模块顶层 window 副作用须惰性化（typeof window !== "undefined" 守卫），
// 如 bus.ts / app-modules.ts / debug.ts——否则 import 链在 node 下报 window is not defined。
export default defineConfig({
  test: {
    include: ["src/**/*.test.{js,ts}"],
    environment: "happy-dom",
    setupFiles: ["./test-setup.ts"],
    coverage: {
      provider: "v8",
      // clean:false — 绕过 WorkBuddy safe-delete 在 Windows 上对 coverage/ 目录的
      // 路径格式拦截（genie-trash 要求 C:\ 绝对路径，收到的却是 /c/...）。
      // 报告以覆盖写方式更新，旧文件无害。CI( Linux runner ) 不受影响。
      clean: false,
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts", "src/**/*.js"],
      exclude: [
        "src/**/*.test.{js,ts}",
        "src/wasm/**",
        // WASM 桥接层（decodeYsmViaWasm）：getApp/atob/Blob/URL.createObjectURL 密集的
        // IO 胶水，单测成本高价值低；可测的纯解析逻辑已抽到 parse-ysm-json.ts。
        // 与 ADR-023 排除 wasm 层的本意一致（该文件从 src/wasm 迁出后需在此补挂）。
        "src/views/app-preview/wasm.ts",
      ],
      thresholds: {
        // 2026-08-13 校准：8-09 校准（40/31/40/40）后 src/** 单测大规模补强
        // （122 测试文件 / 1493 用例），实测升至 stmts 77.31 / branches 61.3 /
        // funcs 73.94 / lines 80.21。照旧例取实际-5pt 作防回退基准（72/56/68/75），
        // 覆盖提升后可上调。
        statements: 72,
        branches: 56,
        functions: 68,
        lines: 75,
      },
    },
  },
});