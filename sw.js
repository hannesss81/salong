// Retired service worker.
// Earlier versions cached the whole site cache-first, so returning visitors could keep
// seeing an old page after an update. This version clears those caches, unregisters
// itself and reloads open tabs from the network. Keep this file in place for a while
// so browsers that still have the old worker pick it up.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach(client => client.navigate(client.url));
  })());
});
