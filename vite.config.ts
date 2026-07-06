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
      "install:vsx": {
        command:
          "npm run build -w @vemonet/typodown && npm run package -w typodown-vsx && code --install-extension apps/typodown-vsx/typodown-vsx.vsix --force",
        cache: false,
      },
    },
  },
});
