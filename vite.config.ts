import { defineConfig } from "vite-plus";
import solid from "eslint-plugin-solid/configs/typescript";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    // `test.md` is a hand-written torture fixture: unclosed fences, tilde
    // fences, tab indentation and deliberately awkward nesting. Formatting it
    // rewrites exactly the syntax it is meant to exercise.
    ignorePatterns: ["test.md"],
  },
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "eslint-plugin-solid", // Only enabled for the app (see below)
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    // Per-target rules
    overrides: [
      // Core library: browser runtime, published to npm
      {
        files: ["packages/typodown/**"],
        env: { browser: true },
        rules: {
          // A published library should not ship stray console output
          "no-console": ["error", { allow: ["warn", "error"] }],
        },
      },
      // VSCode extension host: Node runtime with the `vscode` API
      {
        files: ["apps/typodown-vsx/**"],
        env: { node: true },
      },
      // ...except the webview bundle, which runs in a browser context
      {
        files: ["apps/typodown-vsx/src/webview/**"],
        env: { browser: true },
      },
      // Tauri v2 app: SolidJS frontend running in the system WebView
      {
        files: ["apps/typodown-app/**"],
        env: { browser: true },
        rules: {
          // Solid binds `let el` refs via `ref={el}`; the compiler assigns
          // them, so Oxlint's "declared but never assigned" is a false positive
          "no-unassigned-vars": "off",
          ...solid.rules,
        },
      },
    ],
  },
  run: {
    tasks: {
      ready: { command: ["vp check", "vp run -r test", "vp run -r build"] },
      dev: {
        command: "vp run @vemonet/typodown#dev",
      },
      build: {
        command: "vp run -r build",
      },
      "demo:build": {
        command: "vp run @vemonet/typodown#demo:build && vp run typodown-pwa#build",
        dependsOn: ["@vemonet/typodown#build"],
      },

      // VSCode extension (vsce runs vscode:prepublish, which bundles via build.mjs)
      "vsx:build": {
        command: "vsce package --no-dependencies --out typodown.vsix",
        cwd: "apps/typodown-vsx",
        dependsOn: ["@vemonet/typodown#build"],
      },
      "vsx:install": {
        command: "code --install-extension apps/typodown-vsx/typodown.vsix --force",
        dependsOn: ["vsx:build"],
        cache: false,
      },

      // Tauri app
      "pwa:dev": {
        command: "vp run typodown-pwa#dev",
        dependsOn: ["@vemonet/typodown#build"],
        cache: false,
      },
      "app:dev": {
        command: "npm run tauri dev",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
        cache: false,
      },
      "app:build": {
        command: "npm run tauri build --release",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
      },
      "app:apk": {
        command: "npm run tauri android build -- --apk",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
      },
      // Android App Bundle (.aab) for the Play Store.
      "app:aab": {
        command: "npm run tauri android build -- --aab",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
      },

      "app:install": {
        command:
          "cp apps/typodown-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk ~/Dropbox/typodown.apk",
        dependsOn: ["vsx:install", "app:apk"],
      },

      benchmark: {
        command: "node packages/typodown/tests/benchmark/run.mjs",
      },

      // Upgrade dependencies in package.json
      upgrade: {
        command: "vp update --latest --recursive --workspace-root",
      },

      // Release process
      changelog: {
        command: "git cliff -o CHANGELOG.md --tag v$(npm pkg get version | tr -d '\"')\"",
      },
      release: {
        command: [
          'bumpp -r --all --commit --tag --push --execute "vp run changelog"',
          "npm publish -w @vemonet/typodown",
          "npm run vsx:publish -w typodown",
        ],
      },
    },
  },
});
