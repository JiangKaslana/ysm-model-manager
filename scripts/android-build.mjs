#!/usr/bin/env node
/**
 * 一键构建 Android 调试/生产 APK（Windows/macOS/Linux 宿主通用）。
 * 补齐 android-install.mjs 的缺口：它只跑 gradle installDebug（打包 jniLibs 里
 * 已有的旧 libwails.so），本脚本先做前端构建 + NDK 交叉编译 libwails.so + gradle
 * assembleDebug，产出全新 APK。
 * 依赖：Android SDK（ANDROID_HOME/ANDROID_SDK_ROOT，含 NDK）+ Go（cgo 交叉编译）
 *       + JDK 17+（gradle wrapper 自带下载）。
 * 子进程统一走 _lib/proc.mjs run()（数组参数，无 shell 拼接，ADR-043）。
 * 用法：
 *   node scripts/android-build.mjs                  # 前端 + arm64 Go + gradle，debug 版
 *   node scripts/android-build.mjs --arch amd64     # 只编 x86_64（模拟器）
 *   node scripts/android-build.mjs --arch all        # arm64 + amd64（fat APK）
 *   node scripts/android-build.mjs --production      # 生产版（-tags production,android）
 *   node scripts/android-build.mjs --skip-frontend   # 跳过前端构建（仅重编 Go + gradle）
 *   node scripts/android-build.mjs --help
 * 退出码：0 成功；1 环境缺失/构建失败（错误信息直通）。
 * 设计意图：一键构建 Android APK，补齐 android-install.mjs 的缺口（只做 installDebug，不重编 libwails.so）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.mjs';
import { run } from './_lib/proc.mjs';

const ROOT = getRoot();
const ANDROID_DIR = path.join(ROOT, 'build', 'android');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const JNI_BASE = path.join(ANDROID_DIR, 'app', 'src', 'main', 'jniLibs');
const MIN_SDK = '21'; // app/build.gradle minSdk
const OVERLAY = path.join(ROOT, 'build', 'android', 'overlay.json');

/** ABI → GOARCH / NDK target / jniLibs 子目录 */
const ARCHES = {
  arm64: { goarch: 'arm64', ndkTarget: `aarch64-linux-android${MIN_SDK}`, abi: 'arm64-v8a' },
  amd64: { goarch: 'amd64', ndkTarget: `x86_64-linux-android${MIN_SDK}`, abi: 'x86_64' },
};

/** 宿主 → NDK llvm prebuilt 目录名 */
function hostTag() {
  const p = os.platform();
  if (p === 'win32') return 'windows-x86_64';
  if (p === 'darwin') return os.arch() === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64';
  return 'linux-x86_64';
}

/** 定位 NDK 根：$ANDROID_NDK_HOME，或 $SDK/ndk/<最新版本> */
function findNdk() {
  const ndkHome = process.env.ANDROID_NDK_HOME;
  if (ndkHome && fs.existsSync(ndkHome)) return ndkHome;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const ndkDir = path.join(sdk, 'ndk');
    if (fs.existsSync(ndkDir)) {
      const versions = fs
        .readdirSync(ndkDir)
        .filter((d) => fs.statSync(path.join(ndkDir, d)).isDirectory())
        .sort();
      if (versions.length > 0) return path.join(ndkDir, versions[versions.length - 1]);
    }
  }
  return null;
}

function fail(msg) {
  console.error(`[android-build] ${msg}`);
  process.exit(1);
}

// ---- 参数解析 ----
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log(`用法:
  node scripts/android-build.mjs                 前端 + arm64 Go + gradle，debug 版
  node scripts/android-build.mjs --arch amd64    只编 x86_64（模拟器）
  node scripts/android-build.mjs --arch all       arm64 + amd64（fat APK）
  node scripts/android-build.mjs --production     生产版（-tags production,android）
  node scripts/android-build.mjs --skip-frontend  跳过前端构建
前置：ANDROID_HOME（含 NDK）+ Go 1.25+（cgo）+ JDK 17+。
产物：build/android/app/build/outputs/apk/debug/app-debug.apk（或 release/）`);
  process.exit(0);
}
const archIdx = argv.indexOf("--arch");
const archArg =
  argv.find((a) => a.startsWith("--arch="))?.split("=")[1] ??
  (archIdx >= 0 ? argv[archIdx + 1] : undefined) ??
  "arm64";
