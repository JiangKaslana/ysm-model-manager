#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/deadcode-attrib.mjs 死代码发现项归属单元测试。
 *
 * 覆盖：
 *   1. findingFiles：knip 键（file|type|name / 整文件 file|file|name）、jscpd 键（f1#f2）
 *   2. attributable：staged 集合含 frontend/ 前缀变体、仓库根直配、不匹配
 *   3. filterNew：混合列表只挑出归属项，非归属项进收编桶
 *
 * 零依赖、纯函数、无 IO。
 */
import { findingFiles, attributable, splitNewFindings } from '../scripts/_lib/deadcode-attrib.mjs';

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

// ── 1. findingFiles ─────────────────────────────────
assert(JSON.stringify(findingFiles('src/a.ts|exports|foo')) === JSON.stringify(['src/a.ts']),
  'knip 键应取首段文件: ' + JSON.stringify(findingFiles('src/a.ts|exports|foo')));
assert(JSON.stringify(findingFiles('src/a.ts|file|src/a.ts')) === JSON.stringify(['src/a.ts']),
  'knip 整文件键应取首段');
assert(JSON.stringify(findingFiles('src/a.ts#src/b.ts')) === JSON.stringify(['src/a.ts', 'src/b.ts']),
  'jscpd 键应拆出两个文件');
assert(JSON.stringify(findingFiles('weird-no-sep')) === JSON.stringify([]),
  '无分隔符键返回空数组');

// ── 2. attributable ─────────────────────────────────
const stagedFrontend = new Set(['frontend/src/utils/x.ts']);
assert(attributable('src/utils/x.ts|exports|foo', stagedFrontend),
  'knip 候选补 frontend/ 前缀后应命中 staged');
assert(attributable('src/a.ts#src/utils/x.ts', stagedFrontend),
  'jscpd 任一文件命中即归属');

const stagedRoot = new Set(['docs/foo.md', 'internal/app/app_files.go']);
assert(attributable('internal/app/app_files.go|functions|Bar', stagedRoot),
  'Go 文件根路径直配');

const stagedNone = new Set(['frontend/src/views/app-tree/index.ts']);
assert(!attributable('src/utils/3d/adapters/switch-preview.ts|exports|arrangeModelsInRow', stagedNone),
  '不在 staged 的发现项不应归属');
assert(attributable('frontend/src/views/app-tree/index.ts|exports|foo', stagedNone),
  '候选自带 frontend/ 前缀也应直配');

// ── 3. splitNewFindings ─────────────────────────────
const staged = new Set(['frontend/src/features/import-executor.ts']);
const news = [
  'src/features/import-executor.ts|exports|newFn',          // 归属（staged）
  'src/utils/3d/adapters/switch-preview.ts|exports|arrange', // 不归属（他人遗留）
];
const split = splitNewFindings(news, staged);
assert(split.blocking.length === 1 && split.blocking[0] === news[0], '仅归属项进阻断桶');
assert(split.absorbable.length === 1 && split.absorbable[0] === news[1], '非归属项进收编桶');

const strict = splitNewFindings(news, null);
assert(strict.blocking.length === 2 && strict.absorbable.length === 0,
  '责任集为 null（严格模式）时全部阻断');

if (errors.length) {
  console.error(`✖ ${errors.length} 项失败:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('✅ test_deadcode_attrib 全部通过');
