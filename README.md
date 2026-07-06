<div align="center">
<img src="packages/typodown/public/logo.png" alt="Typodown" width="120" />

# Typodown

**Open source WYSIWYG Markdown editor, inspired by [Typora](https://typora.io).**

[⚡️ Live demo](https://vemonet.github.io/typodown) · [📦 npm package](https://www.npmjs.com/package/@vemonet/typodown) · [🧩 VSCode extension](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown-vsx)

</div>

---

Typodown renders markdown inline as you type. There is no split preview pane: the styled text is the document. Move your caret into a heading, bold, code span, or link and its raw markdown markers (`#`, `**`, `` ` ``) reveal just for that construct, like Typora.

## Why

There are lots of markdown editors out there, but none get it right like [Typora](https://typora.io) does. Rich text editors that export to markdown are not what we are looking for, we want to edit markdown while it's rendered, not have to deal with a ms office lookalike.

The problem is that Typora is a closed desktop app so it can't be integrated anywhere.

This library implements a simple editor component that enable to edit markdown anywhere JS works, and it comes with a companion VSCode extension.

## Features

- **WYSIWYG markdown editing.** Edit rendered markdown directly. No preview to keep in sync. No rich text edition panel.
- **Syntax reveals under the cursor.** Raw markers appear only for the construct you are editing, everything else stays rendered.
- **Built on CodeMirror 6.** Battle-tested editing, selection, undo, IME and viewport virtualisation, live preview is a decoration layer on top.
- **GitHub Flavored Markdown.** Headings, emphasis, strikethrough, code spans and fenced code (with syntax highlighting), blockquotes, GFM alerts (`> [!NOTE]`), task lists, tables, images, links and horizontal rules.
- **Syntax highlighting** in fenced code blocks for many languages.
- **LaTeX maths and Mermaid diagram visualization**. Inline `$...$` and block `$$...$$` math rendered with KaTeX.
- **GitHub light and dark themes.** Follows the OS colour scheme, or pin to light/dark.
- **Familiar shortcuts.** <kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Cmd/Ctrl</kbd>+<kbd>I</kbd> italic, <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> undo / redo.

## Use it

Typodown ships in two forms:

| Form                 | Description                                                                 | Package                                            |
| -------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| **Library**          | Embed the editor in any web app. Framework-agnostic, built on CodeMirror 6. | [`@vemonet/typodown`](packages/typodown/README.md) |
| **VSCode extension** | Edit `.md` files with the Typodown editor inside VSCode.                    | [`typodown-vsx`](apps/typodown-vsx/README.md)      |

### Library

```bash
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

Install **Typodown** from the Marketplace, open any `.md` file with Typodown (right click file. See the [extension README](apps/typodown-vsx/README.md) for details.

> [!TIP]
>
> To make it the default editor for Markdown, run **View: Reopen Editor With... → Configure default editor for `*.md`**.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.
