# 🛠️ Development

[![CI](https://github.com/vemonet/typodown/actions/workflows/ci.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/ci.yml) [![Release](https://github.com/vemonet/typodown/actions/workflows/release.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/release.yml)

> [!IMPORTANT]
>
> Requires [Vite+](https://viteplus.dev/guide/) installed.

Lint:

```sh
vp check --fix
```

Check everything is ready:

```bash
vp run ready
```

Run the tests:

```bash
vp test
```

Build the monorepo:

```bash
vp run build
```

## ⚡️ Demo website

Run dev server:

```sh
vp run dev
```

Build website:

```sh
vp run build:demo
```

## 🧩 VSCode extension

Build lib first:

```sh
vp run @vemonet/typodown#build
```

Start the VSCode extension dev host using <kbd>F5</kbd> in VSCode.

Build and install extension in your local VSCode:

```sh
vp run install:vsx
```

## 💻 Desktop and smartphone app

Built with [Tauri v2](https://v2.tauri.app/).

Start in dev:

```sh
vp run dev:app
```

Build desktop app:

```sh
vp run build:app
```

Build Android `.apk`:

```sh
vp run build:apk
```

## 🏷️ Release

> [!IMPORTANT]
>
> You must add these repo secrets or the Android job fails:
>
> - `ANDROID_KEYSTORE_BASE64`: your `typodown.jks` base64-encoded (`base64 -i ~/.keystores/typodown.jks | pbcopy`)
> - `ANDROID_KEYSTORE_PASSWORD`
> - `ANDROID_KEY_PASSWORD` (same as previous)
> - `ANDROID_KEY_ALIAS` (`typodown`)

```sh
vp run release
```

> > > > [!NOTE]
> > > > The npm package and VSCode extension will be built and published locally, then a GitHub actions workflow will generate artefacts for the different platforms (desktop app and android `.apk`)

## ☑️ Todo

- [ ] Support local image link in HTML
