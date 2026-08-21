<div align="center">
<img src="packages/typodown/public/logo.png" alt="Typodown" width="120" />

# Typodown

**An open source markdown editor inspired by [Typora](https://typora.io), for the browser, VSCode, desktop and phone.**

[![Website](https://img.shields.io/badge/Website-Open-0ea5e9?logo=firefoxbrowser&logoColor=white)](https://typodown.app) [![npm](https://img.shields.io/npm/v/@vemonet/typodown?logo=npm)](https://www.npmjs.com/package/@vemonet/typodown) [![Install Extension](https://img.shields.io/badge/VSCode-Install_Extension-007ACC?logo=vscodium)](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown) [![Get the app](https://img.shields.io/badge/Get%20the%20app-Desktop%20%26%20Phone-10b981?logo=tauri)](https://github.com/vemonet/typodown/releases/latest)

[![Tests and deployment](https://github.com/vemonet/typodown/actions/workflows/ci.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/ci.yml) [![Release](https://github.com/vemonet/typodown/actions/workflows/release.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/release.yml)

</div>

---

There is no preview pane: markdown is rendered directly in the text you are typing. The raw `#`, `**` or backticks only show up on the construct your caret is sitting on.

Try it on the [**website**](https://typodown.app), the whole page is one editable markdown document.

## Features

- Edit rendered markdown directly, with the raw syntax revealed under the cursor.
- GitHub Flavored Markdown: GFM alerts (`> [!NOTE]`), task lists, editable tables, images, links, YAML front matter and raw HTML.
- LaTeX maths with KaTeX (`$...$` and `$$...$$`) and Mermaid diagrams.
- The usual shortcuts: <kbd>Ctrl/⌘</kbd>+<kbd>B</kbd> bold, <kbd>Ctrl/⌘</kbd>+<kbd>I</kbd> italic, <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>⇧+Tab</kbd> indent, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo / redo.
- Built on [CodeMirror 6](https://codemirror.net), so editing, selection, undo, IME and viewport virtualisation come from a well tested editor. The rendering is only a decoration layer on top of it.
- No telemetry, no remote server, your files stay where you put them.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).
