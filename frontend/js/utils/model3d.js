import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GetModel3DSpec, GetModel3DSpecVariant } from "../../wailsjs/go/main/App.js";
import { buildSpecFromModel } from "./model3d-spec.js";

const specCache = new Map();
const SPEC_CACHE_MAX = 20;
function cacheSpec(path, data) {
  if (specCache.size >= SPEC_CACHE_MAX) {
    const firstKey = specCache.keys().next().value;
    specCache.delete(firstKey);
  }
  specCache.set(path, data);
}

async function getModel3DSpecForVariant(path, variantIndex = 0) {
  if (variantIndex > 0) {
    return GetModel3DSpecVariant(path, variantIndex);
  }
  return GetModel3DSpec(path);
}

async function buildModel3DSpecFromModel(model) {
  const fn = window?.go?.main?.App?.BuildModel3DSpecFromModel;
  if (typeof fn !== "function") return null;
  return fn(model);
}

// Development helper: inspect the generated 3D spec from the browser console.
if (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
) {
  window.debugGetSpec = async (path) => {
    try {
      const jsonStr = await GetModel3DSpec(path || "");
      const spec = JSON.parse(jsonStr);
      console.log("[DEBUG] spec:", spec);
      return spec;
    } catch (e) {
      console.error("[DEBUG]", e);
      return null;
    }
  };
}

function logSpecSummary(spec, texArr, model) {
  const slotCounts = new Map();
  let meshCount = 0;
  let vertexCount = 0;
  let missingSlots = 0;
  for (const mg of spec?.models || []) {
    for (const md of mg.meshGroups || []) {
      meshCount++;
      vertexCount += Math.floor((md.positions?.length || 0) / 3);
      const slot = md.texIdx ?? 0;
      slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
      if (texArr.length > 0 && !texArr[slot]) missingSlots++;
    }
  }
  console.info("[3D] spec summary", {
    model: model?.name || model?.identifier || model?.source || "main",
    variant: model?.activeVariant || 0,
    textures: texArr.length,
    meshes: meshCount,
    vertices: vertexCount,
    textureSlots: Object.fromEntries(slotCounts),
    missingSlots,
  });
}

