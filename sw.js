// VocabForge PWA — Service Worker
// SDD §6.2 FE-03: 僅快取同源資源
// D10 FS SS-PWA-010: Cache First (HTML/JS/CSS/cards), Network First (index)

const CACHE_VERSION = 'vocabforge-v4';
const CORE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './leitner.js',
    './dashboard.js',
    './main.js',
    './style.css',
    './manifest.json'
];

// ========== Install: Pre-cache core assets ==========

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ========== Activate: Clean old caches ==========

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key !== CACHE_VERSION)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// ========== Fetch: Strategy routing ==========

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // FE-03: Only cache same-origin resources
    if (url.origin !== self.location.origin) {
        return;
    }

    // Network First for vocab-index.md (prioritise freshness)
    if (url.pathname.endsWith('/vocab-index.md')) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Cache First for everything else (HTML/JS/CSS/cards/images)
    event.respondWith(cacheFirst(event.request));
});

// ========== Strategies ==========

/**
 * Network First, Cache Fallback.
 * Try network; on success update cache and return.
 * On failure fall back to cache.
 */
function networkFirst(request) {
    return fetch(request)
        .then((response) => {
            if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_VERSION)
                    .then((cache) => cache.put(request, clone));
            }
            return response;
        })
        .catch(() => caches.match(request));
}

/**
 * Cache First, Network Fallback.
 * Return cached version if available; otherwise fetch from network,
 * cache the response, and return it.
 */
function cacheFirst(request) {
    return caches.match(request)
        .then((cached) => {
            if (cached) {
                return cached;
            }
            return fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_VERSION)
                            .then((cache) => cache.put(request, clone));
                    }
                    return response;
                });
        });
}
