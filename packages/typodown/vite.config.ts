import { defineConfig } from "vite-plus";

export default defineConfig({
  base: process.env.DEMO_BASE ?? "/typodown/",
  server: {
    port: 5183,
    strictPort: true,
  },
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
  },
  pack: [
    // ESM bundle
    {
      entry: ["src/index.ts", "src/theme.css"],
      dts: {
        tsgo: true,
      },
      exports: true,
    },
    // UMD bundle for consumers with no bundler, e.g. <script> in pure HTML
    {
      entry: ["src/index.ts"],
      format: "umd",
      globalName: "Typodown",
      platform: "browser",
      minify: true,
      deps: { alwaysBundle: [/^@codemirror\//, /^@lezer\//, /^dompurify$/, /^katex$/] },
      outputOptions: { codeSplitting: false },
      dts: false,
      clean: false,
    },
  ],
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
