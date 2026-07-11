import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
    tasks: {
      ready: { command: ["vp check", "vp run -r test", "vp run -r build"] },
      dev: {
        command: "vp run @vemonet/typodown#dev",
      },
      build: {
        command: "vp run -r build",
      },
      "build:demo": {
        command: "vp run @vemonet/typodown#build:demo",
      },

      // VSCode extension (vsce runs vscode:prepublish, which bundles via build.mjs)
      "build:vsx": {
        command: "vsce package --no-dependencies --out typodown.vsix",
        cwd: "apps/typodown-vsx",
        dependsOn: ["@vemonet/typodown#build"],
        cache: false,
      },
      "install:vsx": {
        command: "code --install-extension apps/typodown-vsx/typodown.vsix --force",
        dependsOn: ["build:vsx"],
        cache: false,
      },

      // Tauri app
      "dev:app": {
        command: "npm run tauri dev",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
      },
      "build:app": {
        command: "npm run tauri build --release",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
      },
      "build:apk": {
        command: "npm run tauri android build -- --apk",
        cwd: "apps/typodown-app",
        dependsOn: ["@vemonet/typodown#build"],
      },

      // Release process
      changelog: {
        command: "git cliff -o CHANGELOG.md --tag v$(npm pkg get version | tr -d '\"')\"",
      },
      release: {
        command: [
          'bumpp -r --all --commit --tag --push --execute "vp run changelog"',
          "npm publish -w @vemonet/typodown",
          "npm run publish:vsx -w typodown-vsx",
        ],
      },
    },
  },
});
