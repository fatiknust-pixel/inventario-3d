// Rede primeiro (sempre pega a versão nova); sem internet, usa o que já foi aberto antes.
const C = 'inv3d-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())),
)
self.addEventListener('fetch', e => {
  const r = e.request
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return
  e.respondWith(
    fetch(r)
      .then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); return res })
      .catch(() => caches.match(r).then(m => m || caches.match('./index.html') || caches.match('./'))),
  )
})
