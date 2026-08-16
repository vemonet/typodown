import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

export default defineConfig({
  base: process.env.PWA_BASE ?? "/vault/",
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Typodown",
        short_name: "Typodown",
        description: "A local-first Markdown editor with file explorer and graph view.",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        scope: "/vault/",
        start_url: "/vault/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../typodown-app/src"),
    },
  },
  server: {
    port: 5184,
    strictPort: true,
  },
  build: {
    outDir: "../../packages/typodown/dist-demo/vault",
    emptyOutDir: true,
  },
});
