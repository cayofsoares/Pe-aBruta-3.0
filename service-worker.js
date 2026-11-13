const CACHE_NAME = 'peca-bruta-pwa-v1';
const APP_SHELL = [
    '/index.html',
    '/css/style.css',
    '/manifest.json',
    '/icons/peca-bruta-192.png',
    '/icons/peca-bruta-512.png',
    '/icons/peca-bruta-180.png'
];

self.addEventListener('install', (evento) => {
    evento.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (evento) => {
    evento.waitUntil((async () => {
        const nomesCache = await caches.keys();
        await Promise.all(nomesCache
            .filter((nome) => nome.startsWith('peca-bruta-pwa-') && nome !== CACHE_NAME)
            .map((nome) => caches.delete(nome)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (evento) => {
    const requisicao = evento.request;
    const url = new URL(requisicao.url);
    if (requisicao.method !== 'GET' || url.origin !== self.location.origin) return;

    if (requisicao.mode === 'navigate') {
        evento.respondWith(fetch(requisicao).catch(async () => {
            const cache = await caches.open(CACHE_NAME);
            return (await cache.match('/index.html')) || Response.error();
        }));
        return;
    }

    if (APP_SHELL.includes(url.pathname)) {
        evento.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const respostaCache = await cache.match(requisicao);
            if (respostaCache) return respostaCache;
            const respostaRede = await fetch(requisicao);
            if (respostaRede.ok) await cache.put(requisicao, respostaRede.clone());
            return respostaRede;
        })());
    }
});
