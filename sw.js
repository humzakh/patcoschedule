const CACHE_NAME = 'patco-schedule-v11';
const DATA_CACHE_NAME = 'patco-data-cache-v11';
const APP_SHELL = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.ico',
    '/app/static/css/style.css',
    '/app/static/js/script.js',
    '/app/static/js/worker.js',
    '/app/static/images/patcoschedule-icon.svg',
    '/app/static/images/patco.svg',
    '/app/static/images/schedule.svg',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
];


// Install Event: Cache App Shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[Service Worker] Caching Application Shell');
            return cache.addAll(APP_SHELL);
        })
    );
    self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME && key !== DATA_CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

// Fetch Event: Network-First for Data, Cache-First for App Shell
self.addEventListener('fetch', event => {
    if (event.request.url.includes('patco_data.json')) {
        // Data Strategy: Network First, falling back to cache
        // We strip the query parameters (e.g. ?t=12345) when storing and retrieving from cache.
        const cleanUrl = event.request.url.split('?')[0];

        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Check if we received a valid response
                    if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
                        return response;
                    }

                    // Clone and cache the valid response
                    const responseToCache = response.clone();
                    caches.open(DATA_CACHE_NAME).then(cache => {
                        cache.put(cleanUrl, responseToCache);
                    });
                    return response;
                })
                .catch(() => {
                    // Network failed (offline), try to serve from cache
                    console.log('[Service Worker] Network failed, falling back to cache for data');
                    return caches.match(cleanUrl).then(cachedResponse => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        // If no cache either, throw error to let the app handle it gracefully
                        throw new Error('No network access and no cached data available.');
                    });
                })
        );
    } else if (event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com')) {
        // Google Fonts Strategy: Stale-While-Revalidate
        // NEVER use ignoreSearch here, because Google differentiates fonts via query strings (?family=...)
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    // Only cache valid responses
                    if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    console.log('[Service Worker] Failed to fetch font, using cache if available');
                });

                // Return cached font immediately if present, otherwise wait for network
                return cachedResponse || fetchPromise;
            })
        );
    } else {
        // App Shell Strategy: Cache First, falling back to network
        // We use ignoreSearch: true so that requests with ?v=... still match the clean cached files
        event.respondWith(
            caches.match(event.request, { ignoreSearch: true }).then(response => {
                return response || fetch(event.request).catch((err) => {
                    // Provide a generic fallback for navigation requests if network fails
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html', { ignoreSearch: true });
                    }
                    throw err;
                });
            })
        );
    }
});
