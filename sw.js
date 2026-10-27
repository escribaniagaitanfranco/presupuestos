// Service worker: guarda la app para que abra rápido y funcione sin conexión.
const CACHE = 'presupuestos-v1.1.1';
const ARCHIVOS = [
  './', 'index.html', 'app.css', 'app.js', 'pdf.js', 'reglas.js', 'config.js',
  'vendor/jspdf.umd.min.js', 'manifest.webmanifest',
  'img/pdf-encabezado.png', 'img/pdf-titulo.png',
  'img/icono-192.png', 'img/icono-512.png', 'img/icono-maskable-512.png', 'img/apple-touch-icon.png', 'img/favicon-48.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Archivos propios: primero la red (para tomar actualizaciones) y si no hay conexión, la copia guardada.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
