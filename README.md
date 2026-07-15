<div align="center">
<img src="packages/typodown/public/logo.png" alt="Typodown" width="120" />

# Typodown

**Seamless open-source markdown editing, inspired by [Typora](https://typora.io). Available everywhere you write.**

[⚡️ Live demo](https://vemonet.github.io/typodown) · [🧩 VSCode extension](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown) · [🖥️ Desktop & Android app](https://github.com/vemonet/typodown/releases) · [📦 npm package](https://www.npmjs.com/package/@vemonet/typodown)

</div>

---

Typodown blends reading and writing markdown into one continuous motion. Markdown renders where you type: no preview pane to keep in sync, no mode to toggle, no markup cluttering the page.

Move your caret into a heading, bold run, code span or link and only its raw markers (`#`, `**`, `` ` ``) surface for the moment you edit them, then settle back into place as you move on. The content stays central, the syntax stays out of the way.

## Why

[Typora](https://typora.io) nailed markdown editing: you edit the rendered document directly, and it is still just markdown underneath. Nothing else gets that feeling right, rich-text editors that export to markdown are word processors in disguise.

But Typora is a closed-source desktop app, so that experience stops at its window. Typodown is an open source editor component heavily inspired by it, that embeds anywhere the web runs: your app, VSCode, desktop, your phone.

## Features

- **Seamless markdown editing.** WYSIWYG, edit rendered markdown directly. No preview to keep in sync.
- **Syntax reveals under the cursor.** Raw markers appear only for the construct you are editing, everything else stays rendered.
- **GitHub Flavored Markdown.** GFM alerts (`> [!NOTE]`), task lists, editable tables, images, links, YAML front matter and arbitrary HTML.
- **LaTeX math and Mermaid diagrams.** Inline `$...$` and block `$$...$$` rendered with KaTeX.
- **Familiar shortcuts.** <kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Cmd/Ctrl</kbd>+<kbd>I</kbd> italic, <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> undo / redo.
- **Built on CodeMirror 6.** Battle-tested editing, selection, undo, IME and viewport virtualisation, the live preview is a decoration layer on top.
- **Fully local.** No telemetry, no remote server.

## Use it

Typodown ships in various forms:

|                      | Description                                                                            | Get it                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Library**          | Embed the editor in any web app. Framework-agnostic                                    | [`@vemonet/typodown`](https://www.npmjs.com/package/@vemonet/typodown)                     |
| **VSCode extension** | Edit `.md` files with the Typodown editor inside VSCode                                | [`vemonet.typodown`](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown) |
| **Desktop app**      | Open folders of `.md` files, with file explorer and graph view (Linux, macOS, Windows) |
| **Android app**      | Open `.md` files                                                                       | [Download](https://github.com/vemonet/typodown/releases)                                   |

> Contributions welcome, especially if someone with an iOS developer account wants to help ship the iOS app.

### Library

```sh
npm i --save @vemonet/typodown
```

```ts
import { createTypodown } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";

createTypodown(document.getElementById("app")!, {
  value: "# Hello",
  theme: "auto",
});
```

> See the [package README](packages/typodown/README.md) for the full API.

### VSCode extension

Install **Typodown** from the Marketplace, then right-click any `.md` file → **Open with Typodown**. See the [extension README](apps/typodown-vsx/README.md) for details.

> [!TIP]
> To make it the default editor for Markdown, run **View: Reopen Editor With... → Configure default editor for `*.md`**.

### App

Desktop and Android apps are built from the same codebase with Tauri v2:

- **Desktop**: open a folder as a vault, with a file tree on the left and outline navigation on the right.
- **Android**: open a `.md` file straight from your storage app (Dropbox, Google Drive, ...). Edits auto-save about a second after you stop typing, paced to avoid cloud sync conflicts.

The desktop app enables to generate a graph view from files in Open Knowledge Format.

Install by downloading the right artefact from the releases page.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).
