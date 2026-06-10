// Service Worker - 奉納ビラ印刷＆名簿管理システム
const CACHE_NAME = 'honou-print-v38';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js?v=38',
  './hgs_gyoshotai.ttf',
  './奉納ビラ0602.pdf',
  './templates_config.json',
  './lib/pdf-lib.min.js',
  './lib/fontkit.umd.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/all.min.css',
  './lib/webfonts/fa-solid-900.woff2',
  './lib/webfonts/fa-solid-900.ttf'
];

// インストール時にアセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ戦略: ローカルはキャッシュ優先、CDNはネットワーク優先
self.addEventListener('fetch', (event) => {
  // CDNリソースはネットワーク優先
  if (!event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  // ローカルリソースはキャッシュ優先、なければネットワーク
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
