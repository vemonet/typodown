# Typodown

Edit markdown in VSCode the way [Typora](https://typora.io) does: a WYSIWYG editor where the styled text is the document.

Typodown renders [GitHub Flavored Markdown](https://github.github.com/gfm/) inline as you type — no split preview to keep in sync. Put your caret on a heading, bold run, link or code span and its raw markdown syntax (`#`, `**`, `` ` ``) reveals for just that construct, exactly like Typora.

## Features

- **WYSIWYG markdown editing** backed by the plain text file, no separate preview.
- **GitHub Flavored Markdown**: headings, emphasis, strikethrough, code spans and fenced code, blockquotes, GFM alerts (`> [!NOTE]`), task lists, editable tables, links and images.
- **Syntax highlighting** in fenced code blocks for many languages.
- **LaTeX maths and Mermaid diagram visualization**. Inline `$...$` and block `$$...$$` math rendered with KaTeX.
- **Editor shortcuts**: <kbd>Cmd/Ctrl</kbd>+<kbd>B</kbd> bold, <kbd>Cmd/Ctrl</kbd>+<kbd>I</kbd> italic, <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd> undo / redo.
- **Theme aware**: follows your VSCode color theme by default, or pin it to a GitHub-like light/dark theme.
- Powered by the [**`@vemonet/typodown`**](https://www.npmjs.com/package/@vemonet/typodown) library.

## Usage

Open any `.md` file, then launch the editor from:

- the **Open with Typodown** button in the editor title bar,
- the explorer **right-click** context menu, or
- the command palette (**Typodown: Open with Typodown** / **Open with Typodown to the Side**).

The text file stays the single source of truth, so Typodown works alongside VSCode's text editor, source control and undo/redo.

To make it the default editor for Markdown, run **View: Reopen Editor With... → Configure default editor for `*.md`**.

## Settings

| Setting          | Default  | Description                                                                  |
| ---------------- | -------- | ---------------------------------------------------------------------------- |
| `typodown.theme` | `editor` | Color theme: `editor` (follow the current VSCode theme), `light`, or `dark`. |