const production = argv.includes('--production');
const skipFrontend = argv.includes('--skip-frontend');
if (!(archArg in ARCHES) && archArg !== 'all') fail(`未知架构: ${archArg}（可选 arm64/amd64/all）`);
const arches = archArg === 'all' ? Object.keys(ARCHES) : [archArg];

// ---- 前置检查 ----
if (!fs.existsSync(OVERLAY)) {
  fail(`缺少 overlay.json（Android main 注册）——先执行 wails3 android overlay:gen 或 Taskfile generate:android:overlay`);
}
const ndk = findNdk();
if (!ndk) fail(`未找到 NDK：设 ANDROID_NDK_HOME，或 ANDROID_HOME/ndk 下存在 NDK（当前: ${process.env.ANDROID_HOME || '未设置'}）`);
console.log(`[android-build] NDK: ${ndk}`);

// ---- 1. 前端构建（APK assets 需要最新 dist）----
if (!skipFrontend) {
  console.log('[android-build] 前端构建（vite build）…');
  // npm 无扩展名 shim：Windows 需 shell（proc.mjs 注释）
  const fe = run('npm', ['run', 'build'], { cwd: FRONTEND_DIR, timeout: 0, shell: os.platform() === 'win32' });
  if (!fe.ok) fail(`前端构建失败：\n${fe.out.slice(-800)}`);
}

// ---- 2. Go 交叉编译 libwails.so（per ABI）----
const toolchain = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag());
if (!fs.existsSync(toolchain)) fail(`NDK 工具链缺失: ${toolchain}`);
const buildFlags = production
  ? ['-tags', 'production,android', '-trimpath', '-buildvcs=false', '-ldflags=-w -s']
  : ['-tags', 'android,debug', '-buildvcs=false', '-gcflags=all=-l'];
for (const arch of arches) {
  const a = ARCHES[arch];
  const cc = path.join(toolchain, 'bin', a.ndkTarget + '-clang'); // NDK 26 Windows 为无后缀 PE，可直接 exec
  if (!fs.existsSync(cc)) fail(`缺少编译器: ${cc}`);
  const out = path.join(JNI_BASE, a.abi, 'libwails.so');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`[android-build] Go 交叉编译 ${arch}（${a.abi}）…`);
  const r = run('go', ['build', '-buildmode=c-shared', `-overlay=${OVERLAY}`, ...buildFlags, '-o', out, '.'], {
    cwd: ROOT,
    timeout: 0,
    env: {
      CC: cc,
      CGO_ENABLED: '1',
      GOOS: 'android',
      GOARCH: a.goarch,
    },
  });
  if (!r.ok) fail(`Go 交叉编译 ${arch} 失败：\n${r.out.slice(-1000)}`);
  console.log(`[android-build] ✅ ${out}（${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB）`);
}

// ---- 3. gradle assembleDebug/release ----
const task = production ? 'assembleRelease' : 'assembleDebug';
console.log(`[android-build] gradle ${task}…（首次可能下载 gradle 发行版，较慢）`);
const gradlew = os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew';
const gradlewPath = path.join(ANDROID_DIR, gradlew);
if (!fs.existsSync(gradlewPath)) fail(`缺少 ${gradlew}（Android 工程未初始化？）`);
if (os.platform() !== 'win32') {
  try {
    fs.chmodSync(gradlewPath, 0o755);
  } catch { /* 忽略 */ }
}
const g = run(gradlew, [`:app:${task}`], {
  cwd: ANDROID_DIR,
  timeout: 0,
  shell: os.platform() === 'win32', // gradlew.bat 非原生 exe，Windows 必须 shell
});
if (!g.ok) fail(`gradle ${task} 失败：\n${g.out.slice(-1200)}`);

const apkDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', production ? 'release' : 'debug');
const apk = path.join(apkDir, `app-${production ? 'release' : 'debug'}.apk`);
console.log(`[android-build] ✅ 完成：${apk}（${fs.existsSync(apk) ? (fs.statSync(apk).size / 1024 / 1024).toFixed(1) : '?'} MB）`);
console.log('[android-build] 装到设备：node scripts/android-install.mjs');