export async function renderModel3D(container, model, textureUrl, texIdx = 0) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10131d);
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 80, -120);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = "";
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 80, 0);
  controls.update();
  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(10, 30, 20);
  scene.add(dirLight);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
  backLight.position.set(-10, 10, -20);
  scene.add(backLight);
  const grid = new THREE.GridHelper(400, 20, 0x4b556c, 0x273041);
  grid.position.y = -1;
  scene.add(grid);
  const axes = new THREE.AxesHelper(60);
  scene.add(axes);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(140, 96),
    new THREE.MeshBasicMaterial({
      color: 0x182033,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.02;
  scene.add(floor);
  function setBackgroundMode(mode = "studio") {
    const m = mode || "studio";
    if (m === "openysm") {
      scene.background = new THREE.Color(0x0f1218);
      grid.visible = true;
      axes.visible = false;
      floor.visible = true;
      floor.material.opacity = 0.42;
    } else if (m === "plain") {
      scene.background = new THREE.Color(0x171923);
      grid.visible = false;
      axes.visible = false;
      floor.visible = false;
    } else {
      scene.background = new THREE.Color(0x10131d);
      grid.visible = true;
      axes.visible = true;
      floor.visible = true;
      floor.material.opacity = 0.32;
    }
  }
  setBackgroundMode("openysm");
  const texMap = new Map();
  const urls = [];
  const skinOverride = model._openYsm?.textureMode === "skin";
  if (Array.isArray(model.textures)) {
    for (const url of model.textures) {
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  if (textureUrl && !urls.includes(textureUrl)) urls.unshift(textureUrl);
  if (skinOverride && urls.length > 1) {
    const selectedSkin = urls[texIdx] || textureUrl || urls[0];
    urls.splice(0, urls.length, selectedSkin);
  }
  if (urls?.length) {
    const loads = urls.filter(Boolean).map(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.flipY = false;
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.NearestFilter;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            tex.userData.imgWidth = img.naturalWidth;
            tex.userData.imgHeight = img.naturalHeight;
            texMap.set(url, tex);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    );
    await Promise.all(loads);
  }
  // Preserve URL order; image load completion order is not stable.
  const texArr = urls
    .filter(Boolean)
    .map((url) => texMap.get(url))
    .filter(Boolean);

  // Prefer the precomputed Go Three.js spec.
  let spec = { models: [] };
  const forceJS = false;
  if (model._preferLocalSpec && model.bones?.length) {
    try {
      const jsonStr = await buildModel3DSpecFromModel(model);
      const parsed = jsonStr ? JSON.parse(jsonStr) : null;
      if (parsed?.models) spec = parsed;
    } catch (e) {
      console.warn("[3D] OpenYSM bundle spec failed, fallback to path spec:", e);
    }
  }

  if (!spec.models?.length && model._modelPath) {
    try {
      const variantIndex = model.activeVariant || 0;
      const specKey = `${model._modelPath}#${variantIndex}`;
      let jsonStr = specCache.get(specKey);
      if (!jsonStr) {
        jsonStr = await getModel3DSpecForVariant(model._modelPath, variantIndex);
        cacheSpec(specKey, jsonStr);
      }
      const parsed = JSON.parse(jsonStr);
      if (parsed.models) spec = parsed;
    } catch (e) {
      console.warn("[3D] Fallback to JS geometry:", e);
    }
  }

  if (!spec.models?.length && model.bones?.length) {
    spec = buildSpecFromModel(model);
  }

  logSpecSummary(spec, texArr, model);

  // Merge small meshes that share the same bone and texture slot.
  for (const mg of spec.models || []) {
    if (!mg.meshGroups?.length) continue;
    // Group by bone and texture slot.
    const grouped = new Map();
    for (const md of mg.meshGroups) {
      const key = md.boneId + ":" + (md.texIdx ?? 0) + ":" + (md.renderMode || "cutout");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(md);
    }
    const merged = [];
    for (const [, g] of grouped) {
      if (g.length === 1) {
        merged.push(g[0]);
        continue;
      }
      // Only merge identity-rotated meshes; rotated meshes stay independent.
      let positions = [],
        normals = [],
        uvs = [],
        idx = [],
        idxOff = 0;
      const standalone = [];
      for (const md of g) {
        const isIdentity =
          md.localRotation?.[3] === 1 &&
          md.localRotation?.[0] === 0 &&
          md.localRotation?.[1] === 0 &&
          md.localRotation?.[2] === 0;
        if (!isIdentity) {
          standalone.push(md);
          continue;
        }
        // 灏?localPosition 鐑樼剻鍒伴《鐐瑰潗鏍囦腑
        const dx = md.localPosition?.[0] || 0;
        const dy = md.localPosition?.[1] || 0;
        const dz = md.localPosition?.[2] || 0;
        for (let i = 0; i < (md.positions?.length || 0); i += 3) {
          positions.push((md.positions[i] || 0) + dx);
          positions.push((md.positions[i + 1] || 0) + dy);
          positions.push((md.positions[i + 2] || 0) + dz);
        }
        if (md.normals) normals.push(...md.normals);
        if (md.uvs) uvs.push(...md.uvs);
        for (let i = 0; i < (md.indices?.length || 0); i++) {
          idx.push((md.indices[i] || 0) + idxOff);
        }
        idxOff += (md.positions?.length || 0) / 3;
      }
      if (positions.length) {
        merged.push({
          id: g[0].boneId + "_merged",
          boneId: g[0].boneId,
          texIdx: g[0].texIdx,
          renderMode: g[0].renderMode,
          localPosition: [0, 0, 0],
          localRotation: [0, 0, 0, 1],
          positions,
          normals,
          uvs,
          indices: idx,
        });
      }
      merged.push(...standalone);
    }
    mg.meshGroups = merged;
  }

  const rootGroup = new THREE.Group();
  rootGroup.name = "__root__";
  // Scale from the actual generated model bounds.
  let meshMin = Infinity,
    meshMax = -Infinity;
  for (const mg of spec.models || []) {
    for (const md of mg.meshGroups || []) {
      for (let i = 0; i < (md.positions?.length || 0); i += 3) {
        const vx = Math.abs(md.positions[i]);
        const vy = Math.abs(md.positions[i + 1] || 0);
        const vz = Math.abs(md.positions[i + 2] || 0);
        const v = Math.max(vx, vy, vz);
        if (v > meshMax) meshMax = v;
        if (v < meshMin) meshMin = v;
      }
    }
  }
  const declaredScale = Number(spec.unitScale || spec.models?.[0]?.unitScale || 0);
  const modelScale =
    Number.isFinite(declaredScale) && declaredScale > 0
      ? declaredScale
      : meshMax > 32
        ? 1 / 16
        : meshMax > 4
          ? 1 / 4
          : 1;
  rootGroup.scale.set(modelScale, modelScale, modelScale);
  scene.add(rootGroup);
  const boneGroupMap = new Map();
  const bonePoseOrder = [];
  const bonePoseIndex = new Map();
  for (const mg of spec.models) {
    for (const bd of mg.bones || []) {
      const g = new THREE.Group();
      g.name = bd.name;
      g.position.set(
        bd.localPosition[0],
        bd.localPosition[1],
        bd.localPosition[2],
      );
      if (
        bd.localRotation[3] !== 1 ||
        bd.localRotation[0] !== 0 ||
        bd.localRotation[1] !== 0 ||
        bd.localRotation[2] !== 0
      ) {
        g.quaternion.set(
          bd.localRotation[0],
          bd.localRotation[1],
          bd.localRotation[2],
          bd.localRotation[3],
        );
      }
      g.userData.bindPosition = g.position.clone();
      g.userData.bindQuaternion = g.quaternion.clone();
      g.userData.bindRotation = Array.isArray(bd.rotation)
        ? [...bd.rotation]
        : [0, 0, 0];
      g.userData.bindScale = g.scale.clone();
      boneGroupMap.set(bd.id, g);
      if (!bonePoseIndex.has(bd.id)) {
        bonePoseIndex.set(bd.id, bonePoseOrder.length);
        bonePoseOrder.push({
          id: bd.id,
          name: bd.name,
          group: g,
          bindPosition: g.userData.bindPosition,
          bindRotation: g.userData.bindRotation,
          bindScale: g.userData.bindScale,
        });
      }
    }
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(bd.id);
      if (!g) continue;
      if (bd.parentId && boneGroupMap.has(bd.parentId)) {
        boneGroupMap.get(bd.parentId).add(g);
      } else {
        rootGroup.add(g);
      }
    }
    let minY = Infinity,
      maxY = -Infinity;
    for (const b of model.bones || [])
      for (const c of b.cubes || []) {
        const y = c.origin[1] + c.size[1] / 2;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    const centerY = (minY + maxY) / 2;
    const modelHeight = maxY - minY;
    // Camera distance after model scaling.
    const camDist = Math.max(modelHeight * 1.5 * modelScale, 60 * modelScale);
    camera.position.set(camDist * 0.4, centerY * modelScale, -camDist * 0.8);
    camera.lookAt(0, centerY * modelScale, 0);
    controls.target.set(0, centerY * modelScale, 0);
    controls.update();
    for (const md of mg.meshGroups || []) {
      const boneGroup = boneGroupMap.get(md.boneId);
      if (!boneGroup) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(md.positions, 3),
      );
      geo.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(md.normals, 3),
      );
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs, 2));
      geo.setIndex(md.indices);
      const meshTexIdx = skinOverride ? 0 : md.texIdx ?? texIdx ?? 0;
      const meshTex =
        texArr.length > 0 ? texArr[meshTexIdx] || texArr[texIdx] || texArr[0] : null;
      if (texArr.length > 0 && !texArr[meshTexIdx]) {
        console.warn(`[3D] 贴图槽 ${meshTexIdx} 缺失，已回退到可用贴图`);
      }
      const renderMode = md.renderMode || "cutout";
      const isTranslucent = renderMode === "translucent";
      const mat = meshTex
        ? new THREE.MeshBasicMaterial({
            map: meshTex,
            alphaTest: isTranslucent ? 0 : 0.1,
            transparent: isTranslucent,
            depthWrite: !isTranslucent,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
          });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        md.localPosition[0],
        md.localPosition[1],
        md.localPosition[2],
      );
      if (
        md.localRotation[3] !== 1 ||
        md.localRotation[0] !== 0 ||
        md.localRotation[1] !== 0 ||
        md.localRotation[2] !== 0
      ) {
        mesh.quaternion.set(
          md.localRotation[0],
          md.localRotation[1],
          md.localRotation[2],
          md.localRotation[3],
        );
      }
      boneGroup.add(mesh);
    }
  }

  function frameCameraToModel() {
    rootGroup.updateWorldMatrix(true, true);
    const box = visibleMeshBox(rootGroup);
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = Math.max(maxDim / (2 * Math.tan(fov / 2)), maxDim) * 1.35;
    const viewDir = new THREE.Vector3(0.42, 0.18, -1).normalize();

    camera.near = Math.max(0.01, dist / 1000);
    camera.far = Math.max(1000, dist * 6);
    camera.position.copy(center).addScaledVector(viewDir, dist);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();

    const floorY = box.min.y - Math.max(0.02, maxDim * 0.004);
    grid.position.y = floorY;
    floor.position.y = floorY - 0.01;
    const floorRadius = Math.max(60, maxDim * 1.15);
    floor.scale.setScalar(floorRadius / 140);
  }

  const _tmpMeshBox = new THREE.Box3();
  function isObjectVisibleInTree(object) {
    for (let node = object; node; node = node.parent) {
      if (node.visible === false) return false;
    }
    return true;
  }

  function visibleMeshBox(root) {
    const box = new THREE.Box3();
    box.makeEmpty();
    root.traverse((child) => {
      if (!child.isMesh || !isObjectVisibleInTree(child)) return;
      const geometry = child.geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox) return;
      child.updateWorldMatrix(true, false);
      _tmpMeshBox.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld);
      if (!_tmpMeshBox.isEmpty()) box.union(_tmpMeshBox);
    });
    return box;
  }

  frameCameraToModel();

  const POSE_STRIDE = 12;
  const poseBuffer = new Float32Array(Math.max(0, bonePoseOrder.length) * POSE_STRIDE);

  function openYSMPoseQuaternion(rx, ry, rz) {
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rx || 0, ry || 0, rz || 0, "ZYX"),
    );
  }

  function resetPoseBuffer(buffer = poseBuffer) {
    for (let i = 0; i < bonePoseOrder.length; i++) {
      const meta = bonePoseOrder[i];
      const base = meta.bindRotation || [0, 0, 0];
      const o = i * POSE_STRIDE;
      buffer[o] = THREE.MathUtils.degToRad(base[0] || 0);
      buffer[o + 1] = THREE.MathUtils.degToRad(base[1] || 0);
      buffer[o + 2] = THREE.MathUtils.degToRad(base[2] || 0);
      buffer[o + 3] = 0;
      buffer[o + 4] = 0;
      buffer[o + 5] = 0;
      buffer[o + 6] = 1;
      buffer[o + 7] = 1;
      buffer[o + 8] = 1;
      buffer[o + 9] = 0;
      buffer[o + 10] = 0;
      buffer[o + 11] = 0;
    }
    return buffer;
  }

  function transformsToPoseBuffer(transforms, buffer = poseBuffer) {
    resetPoseBuffer(buffer);
    if (!transforms?.size) return buffer;
    for (const [name, t] of transforms.entries()) {
      const index = bonePoseIndex.get(name);
      if (index === undefined) continue;
      const o = index * POSE_STRIDE;
      const pos = t.position || [0, 0, 0];
      const rot = t.rotation || [0, 0, 0];
      const sc = t.scale || null;

      buffer[o] += THREE.MathUtils.degToRad(-(rot[0] || 0));
      buffer[o + 1] += THREE.MathUtils.degToRad(-(rot[1] || 0));
      buffer[o + 2] += THREE.MathUtils.degToRad(rot[2] || 0);
      buffer[o + 3] = pos[0] || 0;
      buffer[o + 4] = pos[1] || 0;
      buffer[o + 5] = pos[2] || 0;
      if (sc) {
        buffer[o + 6] = sc[0] ?? 1;
        buffer[o + 7] = sc[1] ?? 1;
        buffer[o + 8] = sc[2] ?? 1;
      }
    }
    return buffer;
  }

  function applyPoseBuffer(buffer = poseBuffer) {
    for (let i = 0; i < bonePoseOrder.length; i++) {
      const meta = bonePoseOrder[i];
      const g = meta.group;
      const o = i * POSE_STRIDE;
      const hidden = buffer[o + 9] === 1 || buffer[o + 10] === 1;
      const sx = (meta.bindScale.x || 1) * (buffer[o + 6] ?? 1);
      const sy = (meta.bindScale.y || 1) * (buffer[o + 7] ?? 1);
      const sz = (meta.bindScale.z || 1) * (buffer[o + 8] ?? 1);
      const scaleHidden = Math.abs(sx) < 0.00001 && Math.abs(sy) < 0.00001 && Math.abs(sz) < 0.00001;
      g.visible = !(hidden || scaleHidden);
      g.position.set(
        meta.bindPosition.x - (buffer[o + 3] || 0),
        meta.bindPosition.y + (buffer[o + 4] || 0),
        meta.bindPosition.z + (buffer[o + 5] || 0),
      );
      g.quaternion.copy(openYSMPoseQuaternion(buffer[o], buffer[o + 1], buffer[o + 2]));
      g.scale.set(sx, sy, sz);
    }
  }

  function applyBoneTransforms(transforms) {
    applyPoseBuffer(transformsToPoseBuffer(transforms));
  }
  resetPoseBuffer();
  let _rafId = null;
  const _onResize = () => {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  };
  window.addEventListener("resize", _onResize);

  const _keys = {};
  const _onKeyDown = (e) => {
    _keys[e.key.toLowerCase()] = true;
    if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  };
  const _onKeyUp = (e) => { _keys[e.key.toLowerCase()] = false; };
  document.addEventListener("keydown", _onKeyDown);
  document.addEventListener("keyup", _onKeyUp);

  let _lastTime = performance.now();
  let _camSpeed = 20;
  let _orbitMode = true;
  const _orbitTarget = controls.target.clone();
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  let _mouseDown = false;
  let _lastMouse = { x: 0, y: 0 };

  function onMouseDown(e) {
    if (!_orbitMode && e.button === 0) { _mouseDown = true; _lastMouse.x = e.clientX; _lastMouse.y = e.clientY; }
  }
  function onMouseUp() { _mouseDown = false; }
  function onMouseMove(e) {
    if (_orbitMode || !_mouseDown) return;
    const dx = e.clientX - _lastMouse.x;
    const dy = e.clientY - _lastMouse.y;
    _lastMouse.x = e.clientX;
    _lastMouse.y = e.clientY;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= dx * 0.003;
    _euler.x -= dy * 0.003;
    _euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, _euler.x));
    camera.quaternion.setFromEuler(_euler);
  }
  renderer.domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);

  controls.enableRotate = true;

  function renderLoop() {
    _rafId = requestAnimationFrame(renderLoop);
    const now = performance.now();
    const dt = Math.min((now - _lastTime) / 1000, 0.1);
    _lastTime = now;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const forward = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();

    if (_keys["w"] || _keys["arrowup"])    move.add(forward);
    if (_keys["s"] || _keys["arrowdown"])  move.sub(forward);
    if (_keys["a"] || _keys["arrowleft"])  move.sub(right);
    if (_keys["d"] || _keys["arrowright"]) move.add(right);
    if (_keys[" "]) move.y += 1;
    if (_keys["shift"]) move.y -= 1;

    if (move.length() > 0) {
      move.normalize().multiplyScalar(_camSpeed * dt);
      camera.position.add(move);
      // Keep the orbit target moving with keyboard navigation.
      if (_orbitMode) {
        _orbitTarget.add(move);
      }
    }

    if (_orbitMode) {
      controls.target.copy(_orbitTarget);
      controls.update();
      _orbitTarget.copy(controls.target);
    } else {
      controls.target.copy(camera.position).addScaledVector(camDir, 10);
      controls.update();
    }

    renderer.render(scene, camera);
  }
  _rafId = requestAnimationFrame(renderLoop);
  renderer.render(scene, camera);
  return {
    setSpeed: (v) => { _camSpeed = v; },
    setRotationMode: (orbit) => {
      _orbitMode = orbit;
      if (orbit) {
        controls.enableRotate = true;
        // Restore the previous orbit target when possible.
        if (_orbitTarget) {
          controls.target.copy(_orbitTarget);
        }
        _mouseDown = false;
      } else {
        // Keep the current camera orientation for free-look mode.
        _euler.setFromQuaternion(camera.quaternion);
        // Disable OrbitControls rotation while keeping pan and zoom available.
        controls.enableRotate = false;
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        controls.target.copy(camera.position).addScaledVector(camDir, 10);
        controls.update();
        _mouseDown = false;
      }
    },
    resetView: () => {
      frameCameraToModel();
      _orbitTarget.copy(controls.target);
    },
    setBackgroundMode,
    setPoseBuffer: (buffer) => applyPoseBuffer(buffer),
    getPoseBuffer: () => poseBuffer,
    setBoneTransforms: applyBoneTransforms,
    cleanup: () => {
      if (_rafId != null) cancelAnimationFrame(_rafId);
      _rafId = null;
      document.removeEventListener("keydown", _onKeyDown);
      document.removeEventListener("keyup", _onKeyUp);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      controls.dispose();
      window.removeEventListener("resize", _onResize);
      renderer.dispose();
      container.innerHTML = "";
      scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material))
            child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
      texMap.forEach((tex) => tex.dispose());
      texMap.clear();
    },
  };
}
