# Typodown for VSCode

View and edit Markdown with a Typora-style WYSIWYG editor, right inside VSCode.

Typodown renders [GitHub Flavored Markdown](https://github.github.com/gfm/) inline as you type: no split preview, the styled text _is_ the document. Put your caret on a heading, bold run, link or code span and its raw markdown syntax (`#`, `**`, `` ` ``) reveals for just that construct, exactly like [Typora](https://typora.io). It edits the plain text file directly, so it works alongside the normal editor, source control and undo/redo.

Powered by the [`@vemonet/typodown`](https://www.npmjs.com/package/@vemonet/typodown) library.

## Features

- **WYSIWYG Markdown editing** backed by the plain text file, no separate preview.
- **GitHub Flavored Markdown**: headings, emphasis, strikethrough, code spans and fenced code, blockquotes, GFM alerts (`> [!NOTE]`), task lists, tables, links and images.
- **Syntax highlighting** in fenced code blocks for many languages.
- **Editor shortcuts**: <kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Cmd/Ctrl</kbd>+<kbd>I</kbd> italic, <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> undo / redo.
- **Theme aware**: follows your VSCode color theme by default, or pin it to a GitHub light/dark theme.

## Usage

Open any `.md` or `.markdown` file, then launch the editor from:

- the **Open with Typodown** button in the editor title bar,
- the explorer **right-click** context menu, or
- the command palette (**Typodown: Open with Typodown** / **Open with Typodown to the Side**).

The text file stays the single source of truth, so Typodown works alongside VSCode's text editor, source control and undo/redo.

To make it the default editor for Markdown, run **View: Reopen Editor With... → Configure default editor for `*.md`**.

## Settings

| Setting          | Default  | Description                                                                                               |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `typodown.theme` | `editor` | Color theme: `editor` (follow the current VSCode theme), `light` (GitHub light), or `dark` (GitHub dark). |

## Development

Build the editor library first, then the extension:

```bash
vp install
vp run @vemonet/typodown#build
vp run typodown-vsx#build
```

Then press <kbd>F5</kbd> in this folder to launch an Extension Development Host, or run `npm run watch` and attach.

The extension is bundled with esbuild (`build.mjs`): the extension host as CommonJS with `vscode` external, and the webview as a self-contained ESM bundle with the Typodown library and its stylesheet inlined.
