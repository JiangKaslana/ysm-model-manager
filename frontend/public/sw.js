// YSM 模型管理器 COI Service Worker（ADR-079 M1）
// 网页版静态托管（GitHub Pages）无法自定义响应头 → SW 拦截同源响应补 COOP/COEP，
// 浏览器据此在下次导航解锁 crossOriginIsolated=true（SharedArrayBuffer → pthread WASM 前提）。
// COEP 用 credentialless：放行无 CORP 的跨源子资源（AI relay/GitHub API/iframe），
// 满足 crossOriginIsolated 前置又不打断现有跨源调用（借鉴 MikuMikuAR ADR-099）。
// 纯 COI 版：不做资源缓存（asset 带内容哈希，浏览器 HTTP 缓存已够）。
const ENABLE_COI = true;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 只管同源
  event.respondWith(fetch(req).then(withCoiHeaders));
});

function withCoiHeaders(res) {
  if (!ENABLE_COI) return res;
  if (!res || res.status === 0 || res.type === "opaque" || res.type === "opaqueredirect") return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "credentialless");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
