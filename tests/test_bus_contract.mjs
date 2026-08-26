#!/usr/bin/env node
/**
 * 契约测试：event-graph.mjs（Bus 事件契约守卫）。
 *
 * 背景：bus.ts 的 BusEvents 类型表只对 .ts 调用方生效；frontend/*.html 内联脚本经
 * window.bus 绕过全部类型检查。历史实证漂移：index.html 内联 `emit("nav:change")`
 * 全项目无监听、`loading:*` 幽灵监听——旧版扫描正则被可选链 `?.` 致盲长期漏检。
 * 本测试锁定守卫行为：
 *   1. 未知事件名（.ts 与 html 内联）必须报 undeclared；
 *   2. 非 void 事件 emit 缺第二参数必须报 missing_payload；
 *   3. void 事件 emit 多传 payload 报 void_with_payload；
 *   4. VOID_EVENTS 清单与 `: void` 标记漂移必须报 voidDrift；
 *   5. 注释里的调用不误报；可选链调用不漏报；
 *   6. 真实仓库当前零硬错误。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'event-graph.mjs');

let failed = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  OK: ${msg}`);
  else { failed++; console.error(`  FAIL: ${msg}`); }
};

/** 在临时目录搭 fixture 并以 --strict --json 跑守卫 */
function runOnFixture(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'event-graph-'));
  const fe = path.join(tmp, 'frontend');
  fs.mkdirSync(path.join(fe, 'src'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(fe, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  const r = spawnSync(process.execPath, [GUARD, '--root', tmp, '--strict', '--json'], { encoding: 'utf-8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stderr 携带失败信息 */ }
  return { status: r.status, json, err: r.stderr };
}

const BUS_TS = `export interface BusEvents {
  "a:void-event": void;
  "b:typed": { x: string };
}
const VOID_EVENTS = ["a:void-event"] as const;
`;

// ── 1. fixture：各类违例与正确用法 ────────────────────────
console.log('[1] fixture 违例检测');
{
  const { status, json, err } = runOnFixture({
    'src/bus.ts': BUS_TS,
    'src/views/widget.ts': [
      `import { bus } from "../bus.ts";`,
      `bus.emit("b:typed"); // 非 void 缺 payload`,
      `window.bus?.emit("c:unknown", {}); // 可选链 + 未知事件`,
      `bus.emit("a:void-event", { extra: 1 }); // void 多传`,
      `bus.on("zzz", () => {}); // on 侧未知事件`,
      `bus.emit("b:typed", { x: "ok" });`,
      `bus.emit("a:void-event");`,
      `// bus.emit("ghost", {}); 注释不报`,
    ].join('\n'),
    'index.html': [
      `<html><body>`,
      `<script src="src/app-modules.ts"></script>`,
      `<script>window.bus?.emit("b:typed");</script>`, // html 盲区缺参（可选链）
      `<script>window.bus?.on("b:typed", () => {});</script>`, // 合法
      `</body></html>`,
    ].join('\n'),
  });
  ok(status === 1 && json !== null, `--strict 下违例阻断且输出 JSON（exit=${status}）${json ? '' : ' stderr=' + err.slice(0, 200)}`);
  const s = json?._summary ?? {};
  const arityType = (t, ev) => (s.arityIssues ?? []).some((a) => a.type === t && a.event === ev);
  ok((s.undeclared ?? []).includes('c:unknown'), '可选链 emit 未知事件名 → undeclared');
  ok((s.undeclared ?? []).includes('zzz'), 'on 侧未知事件名 → undeclared');
  ok(arityType('missing_payload', 'b:typed'), 'ts 非 void emit 缺参 → missing_payload');
  ok(arityType('void_with_payload', 'a:void-event'), 'void 事件多传 payload');
  ok((s.arityIssues ?? []).some((a) => a.type === 'missing_payload' && a.file.includes('index.html')), 'html 内联可选链缺参也被抓');
  ok(!(s.undeclared ?? []).includes('ghost') && !(s.arityIssues ?? []).some((a) => a.event === 'ghost'), '注释内调用不误报');
}

// ── 2. VOID_EVENTS 清单与 BusEvents void 标记漂移 ─────────
console.log('[2] VOID_EVENTS 漂移检测');
{
  const { status, json } = runOnFixture({
    'src/bus.ts': BUS_TS.replace('["a:void-event"]', '[]'),
    'src/views/x.ts': '',
  });
  ok(status === 1 && (json?._summary?.voidDrift ?? []).some((v) => v.event === 'a:void-event'),
    'VOID_EVENTS 漏登记 → voidDrift 且 strict 阻断');
}

// ── 3. 真实仓库零硬错误 ──────────────────────────────────
console.log('[3] 真实仓库');
{
  const r = spawnSync(process.execPath, [GUARD, '--strict', '--json'], { encoding: 'utf-8', cwd: ROOT });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* ignore */ }
  const s = json?._summary ?? {};
  const clean = r.status === 0
    && (s.undeclared ?? []).length === 0
    && (s.arityIssues ?? []).length === 0
    && (s.voidDrift ?? []).length === 0;
  ok(clean, `零硬错误（exit=${r.status}）${clean ? '' : '\n    ' + JSON.stringify({ u: s.undeclared, a: s.arityIssues, v: s.voidDrift }).slice(0, 400)}`);
}

if (failed) {
  console.error(`\nFAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log('\nOK: bus contract guard passed');
