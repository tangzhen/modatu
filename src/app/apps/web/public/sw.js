/**
 * Modatu Service Worker（任务"资源加载与性能"）：
 * - 静态资源（vite 哈希文件名 /assets/*）：cache-first（不可变内容，命中即离线可用）；
 * - /api/catalog 快照：stale-while-revalidate（首屏直出缓存，后台刷新）；
 * - 页面导航（SPA shell）：network-first，离线回退缓存；
 * - 其余同源 GET：network-first + 缓存兜底；非 GET / 跨域直接放行。
 *
 * 首次访问预缓存由运行时逐步填充（首屏请求即入缓存），无构建期清单依赖。
 */
const VERSION = 'modatu-sw-v1';
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE = `${VERSION}-api`;
const SHELL_CACHE = `${VERSION}-shell`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit ?? refresh;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // OSS/第三方直链不拦

  if (url.pathname.startsWith('/assets/')) {
    // vite 构建产物带内容哈希，不可变 → cache-first
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (url.pathname === '/api/catalog') {
    // 知识库快照：首屏直出缓存，后台静默刷新
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    // SPA shell：网络优先，离线回退缓存
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => caches.match('/')));
    return;
  }
  event.respondWith(networkFirst(request, STATIC_CACHE));
});
