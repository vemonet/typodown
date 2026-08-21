# 🖋️ Typodown app

An open source markdown editor for desktop (Linux, macOS, Windows) and Android, inspired by [Typora](https://typora.io).

Markdown is rendered directly in the text you type, so there is no preview pane to keep in sync and no mode to toggle. Move your caret into a heading, bold run, code span or link and only its raw markers (`#`, `**`, `` ` ``) show up, for as long as you are editing it.

## Features

- Edit the rendered markdown directly, with the raw syntax revealed under the cursor, using the [`@vemonet/typodown`](https://www.npmjs.com/package/@vemonet/typodown) library.
- GitHub Flavored Markdown: GFM alerts (`> [!NOTE]`), task lists, editable tables, images and links.
- LaTeX maths with KaTeX, and Mermaid diagrams.
- Auto-save: edits are written about a second after you stop typing. On Android, writes to cloud providers are paced to avoid sync conflicts.
- The usual shortcuts (<kbd>Ctrl/⌘</kbd>+<kbd>B</kbd> / <kbd>I</kbd> / <kbd>K</kbd>, <kbd>Tab</kbd> indent, undo/redo), plus a floating toolbar for touch screens.
- A file explorer, to open a folder as a file tree.
- A graph view, built from the files using the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf).

### On desktop

Open a folder of markdown files, or a single file, double-clicking a `.md` file in your file manager works too.

### On Android

Open a `.md` file with Typodown straight from your file or storage app (Dropbox, Google Drive, Nextcloud, ...). Anything exposing a writable Android documents provider works; there is no per-provider integration.

## Development

Dev server:

```sh
npm run tauri dev
```

Build desktop app:

```sh
npm run tauri build
```

Build android app:

```sh
npm run tauri android build -- --apk
```

Android App bundle:

```sh
npm run tauri android build -- --aab
```

Init Android Studio, enable NDK and CLI in Settings > Android SDK

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```

To sign the Android `.apk`, generate a keystore

```sh
mkdir -p ~/.keystores
keytool -genkey -v -keystore ~/.keystores/typodown.jks -keyalg RSA -keysize 2048 -validity 10000 -alias typodown
```

Create `apps/typodown-app/src-tauri/gen/android/keystore.properties`

```sh
storeFile=/Users/you/.keystores/typodown.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=typodown
```
