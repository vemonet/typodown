// Retire the old /typodown/editor/ PWA after its move to /typodown/vault/.
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
