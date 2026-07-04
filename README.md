<div align="center">

<img src="packages/typodown/public/logo.png" alt="Typodown" width="120" />

# Typodown

**A lightweight WYSIWYG Markdown editor for the web, inspired by [Typora](https://typora.io).**

[Live demo](https://vemonet.github.io/typodown) · [npm package](https://www.npmjs.com/package/@vemonet/typodown) · [VSCode extension](https://marketplace.visualstudio.com/items?itemName=vemonet.typodown-vsx)

</div>

---

Typodown renders GitHub Flavored Markdown inline as you type. There is no split preview pane: the styled text _is_ the document. Move your caret into a heading, bold run, link or code span and its raw markdown markers (`#`, `**`, `` ` ``) reveal for just that construct, exactly like Typora.

The markdown source is always the single source of truth, so your files stay plain `.md` that any other tool can read.

## Why Typodown

- **True WYSIWYG.** Edit rendered markdown directly. No preview to keep in sync.
- **Syntax reveals under the cursor.** Raw markers appear only for the construct you are editing; everything else stays rendered.
- **Tiny and dependency-free.** ~16kB of gzipped JavaScript, zero runtime dependencies.
- **GitHub Flavored Markdown.** Headings, emphasis, strikethrough, code spans and fenced code (with syntax highlighting), blockquotes, GFM alerts (`> [!NOTE]`), task lists, tables, images, links and horizontal rules.
- **GitHub light and dark themes.** Follows the OS colour scheme, or pin to light/dark.
- **Familiar shortcuts.** <kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Cmd/Ctrl</kbd>+<kbd>I</kbd> italic, <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> undo / redo.

## Use it

Typodown ships in two forms:

|                      |                                                                          |                                                    |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| **Library**          | Embed the editor in any web app. Framework-agnostic, vanilla TypeScript. | [`@vemonet/typodown`](packages/typodown/README.md) |
| **VSCode extension** | Edit `.md` files with the Typodown editor inside VSCode.                 | [`typodown-vsx`](apps/typodown-vsx/README.md)      |

### Library

```bash
npm install @vemonet/typodown
```

```ts
import { createTypodown } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";

createTypodown(document.getElementById("app")!, {
  value: "# Hello\n\nType **markdown** here.",
  theme: "auto",
});
```

> See the [package README](packages/typodown/README.md) for the full API.

### VSCode extension

Install **Typodown** from the Marketplace, open any `.md` file, then run **Open with Typodown**. See the [extension README](apps/typodown-vsx/README.md) for details.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.
