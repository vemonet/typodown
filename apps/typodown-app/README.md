# 🖋️ Typodown app

A [Typora](https://typora.io)-inspired markdown editor for desktop (Linux, macOS, Windows) and Android, built with Tauri v2.

Typodown blends reading and writing markdown into one continuous motion. Markdown renders where you type: no preview pane to keep in sync, no mode to toggle, no markup cluttering the page. Move your caret into a heading, bold run, code span or link and only its raw markers (`#`, `**`, `` ` ``) surface for the moment you edit them. The content stays central, the syntax stays out of the way.

## Features

- **WYSIWYG markdown editing** with syntax revealed under the cursor, powered by the [`@vemonet/typodown`](https://www.npmjs.com/package/@vemonet/typodown) library.
- **GitHub Flavored Markdown**: headings, emphasis, strikethrough, inline code and fenced code (with syntax highlighting), blockquotes, GFM alerts (`> [!NOTE]`), task lists, editable tables, images and links.
- **LaTeX math and Mermaid diagrams**, rendered with KaTeX.
- **File explorer and outline.** Open a folder as a vault: file tree on the left, heading navigation on the right.
- **Auto-save.** Edits are written about a second after you stop typing; on Android, writes to cloud providers are paced to avoid sync conflicts.
- **GitHub light and dark themes**, following the OS colour scheme by default.
- **Familiar shortcuts** (<kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> / <kbd>I</kbd> / <kbd>K</kbd>, <kbd>Tab</kbd> indent, undo/redo) plus a floating toolbar for touch screens.

### On desktop

Open a folder of markdown files, or a single file — double-clicking a `.md` file in your file manager works too.

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
