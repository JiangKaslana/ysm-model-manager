import { defineConfig, mergeConfig, type Plugin } from "vite";
import baseConfig from "./vite.config.js";

const WASM_DATA_MODULES = new Map([
  ["ysm-wasm-data.js", "export function _getWasmBinary() { return new ArrayBuffer(0); }"],
  ["ysm-wasm-data-mt.js", "export function _getWasmBinaryMt() { return new ArrayBuffer(0); }"],
]);

function e2eWasmDataStubs(): Plugin {
  return {
    name: "e2e-wasm-data-stubs",
    enforce: "pre",
    resolveId(source) {
      const name = source.split("/").at(-1);
      return name && WASM_DATA_MODULES.has(name) ? `\0e2e-wasm:${name}` : null;
    },
    load(id) {
      return id.startsWith("\0e2e-wasm:")
        ? WASM_DATA_MODULES.get(id.slice("\0e2e-wasm:".length))
        : null;
    },
  };
}

export default mergeConfig(
  baseConfig,
  defineConfig({ plugins: [e2eWasmDataStubs()] }),
);
