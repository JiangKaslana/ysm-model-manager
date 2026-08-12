// ===== app-content 页面模板测试 =====
// 覆盖：repository/instances/settings/downloads/diagnostics/recycle/github/workshop HTML 生成
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  downloadsHTML,
  diagnosticsHTML,
  recycleHTML,
  githubHTML,
  workshopHTML,
} from "./tpl.ts";

const { getAndroidBridgeMock, isViewerModeMock } = vi.hoisted(() => ({
  getAndroidBridgeMock: vi.fn().mockReturnValue(null), // 默认桌面（无 Android 桥）
  isViewerModeMock: vi.fn().mockReturnValue(false), // 默认桌面（非查看器模式）
}));
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  getAndroidBridge: getAndroidBridgeMock,
  isViewerMode: isViewerModeMock,
}));

beforeEach(() => {
  getAndroidBridgeMock.mockReturnValue(null);
  isViewerModeMock.mockReturnValue(false);
});

describe("app-content 模板", () => {
  it("repositoryHTML 包含仓库结构", () => {
    const html = repositoryHTML();
    expect(html).toContain("repo-wrap");
    // 桌面模式：回收站/查重/最旧模型 tab 均显示
    expect(html).toContain('data-tab="recycle"');
    expect(html).toContain('data-tab="dedup"');
    expect(html).toContain('data-tab="oldest"');
  });

  it("repositoryHTML 查看器模式隐藏回收站/查重/最旧模型 tab（依赖本地文件系统操作）", () => {
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android/网页版）
    const html = repositoryHTML();
    expect(html).toContain("repo-wrap");
    expect(html).not.toContain('data-tab="recycle"');
    expect(html).not.toContain('data-tab="dedup"');
    expect(html).not.toContain('data-tab="oldest"');
    // 文件树/导入 tab 保留
    expect(html).toContain('data-tab="tree"');
    expect(html).toContain('data-tab="import"');
    isViewerModeMock.mockReturnValue(false);
  });

  it("instancesHTML 挂载 app-sidebar 与占位提示", () => {
    const html = instancesHTML();
    expect(html).toContain('<app-sidebar class="ins-sidebar"></app-sidebar>');
    expect(html).toContain("点击左侧整合包查看模型");
  });

  it("settingsHTML 包含设置面板骨架", () => {
    const html = settingsHTML();
    expect(html).toContain("settings");
    expect(html).toContain("set-mc-path");
    expect(html).toContain("set-link-mode");
    expect(html).toContain("set-files-root");
  });

  it("settingsHTML 查看器模式隐藏游戏根目录/链接模式/文件存储路径/下载镜像源卡片", () => {
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android/网页版）
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() } as never);
    const html = settingsHTML();
    expect(html).not.toContain("set-mc-path");
    expect(html).not.toContain("set-mc-detect");
    expect(html).not.toContain("set-link-mode");
    expect(html).not.toContain("set-relink");
    // 文件存储路径卡片（含高级设置面板）查看器模式隐藏——本地文件系统配置对网页版/Android 无意义
    expect(html).not.toContain("stg-files-card");
    expect(html).not.toContain("set-files-root");
    expect(html).not.toContain("set-advanced-toggle");
    expect(html).not.toContain("set-advanced-grid");
    // 下载镜像源卡片查看器模式隐藏——浏览器下载走 fetchWithFallback 三路回退，不依赖该配置
    expect(html).not.toContain("set-mirror");
    expect(html).not.toContain("mirror-hint-");
    // 语言/主题等纯前端偏好卡片保留
    expect(html).toContain("set-lang");
  });

  it("downloadsHTML 包含导入表单与拖拽区", () => {
    const html = downloadsHTML();
    expect(html).toContain('id="dl-import"');
    expect(html).toContain("拖拽模型文件");
    expect(html).toContain('id="dl-queue-count"');
  });

  it("diagnosticsHTML 包含诊断 Tab 与面板", () => {
    const html = diagnosticsHTML();
    expect(html).toContain('data-tab="diagnostics"');
    expect(html).toContain('id="diag-scan-conflict"');
  });

  it("recycleHTML 包含清空回收站按钮", () => {
    const html = recycleHTML();
    expect(html).toContain('id="recy-empty"');
    expect(html).toContain("清空回收站");
  });

  it("githubHTML 包含仓库网格与提示", () => {
    const html = githubHTML();
    expect(html).toContain('id="gh-grid"');
    expect(html).toContain("点击左侧仓库查看模型");
  });

  it("workshopHTML 包含站点 Tab 容器与导入导出按钮", () => {
    const html = workshopHTML();
    expect(html).toContain('id="ws-tabs"');
    expect(html).toContain('id="ws-export-btn"');
    expect(html).toContain('id="ws-import-btn"');
  });
});
