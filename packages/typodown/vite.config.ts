import { defineConfig } from "vite-plus";

export default defineConfig({
  base: process.env.DEMO_BASE ?? "/typodown/",
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
  },
  pack: {
    entry: ["src/index.ts", "src/theme.css"],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
