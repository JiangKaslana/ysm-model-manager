#!/usr/bin/env node
/**
 * 契约测试：Rust bridge 跨平台 build tag 与 Entries 类型一致性。
 *
 * 背景（2026-08-25 修复）：bridge_darwin.go 曾误写 linux tag 导致 Linux 构建
 * redeclared / macOS 无实现；darwin/linux 的 Entries 兜底曾用 []interface{}{}
 * 与 types.ScanResponse.Entries（[]types.ModelEntry）不匹配，非 Windows 平台必编译错。
 * 本地 go build 只验 Windows 平台文件，此类漂移靠本测试拦截。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_DIR = path.join(ROOT, 'go', 'rustbridge');
const SCANNER_DIR = path.join(ROOT, 'go', 'scanner');

const PLATFORM_FILES = {
  windows: ['go/rustbridge/bridge_windows.go', 'go/scanner/rust_backend_windows.go'],
  linux: ['go/rustbridge/bridge_linux.go', 'go/scanner/rust_backend_linux.go'],
  darwin: ['go/rustbridge/bridge_darwin.go', 'go/scanner/rust_backend_darwin.go'],
  android: ['go/rustbridge/bridge_android.go', 'go/scanner/rust_backend_android.go'],
};

const errors = [];
const seenTags = new Map();

function firstLine(fp) {
  return fs.readFileSync(path.join(ROOT, fp), 'utf-8').split('\n')[0].trim();
}

for (const [os, files] of Object.entries(PLATFORM_FILES)) {
  for (const rel of files) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) {
      errors.push(`MISSING: ${rel}`);
      continue;
    }
    const tag = firstLine(rel);
    if (tag !== `//go:build ${os} && rust_backend`) {
      errors.push(`${rel}: 首行 tag 应为 "//go:build ${os} && rust_backend"，实际 "${tag}"`);
    }
    // redeclared 只在同包内发生：按所在目录（包）判重
    const pkg = path.dirname(rel);
    if (seenTags.has(pkg + '\u0000' + tag)) {
      errors.push(`${rel}: tag "${tag}" 与 ${seenTags.get(pkg + '\u0000' + tag)} 重复 → 同包构建时 redeclared`);
    }
    seenTags.set(pkg + '\u0000' + tag, rel);
  }
}

// stub 必须兜底所有未启用 rust_backend 的情况
const stubRel = 'go/scanner/rust_backend_stub.go';
if (fs.existsSync(path.join(ROOT, stubRel))) {
  const tag = firstLine(stubRel);
  if (tag !== '//go:build !rust_backend') {
    errors.push(`${stubRel}: 首行 tag 应为 "//go:build !rust_backend"，实际 "${tag}"`);
  }
} else {
  errors.push(`MISSING: ${stubRel}`);
}

// Entries 兜底类型必须与 types.ScanResponse.Entries 一致
for (const rel of Object.values(PLATFORM_FILES).flat()) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) continue;
  const text = fs.readFileSync(fp, 'utf-8');
  if (/Entries\s*=\s*\[\]interface\{\}/.test(text)) {
    errors.push(`${rel}: Entries 兜底禁止 []interface{}{}（types.ScanResponse.Entries 是 []types.ModelEntry）`);
  }
}

if (errors.length) {
  console.error(`FAILED: ${errors.length} issue(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('OK: rust bridge build tags + Entries type parity checks passed');
