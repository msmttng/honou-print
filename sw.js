// Service Worker - 奉納ビラ印刷＆名簿管理システム
// 注意: リリリース時は index.html の app.js?v= と、この CACHE_NAME のバージョンを必ず揃えること
const CACHE_NAME = 'honou-print-v73';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js?v=73',
  './hgs_gyoshotai.ttf',
  './奉納ビラ0602.pdf',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './lib/pdf-lib.min.js',
  './lib/fontkit.umd.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/all.min.css',
  './lib/webfonts/fa-solid-900.woff2',
  './lib/webfonts/fa-solid-900.ttf'
];

// オフラインでもUIフォントを保てるよう、成功レスポンスをキャッシュする外部オリジン
const CACHEABLE_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
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

// フェッチ戦略: ローカルはキャッシュ優先、外部はネットワーク優先
self.addEventListener('fetch', (event) => {
  // GET以外（GASへのPOST等）はSWで扱わない
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 外部オリジンはネットワーク優先
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((response) => {
        // フォント系CDNのみ、成功レスポンス（opaque含む）をキャッシュしてオフラインに備える
        // ※ GAS等のAPIレスポンスはキャッシュしない（?t=付きURLでキャッシュが無限増殖するため）
        if (CACHEABLE_CDN_HOSTS.includes(url.hostname) &&
            (response.ok || response.type === 'opaque')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // HTMLドキュメント（index.html等）はネットワーク優先で最新を取得（オフライン時はキャッシュ）
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // その他の静的ローカルリソースはキャッシュ優先、なければネットワーク
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // エラー応答（404等）をキャッシュに固定化しない
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
