<div align="center">
<img src="packages/typodown/public/logo.png" alt="Typodown" width="120" />

# Typodown

**Seamless open-source markdown editing, inspired by [Typora](https://typora.io). Available everywhere you write.**

[![Website](https://img.shields.io/badge/Website-Open-0ea5e9?logo=firefoxbrowser&logoColor=white)](https://typodown.app) [![npm](https://img.shields.io/npm/v/@vemonet/typodown?logo=npm)](https://www.npmjs.com/package/@vemonet/typodown) [![Install Extension](https://img.shields.io/badge/VSCode-Install_Extension-007ACC?logo=vscodium)](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown) [![Get the app](https://img.shields.io/badge/Get%20the%20app-Desktop%20%26%20Phone-10b981?logo=tauri)](https://github.com/vemonet/typodown/releases/latest)

[![Tests and deployment](https://github.com/vemonet/typodown/actions/workflows/ci.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/ci.yml) [![Release](https://github.com/vemonet/typodown/actions/workflows/release.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/release.yml)

</div>

---

Markdown renders where you type: no preview pane, no markup cluttering the page. Reading and writing blend into one continuous experience.

Move your caret into a heading, **bold term**, `code span` or [link](/) and only its raw markers surface for the moment you edit them, then settle back into place as you move on. The content stays central, the syntax stays out of the way.

## Features

- **Seamless markdown editing.** WYSIWYG, edit rendered markdown directly.
- **Syntax reveals under the cursor.** Raw markers appear only for the construct you are editing, everything else stays rendered.
- **GitHub Flavored Markdown.** GFM alerts (`> [!NOTE]`), task lists, editable tables, images, links, YAML front matter and arbitrary HTML.
- **LaTeX math and Mermaid diagrams.** Inline `$...$` and block `$$...$$` rendered with KaTeX.
- **Familiar shortcuts.** <kbd>Ctrl/⌘</kbd>+<kbd>B</kbd> bold, <kbd>Ctrl/⌘</kbd>+<kbd>I</kbd> italic, <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>⇧+Tab</kbd> indent, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo / redo.
- **Built on [CodeMirror 6](https://codemirror.net).** Battle-tested editing, selection, undo, IME and viewport virtualisation, the live preview is a decoration layer on top.
- **Fully local.** No telemetry, no remote server.

## Use it

Typodown ships in various forms:

|                      | Description                                                                            | Get it                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Library**          | Embed the editor in any web app. Framework-agnostic                                    | [`@vemonet/typodown`](https://www.npmjs.com/package/@vemonet/typodown)                     |
| **VSCode extension** | Edit `.md` files with the Typodown editor inside VSCode                                | [`vemonet.typodown`](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown) |
| **Desktop app**      | Open folders of `.md` files, with file explorer and graph view (Linux, macOS, Windows) | [Download](https://github.com/vemonet/typodown/releases)                                   |
| **Android app**      | Open `.md` files                                                                       | [Download](https://github.com/vemonet/typodown/releases)                                   |

> Contributions welcome, especially if someone with an iOS developer account wants to help ship the iOS app.

See the [website](https://typodown.app) for more details.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).
