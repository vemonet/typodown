// Retire the briefly deployed root-scoped PWA. Browsers that registered it
// will update to this worker, unregister it, and reload their open pages. The
// real PWA lives under /vault/.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration.unregister().then(async () => {
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    }),
  );
});
