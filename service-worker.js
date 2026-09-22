'use strict';
const CACHE_PREFIX = 'aivocalmix-iphone-test-';
const CACHE_NAME = `${CACHE_PREFIX}d419-file-picker-fix-shell`;
const LEGACY_MAIN_CACHE_RE = /^aivocalmix-iphone-test-d401-simple-v2-shell$/i;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // D408: install途中で1ファイルでも取得失敗した場合は新cacheを破棄する。
    // 部分的なApp Shellが残ると、次回オフライン起動で壊れた状態を拾う可能性があるため。
    try {
      const entries = await Promise.all(APP_SHELL.map(async (url) => {
        const fresh = await fetch(url, { cache: 'reload' });
        if (!fresh || !fresh.ok) throw new Error(`App Shell fetch failed: ${url}`);
        return [url, fresh];
      }));

      // 全件取得成功後にのみcacheへ反映して、更新を実質的にatomicにする。
      await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
    } catch (err) {
      await caches.delete(CACHE_NAME);
      throw err;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    // D406: 本体SWは本体キャッシュだけを掃除する。
    // Cache Storageはorigin単位で共有されるため、旧処理の startsWith('aivocalmix-') では
    // 同一github.io origin上のiPhone TEST版など別PWAのキャッシュまで削除し得た。
    // 旧本体形式(aivocalmix-v80-dNNN-shell)だけは移行対象として明示的に削除する。
    const staleMainCaches = keys.filter((key) =>
      key !== CACHE_NAME &&
      (key.startsWith(CACHE_PREFIX) || LEGACY_MAIN_CACHE_RE.test(key))
    );
    await Promise.all(staleMainCaches.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // D407: navigationは常にネットワークの最新HTMLを優先。
        // 失敗時だけ既存cacheへフォールバックするため、PWAのオフライン性は維持。
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && url.pathname.match(/\.(?:png|webmanifest)$/i)) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (_) {
      return Response.error();
    }
  })());
});
