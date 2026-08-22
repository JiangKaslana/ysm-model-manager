#!/usr/bin/env node
/**
 * check-adr-status.mjs — ADR 状态分类精简统计（从 MikuMikuAR 搬运，ADR-114 §被补充）。
 *
 * 设计意图：比 check-adr-health 更精简——只输出 6 桶计数（推进中/规划中/已落地/已归档/其他）+
 * 问题清单（未标注/未知），不输出逐条明细。供 CI 快速判定。
 *
 * 零依赖（仅 node:fs / node:path）。
 *
 * 用法：
 *   node scripts/check-adr-status.mjs                 # 默认：打印统计
 *   node scripts/check-adr-status.mjs --check         # 仅「unknown」时 exit 1（未标注/非法状态）
 *   node scripts/check-adr-status.mjs --json          # JSON 输出（CI/子代理消费）
 *
 * 退出码：0 = 全部正常；1 = 存在未标注/非法状态的 ADR（--check 模式）
 * 设计意图：ADR 状态统计
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import { parseAdrHeader } from './_lib/frontmatter.mjs';
import { classifyStatus } from './_lib/adr-status-categories.mjs';

const ADR_DIR = path.join(ROOT, 'docs/adr');
const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const FLAG_CHECK = ARGS.has('--check');

function main() {
  if (!fs.existsSync(ADR_DIR)) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ error: 'docs/adr/ 目录不存在' }, null, 2));
    } else {
      console.error('❌ docs/adr/ 目录不存在');
    }
    process.exit(1);
    return;
  }

  const files = fs.readdirSync(ADR_DIR)
    .filter((f) => /^ADR-\d{3}-.*\.md$/.test(f))
    .sort();

  const buckets = { accepted: 0, partial: 0, deprecated: 0, replaced: 0, unfixed: 0, unknown: 0 };
  const problems = []; // { file, num, title, status, key }

  for (const file of files) {
    const hdr = parseAdrHeader(path.join(ADR_DIR, file));
    if (hdr.error) {
      problems.push({ file, num: null, title: file, status: '(解析失败)', key: 'unknown', detail: hdr.error });
      buckets.unknown++;
      continue;
    }
    const { num, title, status } = hdr;
    const key = classifyStatus(status);
    buckets[key] = (buckets[key] || 0) + 1;
    if (key === 'unknown') {
      problems.push({ file, num, title, status, key });
    }
  }

  const total = files.length;

  // 输出
  const bucketOrder = ['accepted', 'partial', 'replaced', 'deprecated', 'unfixed', 'unknown'];
  const bucketLabel = {
    accepted: '✅ 已采纳',
    partial: '🔄 部分采纳',
    replaced: '❌ 已取代',
    deprecated: '🧊 已废弃',
    unfixed: '⚠️ 遗留未修复',
    unknown: '❓ 未归类',
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ total, buckets, problems }, null, 2));
    process.exit((FLAG_CHECK && buckets.unknown > 0) ? 1 : 0);
    return;
  }

  console.log(`📄 ADR 状态统计 — 共 ${total} 篇\n`);
  for (const b of bucketOrder) {
    if (buckets[b] > 0) {
      console.log(`  ${bucketLabel[b]}: ${buckets[b]}`);
    }
  }

  if (problems.length > 0) {
    console.log(`\n❓ 未归类/需关注的 ADR（${problems.length}）:`);
    for (const p of problems) {
      const num = p.num != null ? `ADR-${String(p.num).padStart(3, '0')}` : p.file;
      console.log(`  ${num}  ${p.title}`);
      if (p.status) console.log(`    状态行: ${p.status.slice(0, 80)}`);
    }
  } else {
    console.log('\n✅ 所有 ADR 状态已归类。');
  }

  if (FLAG_CHECK && buckets.unknown > 0) {
    console.error(`\n⚠️ 存在 ${buckets.unknown} 篇 ADR 未归类，请补标首部状态行。`);
    process.exit(1);
  }
}

main();