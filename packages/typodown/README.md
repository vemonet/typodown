# @vemonet/typodown

[![npm](https://img.shields.io/npm/v/@vemonet/typodown.svg)](https://www.npmjs.com/package/@vemonet/typodown)
[![license](https://img.shields.io/npm/l/@vemonet/typodown.svg)](https://github.com/vemonet/typodown/blob/main/LICENSE)

A [Typora](https://typora.io)-inspired WYSIWYG Markdown editor for the web, written in vanilla TypeScript with **zero runtime dependencies** (~16kB gzipped).

The markdown source is the single source of truth: there is no separate preview pane, the styled text is rendered inline and edited directly. Move the caret into a heading, bold run, code span or link and its raw markdown markers (`#`, `**`, `` ` ``) reveal for just that construct, exactly like Typora.

**[Live demo →](https://vemonet.github.io/typodown)**

## Features

- **WYSIWYG, not rich text.** Edits are applied to the markdown string and re-rendered; you always get clean `.md` back.
- **Syntax reveals under the cursor.** Only the construct holding the caret shows its raw syntax; everything else stays rendered.
- **GitHub Flavored Markdown.** Headings, emphasis, strikethrough, code spans and fenced code (with syntax highlighting for many languages), blockquotes, GFM alerts (`> [!NOTE]`), task lists, tables, images, links, autolinks and horizontal rules.
- **GitHub theme, light and dark.** Ships a stylesheet that follows the OS colour scheme, or can be pinned to light/dark.
- **Editor shortcuts.** `Cmd/Ctrl+B` bold, `Cmd/Ctrl+I` italic, `Cmd/Ctrl+K` link, `Tab` / `Shift+Tab` indent / outdent list items, `Cmd/Ctrl+Z` / `Shift+Z` undo / redo.

## Install

```bash
npm install @vemonet/typodown
```

## Usage

```ts
import { createTypodown } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";

const editor = createTypodown(document.getElementById("app")!, {
  value: "# Hello\n\nType **markdown** here.",
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

### Options

| Option             | Type                              | Default                        | Description                                                                                                                                  |
| ------------------ | --------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`            | `string`                          | `""`                           | Initial markdown content.                                                                                                                    |
| `theme`            | `"light" \| "dark" \| "auto"`     | `"auto"`                       | Colour theme. `auto` follows the OS preference.                                                                                              |
| `placeholder`      | `string`                          | `""`                           | Shown while the document is empty.                                                                                                           |
| `spellcheck`       | `boolean`                         | `false`                        | Enable the browser's native spellcheck.                                                                                                      |
| `html`             | `boolean`                         | `true`                         | Allow raw HTML in the markdown.                                                                                                              |
| `onChange`         | `(value: string) => void`         |                                | Called whenever the content changes.                                                                                                         |
| `getClipboardText` | `() => string \| Promise<string>` | `navigator.clipboard.readText` | Read the clipboard for the `Cmd/Ctrl+K` link shortcut. Provide this in embedders where the Clipboard API is blocked (e.g. VS Code webviews). |

The parser is also exported for standalone use: `parse` (blocks), `parseInline` (inline), and the AST node types.

## CommonMark support

Typodown supports most of [CommonMark](https://commonmark.org) plus the GitHub Flavored Markdown extensions above. It is **not** a fully conformant CommonMark implementation: the editor renders a live, editable DOM (with syntax reveal) rather than canonical HTML, and a few spec features are intentionally left out because they conflict with that model or are rarely used when editing.

Supported: ATX headings, paragraphs (with soft-wrapped lines), thematic breaks, fenced code blocks, blockquotes, GFM alerts, ordered/unordered/nested/task lists, tables, and the inline constructs (emphasis, strong, strikethrough, code spans, links, images, autolinks, backslash escapes).

Not supported yet (these parse safely as paragraphs/text, they just don't get their full CommonMark meaning):

- Setext headings (`===` / `---` underlines)
- Indented (4-space) code blocks
- HTML blocks and inline raw HTML (rendered as escaped text)
- Link reference definitions (`[id]: url`) and reference links (`[text][id]`)
- Hard line breaks (two trailing spaces or a trailing backslash)
- Nested blockquotes, and block-level children inside quotes / list items beyond soft-wrapped continuation lines
- Loose lists (a blank line between items ends the list)
- Full CommonMark emphasis flanking rules and HTML entity references

The parser guarantees one invariant for **any** input, supported or not: block and inline source ranges tile the document with no gaps, so the editor never corrupts the caret. This is exercised by a corpus test covering every CommonMark spec section (`tests/commonmark.test.ts`).

## How it works

The parser (`parse` / `parseInline`) turns markdown into an AST where every node, including the syntax characters, carries absolute source offsets. Those ranges tile the document with no gaps, so the caret can be tracked as a plain source offset and mapped back onto the DOM after every re-render. Edits are intercepted at the `beforeinput` stage, applied to the source string, and the document is re-rendered. Each markdown construct is a "region" with a source range; the one(s) the caret is inside get a `.td-on` class, which is all the CSS needs to reveal that construct's raw syntax.

## Development

```bash
vp install
vp dev              # run the demo
vp test
vp check            # format, lint, type check
vp pack             # build the package
```
