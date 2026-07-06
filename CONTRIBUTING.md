# 🛠️ Development

[![CI](https://github.com/vemonet/typodown/actions/workflows/ci.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/ci.yml)

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

## ⚡️ Start demo website

Run dev server:

```sh
vp run @vemonet/typodown#dev
```

Build website:

```sh
vp run @vemonet/typodown#build:demo
```

## 🧩 Start VSCode extension

Build lib:

```sh
vp run @vemonet/typodown#build
```

Start the VSCode extension dev host using <kbd>F5</kbd> in VSCode.

Build and install extension in local VSCode:

```sh
vp run install:vsx
```

## 🏷️ Release

```sh
vp run release
```

## ☑️ Todo

- [ ] Don't switch tables to raw, enable to edit directly in the rendered table. With a small 3 dots button that appears when cursor in the table (top left of the table), show submenu with actions like insert row. Enable markdown rendering of text inside cell of a table
- [ ] Support local image link in HTML
- [ ] Add command bar floating top of editor? For bold, link, etc. Default is hidden, use short ut to show it, can be enabled as always show in `createTypodown()`
- [ ] Add right click menu option to add a table. This opens a small popup with 2 fields to provide number of rows and columns
