// Bundles the extension with esbuild:
//   - the extension host (Node, CommonJS, `vscode` left external)
//   - the webview (browser, ESM, with the Typodown editor + theme inlined)
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

const host = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
};

const webview = {
  ...common,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "esm",
  target: "es2020",
  // Import the theme stylesheet as a string so it can be injected inline.
  loader: { ".css": "text" },
};

if (watch) {
  const ctxs = await Promise.all([esbuild.context(host), esbuild.context(webview)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("esbuild: watching...");
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
}
