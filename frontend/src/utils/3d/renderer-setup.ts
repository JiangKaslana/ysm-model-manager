// ===== 3D 场景初始化（从 model3d.ts 拆出，ADR-040 P1 第5轮）=====
// 负责 renderer 配置 + 灯光 + 网格/轴辅助线 + 容器挂载。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** setupRenderer 返回的组件 */
export interface RendererComponents {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

/**
 * 初始化渲染器和场景基础元素（灯光、网格、轴）。
 * 调用方负责将 scene/camera/renderer 赋给模块级引用。
 */
export function setupRenderer(container: HTMLElement): RendererComponents {
  const aspect = container.clientWidth / container.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 80, -120);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // ADR-047：触屏拖拽旋转需禁用浏览器手势默认
  renderer.domElement.style.touchAction = "none";

  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 80, 0);
  controls.update();

  // 灯光
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b2e);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 2);
  dl.position.set(10, 30, 20);
  scene.add(dl);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
  backLight.position.set(-10, 10, -20);
  scene.add(backLight);

  // 辅助线
  const grid = new THREE.GridHelper(400, 20, 0x8888cc, 0x6666aa);
  grid.position.y = -1;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(60));

  return { scene, camera, renderer, controls };
}
