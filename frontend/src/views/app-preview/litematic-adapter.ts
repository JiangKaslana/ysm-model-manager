// ===== Litematic 体素 3D 内容适配器（ADR-066 P3：从 litematic-3d.ts 抽离内容层）=====
// 本文件只负责体素专属逻辑：经 Go 绑定取 voxel JSON → 按空间分块建 InstancedMesh →
// 分层渲染 UI（axis/layer）+ 灯光 + GridHelper + 包围盒定相机。通用外壳
// （overlay/renderer/循环/释放/相机控制）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { getApp } from "../../backend/app.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

/** 体素数据（GetLitematicVoxelData 等返回 JSON） */
interface VoxelData {
  groups: Array<{ positions: number[][]; color?: string }>;
  size: number[];
  truncated?: boolean;
  maxBlocks?: number;
}

// 提取魔法数值常量（体素尺寸 / 默认色 / chunk 维 / 截断上限）
const CHUNK_SIZE = 32; // 空间分块维：每 chunk 持一个 InstancedMesh，32³ ≈ 32k 方块上限
const DEFAULT_VOXEL_COLOR = "#7F7F7F"; // group 缺色时兜底色
const FALLBACK_MAX_BLOCKS = 200000; // data.maxBlocks 缺席时的展示上限

/** Litematic 内容构建：把体素网格挂入核心 scene，返回 dispose + 分层控件钩子 */
export async function buildLitematicScene(
  ctx: PreviewBuildCtx,
  path: string,
  voxelFn: string,
): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🧊</div><div>' + t("preview.loadingVoxels") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';

  const App = await getApp();
  const fn = (App as unknown as Record<string, (p: string) => Promise<string>>)[voxelFn || "GetLitematicVoxelData"];
  const jsonStr = await fn(path);
  const data = JSON.parse(jsonStr) as VoxelData;

  if (!data || !data.groups || !data.groups.length) {
    ctx.loadingEl.innerHTML = `<div style="font-size:32px">⚠️</div><div>${t("preview.voxelEmpty")}</div>`;
    return { dispose() {} };
  }

  const sizeX = data.size[0] || 10;
  const sizeY = data.size[1] || 10;
  const sizeZ = data.size[2] || 10;

  const centerX = sizeX / 2,
    centerY = sizeY / 2,
    centerZ = sizeZ / 2;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 10);

  ctx.camera!.position.set(centerX + maxDim * 1.5, centerY + maxDim, centerZ + maxDim * 1.5);
  ctx.camera!.lookAt(centerX, centerY, centerZ);

  ctx.controls!.target.set(centerX, centerY, centerZ);
  ctx.controls!.minDistance = 1;
  ctx.controls!.maxDistance = maxDim * 8;
  ctx.controls!.update();

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  ctx.scene!.add(ambient);
  const dl1 = new THREE.DirectionalLight(0xffffff, 0.5);
  dl1.position.set(sizeX, sizeY * 2, sizeZ);
  ctx.scene!.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dl2.position.set(-sizeX, sizeY, -sizeZ);
  ctx.scene!.add(dl2);

  const gridSize = Math.ceil(maxDim / 10) * 10;
  const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 50), 0x6666aa, 0x444488);
  grid.position.set(centerX, 0, centerZ);
  ctx.scene!.add(grid);

  // 常值哨兵陷阱（#17）：体素原点 [0,0,0] 是合法坐标，不可用 `|| 0` 把"缺失/undefined"
  // 当作 0——那样缺字段的位置会被静默地聚到原点生成幽灵方块。此处显式校验每条 position
  // 的三维坐标为有限数，非法条目整条丢弃。0 坐标照常保留。
  const CHUNK = CHUNK_SIZE;
  const xChunks = Math.ceil(sizeX / CHUNK);
  const yChunks = Math.ceil(sizeY / CHUNK);
  const zChunks = Math.ceil(sizeZ / CHUNK);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const instancedMeshes: Array<import("three").InstancedMesh> = [];
  const materials: Array<import("three").MeshLambertMaterial> = [];
  // P2 修复（审核反推）：分层渲染需按 (group, chunk) 寻址——instancedMeshes 是拍平数组，
  // 空 group 会使索引漂移、多 chunk 组的其余 chunk 网格永远收不到分层过滤（且 mesh.count
  // 可写超 chunk 容量触发 GPU 越界读）。groupMeshes 与 data.groups 平行：空 group 占空数组
  // 保持对齐，chunk 网格携带自身 chunk key 供 applyLayer 精确过滤。
  const groupMeshes: Array<Array<{ mesh: import("three").InstancedMesh; ck: number }>> = [];
  /** 坐标变换口径（陷阱 #11）：voxel 网格坐标 = 世界坐标（boxGeo 为单位立方、pivot 在原点），
   *  无 voxel offset / cube pivot 偏移。build 与 applyLayer 共用此 helper，杜绝两处口径漂移。 */
  const isValidPos = (p: number[]): boolean =>
    Array.isArray(p) && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
  for (const group of data.groups) {
    const gMeshes: Array<{ mesh: import("three").InstancedMesh; ck: number }> = [];
    groupMeshes.push(gMeshes); // 空 group 也占位（对齐 rawGroups 索引）
    if (!group.positions || !group.positions.length) continue;
    // 按空间分块：同色方块分散到各 chunk，每个 chunk 独立 InstancedMesh
    const chunkMap = new Map<number, number[][]>();
    for (let i = 0; i < group.positions.length; i++) {
      const p = group.positions[i];
      if (!isValidPos(p)) continue; // 非法条目丢弃，不聚到原点造幻方
      const cx = Math.floor(p[0] / CHUNK);
      const cy = Math.floor(p[1] / CHUNK);
      const cz = Math.floor(p[2] / CHUNK);
      const ck = cx + cy * xChunks + cz * xChunks * yChunks;
      let arr = chunkMap.get(ck);
      if (!arr) {
        arr = [];
        chunkMap.set(ck, arr);
      }
      arr.push(p);
    }
    const mat = new THREE.MeshLambertMaterial({ color: group.color || DEFAULT_VOXEL_COLOR });
    materials.push(mat);
    const dummy = new THREE.Object3D();
    for (const [ck, chunkPositions] of chunkMap) {
      const mesh = new THREE.InstancedMesh(boxGeo, mat, chunkPositions.length);
      for (let i = 0; i < chunkPositions.length; i++) {
        const p = chunkPositions[i];
        dummy.position.set(p[0], p[1], p[2]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      ctx.scene!.add(mesh);
      instancedMeshes.push(mesh);
      gMeshes.push({ mesh, ck });
    }
  }

  ctx.loadingEl.remove(); // 体素网格构建完成，移除占位（旧 litematic-3d.ts:208 同款）

  // 分层渲染逻辑（UI 元素在 extraControls 挂入通用 topBar）
  const rawGroups = data.groups;
  let layerAxis = 1; // 默认 Y 轴: positions[p][1] = y
  let layerMax = Math.max(sizeX, sizeY, sizeZ, 1);
  let layerVal = layerMax;
  let layerVal2 = layerMax;

  // 分层控件 DOM（创建于 build，挂入由 extraControls 完成）
  const sep = document.createElement("span");
  sep.style.cssText = "width:1px;height:16px;background:rgba(255,255,255,0.15);margin:0 4px";

  const axisLabel = document.createElement("span");
  axisLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  axisLabel.textContent = t("preview.sliceAxis") + ":";
  const axisSel = document.createElement("select");
  axisSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  ["Y", "X", "Z"].forEach((a) => {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    axisSel.appendChild(o);
  });

  const layerMode = document.createElement("select");
  layerMode.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  [{ v: "all", t: "全部" }, { v: "single", t: "单层" }, { v: "range", t: "范围" }].forEach((m) => {
    const o = document.createElement("option");
    o.value = m.v;
    o.textContent = m.t;
    layerMode.appendChild(o);
  });

  const layerSlider = document.createElement("input");
  layerSlider.type = "range";
  layerSlider.min = "1";
  layerSlider.max = "100";
  layerSlider.value = "100";
  layerSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff);display:none";

  const layerInput = document.createElement("input");
  layerInput.type = "number";
  layerInput.min = "1";
  layerInput.max = "100";
  layerInput.value = "100";
  layerInput.style.cssText = "width:42px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-family:inherit;text-align:center;display:none";

  const layerSlider2 = document.createElement("input");
  layerSlider2.type = "range";
  layerSlider2.min = "1";
  layerSlider2.max = "100";
  layerSlider2.value = "100";
  layerSlider2.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff);display:none";

  const layerInput2 = document.createElement("input");
  layerInput2.type = "number";
  layerInput2.min = "1";
  layerInput2.max = "100";
  layerInput2.value = "100";
  layerInput2.style.cssText = "width:42px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-family:inherit;text-align:center;display:none";

  function setupRange(): void {
    layerMax = [sizeX, sizeY, sizeZ][layerAxis];
    layerSlider.max = String(layerMax);
    layerInput.max = String(layerMax);
    layerSlider2.max = String(layerMax);
    layerInput2.max = String(layerMax);
  }

  function updateLayerUI(): void {
    const m = layerMode.value;
    layerSlider.style.display = m === "all" ? "none" : "";
    layerInput.style.display = m === "all" ? "none" : "";
    layerSlider2.style.display = m === "range" ? "" : "none";
    layerInput2.style.display = m === "range" ? "" : "none";
    applyLayer();
  }

  axisSel.onchange = (): void => {
    layerAxis = { X: 0, Y: 1, Z: 2 }[axisSel.value] ?? 1;
    setupRange();
    layerSlider.value = String(layerMax);
    layerInput.value = String(layerMax);
    layerSlider2.value = String(layerMax);
    layerInput2.value = String(layerMax);
    layerVal = layerMax;
    layerVal2 = layerMax;
    applyLayer();
  };

  layerSlider.oninput = (): void => {
    layerInput.value = layerSlider.value;
    layerVal = Number(layerSlider.value);
    applyLayer();
  };
  layerInput.onchange = (): void => {
    // 修复：`Number(v) || layerMax` 会把合法输入 0 误判为"缺失"跳到上限——
    // 与 Math.max(1,…) 的下限意图矛盾。0 应钳到 1，仅 NaN/空输入回落 layerMax。
    const n = Number(layerInput.value);
    const v = Number.isFinite(n) ? Math.max(1, Math.min(layerMax, n)) : layerMax;
    layerInput.value = String(v);
    layerSlider.value = String(v);
    layerVal = v;
    applyLayer();
  };
  layerSlider2.oninput = (): void => {
    layerInput2.value = layerSlider2.value;
    layerVal2 = Number(layerSlider2.value);
    applyLayer();
  };
  layerInput2.onchange = (): void => {
    // 同 layerInput：0 是合法输入应钳到 1，仅 NaN/空输入回落 layerMax
    const n = Number(layerInput2.value);
    const v = Number.isFinite(n) ? Math.max(1, Math.min(layerMax, n)) : layerMax;
    layerInput2.value = String(v);
    layerSlider2.value = String(v);
    layerVal2 = v;
    applyLayer();
  };

  function applyLayer(): void {
    const dummy = new THREE.Object3D();
    const m = layerMode.value;
    const target = layerVal - 1;
    const lo = layerVal - 1;
    const hi = layerVal2 > layerVal ? layerVal2 : layerVal; // P4：lo>hi 时钳到空区而不是翻转
    for (let g = 0; g < rawGroups.length; g++) {
      const positions = rawGroups[g].positions;
      const meshes = groupMeshes[g] ?? [];
      // 每个 (group, chunk) 网格独立过滤：只写本 chunk 的位置，
      // count 不会超该 chunk 网格容量（32³），杜绝 GPU 越界读。
      for (const { mesh, ck } of meshes) {
        let count = 0;
        for (let i = 0; i < positions.length; i++) {
          const p = positions[i];
          // 坐标变换口径与 build 一致（陷阱 #11/#17）：非法条目丢弃、0 坐标保留
          if (!isValidPos(p)) continue;
          const cx = Math.floor(p[0] / CHUNK);
          const cy = Math.floor(p[1] / CHUNK);
          const cz = Math.floor(p[2] / CHUNK);
          if (cx + cy * xChunks + cz * xChunks * yChunks !== ck) continue;
          if (m === "single" && p[layerAxis] !== target) continue;
          if (m !== "all" && m !== "single" && !(p[layerAxis] >= lo && p[layerAxis] < hi)) continue;
          dummy.position.set(p[0], p[1], p[2]);
          dummy.updateMatrix();
          mesh.setMatrixAt(count, dummy.matrix);
          count++;
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  layerMode.onchange = (): void => {
    updateLayerUI();
  };

  setupRange();
  layerSlider.value = String(layerMax);
  layerInput.value = String(layerMax);
  layerSlider2.value = String(layerMax);
  layerInput2.value = String(layerMax);
  // 修复：layerVal/layerVal2 必须在 setupRange 后同步到当前轴的 layerMax——
  // 否则非立方体模型（如 size=[16,8,16] 默认 Y 轴 layerMax=8）初始 layerVal 仍是
  // 三轴最大值 16，切到单层模式 target=15 > sizeY，整屏空白而滑块却显示 8。
  layerVal = layerMax;
  layerVal2 = layerMax;

  if (data.truncated) {
    const w = document.createElement("div");
    w.style.cssText = "padding:6px 12px;background:rgba(207,83,0,0.3);color:#ffa64d;font-size:12px;text-align:center;flex-shrink:0";
    const max = data.maxBlocks || FALLBACK_MAX_BLOCKS;
    w.textContent = "⚠️ " + t("preview.blockLimit", { max: max.toLocaleString() });
    ctx.overlay.insertBefore(w, ctx.overlay.children[1]);
  }

  return {
    dispose(): void {
      instancedMeshes.forEach((m) => {
        try {
          m.dispose();
        } catch (_) {}
      });
      materials.forEach((m) => {
        try {
          m.dispose();
        } catch (_) {}
      });
      boxGeo.dispose();
      // 光源 / 网格 helper 同属 GPU 资源，清理以防上下文残留
      for (const l of [ambient, dl1, dl2]) {
        try {
          l.dispose();
        } catch (_) {}
      }
      try {
        grid.dispose();
      } catch (_) {}
    },
    extraControls(topBar: HTMLElement): void {
      topBar.appendChild(sep);
      topBar.appendChild(axisLabel);
      topBar.appendChild(axisSel);
      topBar.appendChild(layerMode);
      topBar.appendChild(layerSlider);
      topBar.appendChild(layerInput);
      topBar.appendChild(layerSlider2);
      topBar.appendChild(layerInput2);
    },
  };
}
