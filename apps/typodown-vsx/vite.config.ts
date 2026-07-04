import { defineConfig } from "vite-plus";

// The extension is bundled with esbuild (see build.mjs); this config only wires
// up `vp check` (format, lint, type-check) for the source.
export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
