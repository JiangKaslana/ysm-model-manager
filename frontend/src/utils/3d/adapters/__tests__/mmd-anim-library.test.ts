// ===== MMD 动画库路径解析与文件过滤 单元测试 =====
// 覆盖：resolveMmdSubdirPath（路径拼接/边界）、filterAnimFiles（vmd/vpd 过滤/大小写/边界）、ANIM_LIB_SUBDIR 导出。
// @vitest-environment node

import { describe, it, expect } from "vitest";
import { resolveMmdSubdirPath, filterAnimFiles, ANIM_LIB_SUBDIR } from "../mmd-anim-library";

// ---- resolveMmdSubdirPath ----
describe("resolveMmdSubdirPath", () => {
  it("从 EntityPlayer 子目录回溯到 group 根再拼 CustomAnim", () => {
    const result = resolveMmdSubdirPath("FilesRoot/mmd/EntityPlayer", "CustomAnim");
    expect(result).toBe("FilesRoot/mmd/CustomAnim");
  });

  it("使用 Windows 反斜杠分隔符也能正确回溯", () => {
    const result = resolveMmdSubdirPath("FilesRoot\\mmd\\EntityPlayer", "CustomAnim");
    expect(result).toBe("FilesRoot/mmd/CustomAnim");
  });

  it("混合正斜杠与反斜杠的分隔符", () => {
    const result = resolveMmdSubdirPath("FilesRoot/mmd\\EntityPlayer", "CustomAnim");
    expect(result).toBe("FilesRoot/mmd/CustomAnim");
  });

  it("repoRoot 末尾有连续斜杠时先去除再回溯", () => {
    const result = resolveMmdSubdirPath("FilesRoot/mmd/EntityPlayer///", "CustomAnim");
    expect(result).toBe("FilesRoot/mmd/CustomAnim");
  });

  it("subdir 开头带斜杠时先去除再拼接", () => {
    const result = resolveMmdSubdirPath("FilesRoot/mmd/EntityPlayer", "/CustomAnim");
    expect(result).toBe("FilesRoot/mmd/CustomAnim");
  });

  it("subdir 开头带连续斜杠时全部去除", () => {
    const result = resolveMmdSubdirPath("FilesRoot/mmd/EntityPlayer", "//\\CustomAnim");
    expect(result).toBe("FilesRoot/mmd/CustomAnim");
  });

  it("repoRoot 只有两段时回溯到根后拼接", () => {
    const result = resolveMmdSubdirPath("mmd/EntityPlayer", "CustomAnim");
    expect(result).toBe("mmd/CustomAnim");
  });

  it("repoRoot 只有单层时回溯为空串再拼接 subdir", () => {
    const result = resolveMmdSubdirPath("EntityPlayer", "CustomAnim");
    expect(result).toBe("/CustomAnim");
  });
});

// ---- filterAnimFiles ----
describe("filterAnimFiles", () => {
  it("筛选出 .vmd 文件", () => {
    const files = ["dance.vmd", "model.pmx", "skin.tga", "pose.vpd"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["dance.vmd", "pose.vpd"]);
  });

  it("筛选出 .vpd 文件", () => {
    const files = ["pose.vpd", "other.txt"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["pose.vpd"]);
  });

  it("大小写不敏感：.VMD / .Vpd 都能匹配", () => {
    const files = ["DANCE.VMD", "Pose.VPD", "pose.Vpd", "model.pmx"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["DANCE.VMD", "Pose.VPD", "pose.Vpd"]);
  });

  it("空数组返回空数组", () => {
    expect(filterAnimFiles([])).toEqual([]);
  });

  it("无匹配文件时返回空数组", () => {
    const files = ["model.pmx", "texture.tga", "config.json"];
    expect(filterAnimFiles(files)).toEqual([]);
  });

  it("全为动画文件时全部返回", () => {
    const files = ["a.vmd", "b.vpd", "c.VMD"];
    expect(filterAnimFiles(files)).toEqual(files);
  });

  it("路径含子目录也能匹配", () => {
    const files = ["CustomAnim/dance.vmd", "Anim/sub/pose.VPD", "other.pmx"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["CustomAnim/dance.vmd", "Anim/sub/pose.VPD"]);
  });

  it("不带扩展名的文件不会被误匹配", () => {
    const files = ["noext", ".vmdhidden", "readme"];
    expect(filterAnimFiles(files)).toEqual([]);
  });

  it("扩展名嵌入中间不被误匹配（只检查 endWith）", () => {
    const files = ["vmd_inside.txt", "file.vmd.bak"];
    expect(filterAnimFiles(files)).toEqual([]);
  });
});

// ---- ANIM_LIB_SUBDIR ----
describe("ANIM_LIB_SUBDIR", () => {
  it("导出子目录名为 CustomAnim", () => {
    expect(ANIM_LIB_SUBDIR).toBe("CustomAnim");
  });
});
