// A tiny "service worker": a helper script the browser keeps for this site. Some
// browsers (Chrome on Android, and iPhone apps added to the Home Screen) only show
// notifications through one. It also receives the morning "push" notifications the
// GitHub Action sends to signed-in people, even when the app is closed. No caching.
// Tapping a notification opens the app (at the place it's about) or focuses it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// A morning notification from the Action: { title, body, hash, tag }
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data?.json() ?? {}; } catch { /* not JSON: show the default */ }
  e.waitUntil(self.registration.showNotification(d.title ?? 'Snow and Surf Report', {
    body: d.body ?? 'Something matches your alerts today.',
    tag: d.tag ?? 'ssr-morning',
    icon: new URL('../icon.svg', self.location.href).href,
    data: { hash: d.hash ?? 'alerts' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // This file lives in js/, so the app is one folder up
  const home = new URL('../', self.location.href).href;
  const url = `${home}#${e.notification.data?.hash ?? 'alerts'}`;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = tabs.find((c) => c.url.startsWith(home));
    if (app) {
      await app.focus();
      return app.navigate ? app.navigate(url).catch(() => {}) : null;
    }
    return self.clients.openWindow(url);
  })());
});
