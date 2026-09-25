'use strict';
const CACHE_PREFIX = 'aivocalmix-main-';
const CACHE_NAME = `${CACHE_PREFIX}v80-d451-reference-match-v2`;
const LEGACY_MAIN_CACHE_RE = /^aivocalmix-v80-d\d+-shell$/i;
const APP_SHELL = [
  './',
  './index.html',
  './styles/app.css?v=v80-d451-reference-match-v2',
  './styles/patches-d4-d42.css?v=v80-d451-reference-match-v2',
  './styles/patches-d46-d439.css?v=v80-d451-reference-match-v2',
  './manifest-aivocalmix-v441.webmanifest',
  './assets/premaster-mascot-d441.png',
  './favicon-32-aivocalmix-v441.png',
  './favicon-48-aivocalmix-v441.png',
  './src/navigation-guard.js?v=v80-d451-reference-match-v2',
  './src/audio/wav-codec.js?v=v80-d451-reference-match-v2',
  './src/audio/render-memory-preflight.js?v=v80-d451-reference-match-v2',
  './src/audio/upload-decode.js?v=v80-d451-reference-match-v2',
  './src/analysis/spectrum-core.js?v=v80-d451-reference-match-v2',
  './src/analysis/vocal-analysis.js?v=v80-d451-reference-match-v2',
  './src/dsp/sample-dsp.js?v=v80-d451-reference-match-v2',
  './src/audio/loudness.js?v=v80-d451-reference-match-v2',
  './src/audio/sample-peak.js?v=v80-d451-reference-match-v2',
  './src/audio/hq-resampler.js?v=v80-d451-reference-match-v2',
  './src/audio/true-peak.js?v=v80-d451-reference-match-v2',
  './src/dsp/cooperative-dsp.js?v=v80-d451-reference-match-v2',
  './src/harmony/harmony-analysis.js?v=v80-d451-reference-match-v2',
  './src/render/vocal-render.js?v=v80-d451-reference-match-v2',
  './src/render/harmony-render.js?v=v80-d451-reference-match-v2',
  './src/export/youtube-master.js?v=v80-d451-reference-match-v2',
  './src/export/premaster.js?v=v80-d451-reference-match-v2',
  './src/decision/mix-decision.js?v=v80-d451-reference-match-v2',
  './src/reference/reference-match-v2.js?v=v80-d451-reference-match-v2',
  './src/audio/context-lifecycle.js?v=v80-d451-reference-match-v2',
  './src/audio/export-memory-preflight.js?v=v80-d451-reference-match-v2',
  './src/ui/hard-reset.js?v=v80-d451-reference-match-v2',
  './src/ui/page-lifecycle.js?v=v80-d451-reference-match-v2',
  './src/ui/viewport-keyboard.js?v=v80-d451-reference-match-v2',
  './src/pwa/lifecycle.js?v=v80-d451-reference-match-v2',
  './src/pwa/mobile-resilience.js?v=v80-d451-reference-match-v2',
  './icon-180-aivocalmix-v441.png',
  './icon-192-aivocalmix-v441.png',
  './icon-512-aivocalmix-v441.png'
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
        // 本文を先に読み切る。未読のレスポンスを保持したまま待つと、HTTP/1.1
        // (同一ホスト同時接続数の上限あり)で大きいファイルが接続を塞ぎ、installが停止する。
        const body = await fresh.blob();
        return [url, new Response(body, { status: fresh.status, statusText: fresh.statusText, headers: fresh.headers })];
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
