// Retire the old /editor/ PWA after its move to /vault/.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration.unregister().then(async () => {
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(
        windows.map((client) => client.navigate(client.url.replace("/editor/", "/vault/"))),
      );
    }),
  );
});
