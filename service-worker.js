// @ts-nocheck
const CACHE_NAME = 'finance-app-v36'; // Updated for Name Normalization

// All assets needed for the app shell to function offline.
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/index.css',
    '/icon.svg',
    '/index.tsx',
    '/firebase-config.js'
];

// 1. Install Service Worker & Pre-cache all critical assets
self.addEventListener('install', evt => {
    console.log('[Service Worker] Install event');
    evt.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Pre-caching all critical assets.');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('[Service Worker] All critical assets cached successfully.');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[Service Worker] Failed to cache critical assets:', error);
            })
    );
});

// 2. Activate Service Worker & Clean up old caches
self.addEventListener('activate', evt => {
    console.log('[Service Worker] Activate event');
    evt.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys
                .filter(key => key !== CACHE_NAME)
                .map(key => {
                    console.log(`[Service Worker] Deleting old cache: ${key}`);
                    return caches.delete(key);
                })
            );
        }).then(() => self.clients.claim()) // Ensure the new SW takes control immediately
    );
});

// 3. Fetch Event: Use "Network falling back to cache" strategy
self.addEventListener('fetch', evt => {
    // We only handle GET requests
    if (evt.request.method !== 'GET') {
        return;
    }
    
    // Don't cache API requests to GitHub or Google APIs (Firebase)
    if (evt.request.url.includes('api.github.com') || evt.request.url.includes('googleapis.com')) {
        return;
    }

    evt.respondWith(
        fetch(evt.request)
            .then(networkResponse => {
                // If the network request is successful, clone it, cache it, and return it.
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(evt.request, responseToCache);
                });
                return networkResponse;
            })
            .catch(() => {
                // If the network request fails, try to serve the response from the cache.
                return caches.match(evt.request).then(cachedResponse => {
                    // If it's a navigation request and the file is not in cache, return the main index page as a fallback.
                    if (!cachedResponse && evt.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                    return cachedResponse;
                });
            })
    );
});


// 4. Sync Event: This remains for future backend integration.
self.addEventListener('sync', evt => {
    if (evt.tag === 'sync-data') {
        console.log('[Service Worker] Background sync event triggered for sync-data.');
        // The logic to sync with a real backend would go here.
        // For example: syncDataWithServer();
    }
});