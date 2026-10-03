// public/sw.js
//
// Service worker mínimo y a prueba de despliegues.
//
// La versión anterior cacheaba el shell y los estáticos. Es lo habitual en una
// PWA, pero en la práctica causó que, después de un deploy, el teléfono sirviera
// un HTML viejo que apuntaba a chunks de JavaScript que ya no existían: la app
// quedaba congelada en la pantalla de carga.
//
// Ahora NO se cachea nada: cada petición va directo a la red. El service worker
// se conserva solo porque Chrome/Android lo exige para ofrecer "Instalar app".
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpia cualquier caché que haya dejado la versión anterior.
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

// La sola presencia de un listener `fetch` es requisito de instalabilidad. No
// intercepta nada: al no llamar a `respondWith`, el navegador resuelve la
// petición normalmente (sin caché del service worker).
self.addEventListener('fetch', () => {})
