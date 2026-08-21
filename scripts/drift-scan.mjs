#!/usr/bin/env node
/**
 * drift-scan.mjs — 双轨漂移自动检测脚本
 *
 * 检测维度：
 * 1. Go 同函数名多处定义（同名函数在不同包/文件）
 * 2. Go 硬编码常量（0755/0644/50<<20 等）
 * 3. Go 内联切片操作（[:len(...)-N] 模式）
 * 4. 前端硬编码常量（与 Go 端同逻辑不同实现）
 * 5. 重复字符串模式（非法字符集等）
 *
 * 用法：node scripts/drift-scan.mjs [--json] [--fix-hint]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const GO_DIR = join(ROOT, "go");
const FE_DIR = join(ROOT, "frontend", "src");

// ===== 工具函数 =====

/** 递归收集文件 */
function walkFiles(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "testdata") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, ext, out);
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

/** 读取文件内容（忽略 _test.go / *.test.ts） */
function readSrc(path) {
  const base = path.split(/[/\\]/).pop();
  if (base.includes("_test.") || base.includes(".test.")) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** 在内容中搜索正则，返回所有匹配行 */
function findMatches(content, regex, filePath, filter) {
  const results = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(regex);
    if (m) {
      // 应用过滤器
      if (filter && !filter(lines[i].trim(), content, i)) continue;
      results.push({
        file: relative(ROOT, filePath),
        line: i + 1,
        text: lines[i].trim(),
        match: m[0],
      });
    }
  }
  return results;
}

// ===== 检测规则 =====

const RULES = [
  {
    id: "HARDCODED_PERMS_DIR",
    severity: "warn",
    desc: "硬编码目录权限 0755（应使用 fsutil.DirPerms）",
    glob: "*.go",
    regex: /os\.MkdirAll\([^,]+,\s*0755\)/,
    exclude: [/test/],
  },
  {
    id: "HARDCODED_PERMS_FILE",
    severity: "warn",
    desc: "硬编码文件权限 0644（应使用 fsutil.FilePerms）",
    glob: "*.go",
    regex: /os\.WriteFile\([^,]+,[^,]+,\s*0644\)/,
    exclude: [/test/],
    // 排除 heredoc 字符串（如 GitHub Actions workflow）
    filter: (line) => !line.startsWith("os.WriteFile(\"index.json\""),
  },
  {
    id: "HARDCODED_READ_LIMIT",
    severity: "warn",
    desc: "硬编码读取上限 50<<20（应使用 types.MaxReadLimit）",
    glob: "*.go",
    regex: /50\s*<<\s*20/,
    exclude: [/types\/extensions\.go/, /test/],
    // 排除常量定义本身和注释
    filter: (line) => !line.startsWith("//") && !line.startsWith("const "),
  },
  {
    id: "INLINE_BAN_STRIP",
    severity: "error",
    desc: "内联 .ban 后缀剥离 [:len(name)-4]（应使用 types.StripBanSuffix）",
    glob: "*.go",
    regex: /\[:len\([^)]+\)-4\]/,
    exclude: [/types\/extensions\.go/, /test/],
    // 排除注释行和函数定义本身
    filter: (line) => !line.startsWith("//") && !line.startsWith("return name[:len(name)-4]"),
  },
  {
    id: "INLINE_ILLEGAL_CHARS",
    severity: "warn",
    desc: "内联非法字符集检测（应使用 fsutil.ContainsIllegalNameChar）",
    glob: "*.go",
    regex: /strings\.ContainsAny\([^,]+,\s*`\\\/:\*\?"<>\|`\)/,
    exclude: [/fsutil\/perms\.go/, /test/],
  },
  {
    id: "DUPLICATE_FORMAT_SIZE",
    severity: "warn",
    desc: "独立 formatSize 实现（应使用 fsutil.FormatSize）",
    glob: "*.go",
    regex: /^func formatSize\(/,
    exclude: [/fsutil\/format\.go/, /test/],
    // 排除委托实现（单行函数体含 fsutil.FormatSize）
    filter: (line, content, lineIdx) => {
      const lines = content.split("\n");
      const nextLine = lines[lineIdx + 1] || "";
      // 如果函数体是单行委托调用，不算重复
      return !nextLine.includes("fsutil.FormatSize") && !line.includes("fsutil.FormatSize");
    },
  },
  {
    id: "FE_HARDCODED_FORMAT",
    severity: "warn",
    desc: "前端独立 formatSize 实现（应委托 formatBytes）",
    glob: "*.ts",
    regex: /export function formatSize\(bytes: number\): string \{/,
    exclude: [/test/],
  },
  {
    id: "INLINE_PATH_NORM",
    severity: "info",
    desc: "内联路径分隔符替换（建议统一 filepath.ToSlash）",
    glob: "*.go",
    regex: /strings\.ReplaceAll\([^,]+,\s*"\\\\"[^"]*"\/"\)/,
    exclude: [/test/],
  },
  {
    id: "COPY_DIR_REIMPL",
    severity: "info",
    desc: "copyDirRecursive 独立实现（应使用 fsutil.CopyDirRecursive）",
    glob: "*.go",
    regex: /^func copyDirRecursive\(/,
    exclude: [/fsutil\/copy\.go/, /test/],
  },
];

// ===== 主逻辑 =====

function scan() {
  const findings = [];

  for (const rule of RULES) {
    const isGo = rule.glob === "*.go";
    const dir = isGo ? GO_DIR : FE_DIR;
    const ext = isGo ? ".go" : ".ts";
    const files = walkFiles(dir, ext);

    for (const file of files) {
      const content = readSrc(file);
      if (!content) continue;

      // 检查排除规则
      if (rule.exclude?.some((re) => re.test(file))) continue;

      const matches = findMatches(content, rule.regex, file, rule.filter);
      for (const m of matches) {
        findings.push({ ...rule, ...m });
      }
    }
  }

  return findings;
}

function formatOutput(findings, json) {
  if (json) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }

  // 按严重度分组
  const bySeverity = { error: [], warn: [], info: [] };
  for (const f of findings) {
    bySeverity[f.severity]?.push(f);
  }

  console.log("🔍 双轨漂移扫描报告\n");

  if (bySeverity.error.length) {
    console.log(`❌ 严重 (${bySeverity.error.length})：`);
    for (const f of bySeverity.error) {
      console.log(`  ${f.id}: ${f.file}:${f.line}`);
      console.log(`    ${f.desc}`);
      console.log(`    > ${f.text.slice(0, 80)}`);
    }
    console.log();
  }

  if (bySeverity.warn.length) {
    console.log(`⚠️  警告 (${bySeverity.warn.length})：`);
    for (const f of bySeverity.warn) {
      console.log(`  ${f.id}: ${f.file}:${f.line}`);
      console.log(`    ${f.desc}`);
    }
    console.log();
  }

  if (bySeverity.info.length) {
    console.log(`ℹ️  提示 (${bySeverity.info.length})：`);
    for (const f of bySeverity.info) {
      console.log(`  ${f.id}: ${f.file}:${f.line}`);
    }
    console.log();
  }

  const total = findings.length;
  console.log(`\n📊 总计: ${total} 处漂移`);
  console.log(`   严重: ${bySeverity.error.length} | 警告: ${bySeverity.warn.length} | 提示: ${bySeverity.info.length}`);
}

// ===== 入口 =====

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

const findings = scan();
formatOutput(findings, jsonMode);

// 有严重问题时退出码 1
const hasError = findings.some((f) => f.severity === "error");
if (hasError && !jsonMode) {
  process.exit(1);
}
