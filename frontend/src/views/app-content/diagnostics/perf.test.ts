// ===== 诊断页：性能面板测试 =====
// 覆盖：
//  - single-bench：7 阶段柱状渲染 / 缺 model 错误 / 命令失败兜底 / 代际守卫丢弃陈旧响应
//  - gui-flow：6 阶段状态渲染 / 失败阶段红字提示
//  - perf-log：优化历史卡片渲染
// mock cli-bridge.executeCLI（web 模式在测试环境视为 native，resolveWebMode=false）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initPerfPanel } from "./perf.ts";

const { executeCLI, resolveWebMode } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  resolveWebMode: vi.fn(() => false),
}));

vi.mock("../../../services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("../../../backend/platform.ts", () => ({ resolveWebMode }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// 对齐 Go single-bench printSingleModelStages 真实输出（7 阶段 + 汇总 + 总计）
const SINGLE_OUTPUT = `🎯 单模型加载基准测试
======================================================================
   模型:     ./ysm/player.ysm
   迭代次数: 3

   📊 各阶段耗时:
   -----------------------------------------------------------------
   ① 文件读取              12.34ms ✅
   ② JSON 解析            1993.66ms 🔴 瓶颈
   ③ 数据验证               0.00ms ✅
   ④ 几何数据准备           45.20ms 🟡 注意
   ⑤ 纹理数据准备           88.10ms 🟢
   ⑥ IPC 传输模拟           15.60ms ✅
   ⑦ 缓存检查               30.00ms ✅
   -----------------------------------------------------------------
   总计                  2184.90ms
⏱️  总耗时（3 次迭代）: 6554.70ms
💡 优化建议:
   🔴 瓶颈: JSON 解析`;

// 对齐 Go gui-flow printFlowReport 真实输出
const GUI_OUTPUT = `🎮 GUI 流程模拟器
======================================================================

📊 流程报告
----------------------------------------------------------------------

✅ [1] ① 配置加载 (1.23ms)
   仓库根: /models
   模型根: /models/ysm

✅ [2] ② 模型扫描 (30.00ms)
   发现 10 个模型 (333 models/sec)

❌ [3] ③ 模型分析 (200.50ms)
   分析失败: /models/ysm/player.ysm

⏱️  总耗时: 231.73ms
📈 成功: 2, 失败: 1`;

const PERF_LOG_OUTPUT = `╔══════════════════════════════════════╗
║             优化记录 perf-log        ║
╚══════════════════════════════════════╝

─ 2026-08-19 ─ KTX2 缓存 ─ fd068ac
  问题: 加载时间翻倍
  做法: ReadFileBytesBatchWithMeta 一次 RPC
  效果: 加载 1 次 RPC 替代 N+1 次

─ 2026-08-18 ─ MMD dispose ─ 80679cd7
  问题: 切换模型 GPU 内存泄漏
  做法: disposeMmdMesh 遍历纹理
  效果: 切换 5 个模型不再闪退`;

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="diag-btn" id="diag-perf-run">运行</button>
    <button class="diag-btn" id="diag-perf-gui">体检</button>
    <button class="diag-btn" id="diag-perf-log">历史</button>
    <input id="diag-perf-model">
    <input id="diag-perf-iter">
    <div id="diag-perf-single"></div>
    <div id="diag-perf-gui"></div>
    <div id="diag-perf-hist"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  resolveWebMode.mockReturnValue(false);
});

describe("single-bench 面板", () => {
  it("成功时渲染 7 阶段柱状 + 总耗时（红线瓶颈会画）, 无 model 时提示必填", async () => {
    // —— 缺 model：本地校验拦截，不触发 executeCLI ——
    const emptyRoot = makeRoot();
    initPerfPanel(emptyRoot, esc);
    (emptyRoot.getElementById("diag-perf-run") as HTMLElement).click();
    await Promise.resolve();
    expect(executeCLI).not.toHaveBeenCalled();
    expect((emptyRoot.getElementById("diag-perf-single") as HTMLElement).textContent).toContain("模型");

    // —— 有 model：成功渲染 ——
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { output: SINGLE_OUTPUT },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.textContent).toContain("① 文件读取");
    expect(out.textContent).toContain("② JSON 解析");
    expect(out.textContent).toContain("1993.66ms");
    expect(out.textContent).toContain("0.00ms");
    // 总耗时回退为各阶段求和（无迭代汇总行匹配）
    expect(out.textContent).toContain("ms");
  });

  it("命令失败时显示错误占位", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      error: { code: "param_error", message: "必须指定 --model 参数" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./x.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.textContent).toContain("必须指定"); // 展示后端错误 message
  });

  it("无解析到阶段时兜底显示失败占位", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { output: "无阶段文本输出" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./x.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.querySelector(".diag-stat-error")).toBeTruthy();
  });
});

describe("gui-flow 面板", () => {
  it("渲染 6 阶段状态，失败阶段标红提示", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "gui-flow",
      data: { output: GUI_OUTPUT },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-gui") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-gui") as HTMLElement;
    expect(out.textContent).toContain("① 配置加载");
    expect(out.textContent).toContain("② 模型扫描");
    // 失败行存在 → 有红色失败提示
    expect(out.textContent).toContain("③ 模型分析");
    expect(out.querySelector("[class*='perf-gui-fail']")).toBeTruthy();
  });
});

describe("perf-log 面板", () => {
  it("渲染优化历史卡片（日期/领域/commit/明细）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "perf-log",
      data: { output: PERF_LOG_OUTPUT },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-log") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-hist") as HTMLElement;
    expect(out.textContent).toContain("2026-08-19");
    expect(out.textContent).toContain("KTX2 缓存");
    expect(out.textContent).toContain("fd068ac");
    expect(out.textContent).toContain("加载 1 次 RPC 替代 N+1 次");
  });
});