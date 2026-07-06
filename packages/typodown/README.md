# 🖋️ Typodown

[![npm](https://img.shields.io/npm/v/@vemonet/typodown.svg)](https://www.npmjs.com/package/@vemonet/typodown)
[![license](https://img.shields.io/npm/l/@vemonet/typodown.svg)](https://github.com/vemonet/typodown/blob/main/LICENSE)

A [Typora](https://typora.io)-inspired WYSIWYG markdown editor for the web, built on [CodeMirror 6](https://codemirror.net) for battle-tested editing, selection and viewport virtualisation.

The markdown source is the single source of truth: there is no separate preview pane, the styled text is rendered inline and edited directly. Move the caret into a heading, bold run, code span or link and its raw markdown markers (`#`, `**`, `` ` ``) reveal for just that construct, like Typora.

**[⚡️ Live demo →](https://vemonet.github.io/typodown)**

## Features

- **WYSIWYG markdown editing.** Edit rendered markdown directly. No preview to keep in sync. No rich text edition panel.
- **Syntax reveals under the cursor.** Only the construct holding the caret shows its raw syntax, everything else stays rendered.
- **GitHub Flavored Markdown.** Headings, emphasis, strikethrough, code spans and fenced code (with syntax highlighting for many languages), blockquotes, GFM alerts (`> [!NOTE]`), task lists, tables, images, links, autolinks, horizontal rules, and LaTeX maths (inline `$...$` and block `$$...$$` rendered with [KaTeX](https://katex.org)).
- **GitHub theme, light and dark.** Ships a stylesheet that follows the OS colour scheme, or can be pinned to light/dark.
- **Familiar shortcuts.** <kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Cmd/Ctrl</kbd>+<kbd>I</kbd> italic, <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent / outdent, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> undo / redo.

## Install

```bash
npm i --save @vemonet/typodown
```

## Usage

```ts
import { createTypodown } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";

const editor = createTypodown(document.getElementById("app")!, {
  value: "# Hello",
  theme: "auto", // "light" | "dark" | "auto"
  placeholder: "Write some markdown...",
  onChange: (markdown) => console.log(markdown),
});

editor.getValue(); // read the current markdown
editor.setValue("new **content**");
editor.setTheme("dark");
editor.focus();
editor.destroy();
```

### From plain HTML, no bundler

A standalone UMD build (CodeMirror and Lezer bundled in) is available as `dist/index.umd.js` (e.g. on [unpkg](https://unpkg.com)/[jsDelivr](https://www.jsdelivr.com)), exposing a `Typodown` global. It's larger than the npm package (~189 KB gzipped, vs ~16 KB when CodeMirror is shared with the rest of your bundle), since it can't dedupe those dependencies against anything else on the page:

```html
<link rel="stylesheet" href="https://unpkg.com/@vemonet/typodown/dist/style.css" />
<script src="https://unpkg.com/@vemonet/typodown/dist/index.umd.js"></script>

<div id="app"></div>
<script>
  const editor = Typodown.createTypodown(document.getElementById("app"), {
    value: "# Hello",
  });
</script>
```

### Options

| Option             | Type                      | Default          | Description                             |
| ------------------ | ------------------------- | ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `value`            | `string`                  | `""`             | Initial markdown content.               |
| `theme`            | `"light"                  | "dark"           | "auto"`                                 | `"auto"`                                                                                                                                     | Colour theme. `auto` follows the OS preference. |
| `placeholder`      | `string`                  | `""`             | Shown while the document is empty.      |
| `spellcheck`       | `boolean`                 | `false`          | Enable the browser's native spellcheck. |
| `html`             | `boolean`                 | `true`           | Allow raw HTML in the markdown.         |
| `onChange`         | `(value: string) => void` |                  | Called whenever the content changes.    |
| `getClipboardText` | `() => string             | Promise<string>` | `navigator.clipboard.readText`          | Read the clipboard for the `Cmd/Ctrl+K` link shortcut. Provide this in embedders where the Clipboard API is blocked (e.g. VS Code webviews). |

> `LANGUAGES` and `matchLanguages` are also exported for standalone use with the fenced-code language picker.

## CommonMark compatibility

Typodown parses markdown with [`@lezer/markdown`](https://github.com/lezer-parser/markdown) (the same incremental CommonMark parser [`@codemirror/lang-markdown`](https://codemirror.net/docs/ref/#lang-markdown) uses) configured with its `GFM` extension bundle (tables, task lists, strikethrough, autolinks), the parser CodeMirror itself ships as its official Markdown mode, not a bespoke one.

Typodown itself never renders HTML, it's a live-preview overlay directly on the markdown source, not a markdown-to-HTML renderer, so "CommonMark compliance" isn't really a property of the editor as much as of the parser it's built on. To put a number on that anyway, [`tests/commonmark-spec.test.ts`](tests/commonmark-spec.test.ts) runs every example in the official [CommonMark spec suite](https://spec.commonmark.org) (652 examples) through a minimal reference HTML renderer built for testing only ([`tests/commonmark-html.ts`](tests/commonmark-html.ts)) and diffs the output against the spec's expected HTML.

**Current result: 612/652 (93.9%).** The remaining gaps are parser-level, not something the live-preview layer can work around:

- **Tabs** (10/11 failing): tab characters aren't expanded to the CommonMark-specified 4-column stops for indentation purposes, so a leading tab doesn't trigger indented code the way 4 spaces would.
- **Raw HTML edge cases**: a handful of unusual-but-valid inline tags (unclosed angle brackets spanning lines, HTML comments containing `--`) aren't recognized as HTML and get escaped as text instead.
- **Reference links**: a few link-reference corner cases (labels containing nested unresolved brackets, Unicode case-folding like `ẞ`/`SS`, ambiguous adjacent reference forms) resolve differently than the spec's backtracking algorithm.
- **A long tail of single-example edge cases** across list items, indented/fenced code, and setext headings (see the test file for the exact count breakdown per spec section).

## How it works

CodeMirror 6 owns the document, caret, selection, undo history and viewport virtualisation; the markdown text in its buffer is the single source of truth. A `ViewPlugin` (for inline/line decorations) and a `StateField` (for block-level replacements like tables) walk the Lezer syntax tree over the visible viewport on every change and produce `Decoration`s that style each construct and hide its raw syntax marks (`**`, `#`, backticks, `[...](...)`), unless the selection overlaps that construct, in which case the marks are revealed so the source stays directly editable exactly where the caret is.
