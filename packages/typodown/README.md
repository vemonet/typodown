# 🖋️ Typodown

[![npm](https://img.shields.io/npm/v/@vemonet/typodown.svg)](https://www.npmjs.com/package/@vemonet/typodown)
[![license](https://img.shields.io/npm/l/@vemonet/typodown.svg)](https://github.com/vemonet/typodown/blob/main/LICENSE)

An embeddable markdown editor inspired by [Typora](https://typora.io).

There is no separate preview pane: the markdown is rendered inline in the text you edit, and the markdown source stays the only source of truth. Move the caret into a heading, bold run, code span or link and its raw markers (`#`, `**`, `` ` ``) show up for that construct only.

**[⚡️ Live demo →](https://typodown.app)**

## Features

- Edit the rendered markdown directly, no preview to keep in sync and no rich-text mode.
- Only the construct holding the caret shows its raw syntax, everything else stays rendered.
- GitHub Flavored Markdown, with syntax highlighting, GFM alerts (`> [!NOTE]`), checkbox lists, editable tables, mermaid diagrams, and LaTeX maths (inline `$...$` and block `$$...$$`, rendered with [KaTeX](https://katex.org)).
- The usual shortcuts: <kbd>Ctrl/⌘</kbd>+<kbd>B</kbd> bold, <kbd>Ctrl/⌘</kbd>+<kbd>I</kbd> italic, <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent / outdent, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo / redo.
- Built on [CodeMirror 6](https://codemirror.net).

## Install

```sh
npm i --save @vemonet/typodown
```

## Usage

```ts
import { createTypodown } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";

const editor = createTypodown(document.getElementById("editor")!, {
  value: "# Hello",
  theme: "auto",
  placeholder: "Write some markdown...",
  tabSize: 4, // spaces per indent level (Tab / Shift+Tab), defaults to 4
  onChange: (markdown) => console.log(markdown),
});

editor.getValue(); // read the current markdown
editor.setValue("new **content**");
editor.setTheme("dark");
editor.focus();
editor.destroy();
```

### Themes

Typodown includes `light` (GitHub Light), `dark` (GitHub Dark), `dracula`,
`nord`, `solarized-light`, and `solarized-dark`. `auto` switches between the
GitHub themes using the operating-system preference. A theme can be changed at
any time without recreating the editor:

```ts
editor.setTheme("dracula");
```

To provide a custom theme, pass any name and define its CSS variables on the
editor's `data-td-theme` attribute. Variables omitted here keep the default
GitHub Light value. Syntax variables are optional too.

```ts
editor.setTheme("rose-pine");
```

```css
.typodown[data-td-theme="rose-pine"] {
  --td-bg: #191724;
  --td-fg: #e0def4;
  --td-muted: #908caa;
  --td-faint: #6e6a86;
  --td-border: #403d52;
  --td-border-muted: #26233a;
  --td-heading-border: #403d52;
  --td-link: #c4a7e7;
  --td-code-bg: rgba(110, 106, 134, 0.2);
  --td-code-fg: #e0def4;
  --td-block-bg: #1f1d2e;
  --td-code-block-bg: #1f1d2e;
  --td-table-header-bg: #26233a;
  --td-table-alt-bg: #1f1d2e;
  --td-selection: rgba(196, 167, 231, 0.3);
}
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

| Option             | Type                              | Default                        | Description                                                                                                                                        |
| ------------------ | --------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`            | `string`                          | `""`                           | Initial markdown content.                                                                                                                          |
| `theme`            | `Theme`                           | `"auto"`                       | Bundled theme name or a custom `data-td-theme` name. `auto` follows the OS preference.                                                             |
| `placeholder`      | `string`                          | `""`                           | Shown while the document is empty.                                                                                                                 |
| `spellcheck`       | `boolean`                         | `false`                        | Enable the browser's native spellcheck.                                                                                                            |
| `html`             | `boolean`                         | `true`                         | Render raw HTML blocks/tags as live widgets.                                                                                                       |
| `joinSoftBreaks`   | `boolean`                         | `true`                         | Render a paragraph hard-wrapped in the source as one flowing paragraph. Off keeps every source line on its own visual line.                        |
| `tabSize`          | `number`                          | `4`                            | Spaces per indent level: what <kbd>Tab</kbd> inserts and <kbd>Shift</kbd>+<kbd>Tab</kbd> removes. Also settable later with `editor.setTabSize(n)`. |
| `toolbar`          | `"auto" \| "shown" \| "hidden"`   | `"auto"`                       | Floating formatting toolbar. `auto` starts visible on small screens and hidden on large ones; a floating button toggles it either way.             |
| `onChange`         | `(value: string) => void`         |                                | Called whenever the content changes.                                                                                                               |
| `getClipboardText` | `() => string \| Promise<string>` | `navigator.clipboard.readText` | Read the clipboard for the <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> link shortcut. Provide it where the Clipboard API is blocked (e.g. VSCode webviews).     |

> `LANGUAGES` and `matchLanguages` are also exported for standalone use with the fenced-code language picker.

## CommonMark compatibility

Since Typodown is an overlay on the markdown source rather than a markdown-to-HTML renderer, "CommonMark compliance" is really a property of the parser it is built on rather than of the editor. To put a number on it anyway, [`tests/commonmark-spec.test.ts`](tests/commonmark-spec.test.ts) runs every example in the official [CommonMark spec suite](https://spec.commonmark.org) (652 examples) through a minimal reference HTML renderer built for testing only ([`tests/commonmark-html.ts`](tests/commonmark-html.ts)) and diffs the output against the spec's expected HTML.

Current result: 612/652 (93.9%). The remaining gaps are parser-level, so the live-preview layer cannot work around them:

- Tabs (10/11 failing): tab characters aren't expanded to the CommonMark-specified 4-column stops for indentation, so a leading tab doesn't trigger indented code the way 4 spaces would.
- Raw HTML edge cases: a handful of unusual but valid inline tags (unclosed angle brackets spanning lines, HTML comments containing `--`) aren't recognized as HTML and get escaped as text instead.
- Reference links: a few corner cases (labels containing nested unresolved brackets, Unicode case-folding like `ẞ`/`SS`, ambiguous adjacent reference forms) resolve differently than the spec's backtracking algorithm.

## How it works

Typodown never renders the markdown to HTML: it is a live-preview overlay on the markdown source itself.

Markdown is parsed with [`@lezer/markdown`](https://github.com/lezer-parser/markdown) (the same incremental CommonMark parser [`@codemirror/lang-markdown`](https://codemirror.net/docs/ref/#lang-markdown) uses) configured with its `GFM` extension bundle (tables, task lists, strikethrough, autolinks).

CodeMirror 6 owns the document, caret, selection, undo history and viewport virtualisation, and the markdown text in its buffer is the only source of truth. A `ViewPlugin` (inline and line decorations) and a `StateField` (block-level replacements like tables) walk the Lezer syntax tree over the visible viewport on every change, producing `Decoration`s that style each construct and hide its raw syntax marks (`**`, `#`, backticks, `[...](...)`). When the selection overlaps a construct, its marks are left visible instead, so the source stays editable right where the caret is.
