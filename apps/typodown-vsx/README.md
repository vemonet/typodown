# Typodown

An open source markdown editor inspired by [Typora](https://typora.io), inside VSCode.

Typodown renders markdown inline as you type, so there is no split preview to keep in sync. Put your caret on a heading, **bold term**, [link](/) or `code span` and the raw markdown shows up for that construct only.

**[⚡️ Live demo →](https://typodown.app)**

## Features

- Edit the rendered markdown directly, with the raw syntax revealed under the cursor.
- GitHub Flavored Markdown: GFM alerts (`> [!NOTE]`), checkbox lists, editable tables, images, links, YAML front matter and raw HTML.
- LaTeX maths with KaTeX (inline `$...$` and block `$$...$$`) and Mermaid diagrams.
- The usual shortcuts: <kbd>Ctrl/⌘</kbd>+<kbd>B</kbd> bold, <kbd>Ctrl/⌘</kbd>+<kbd>I</kbd> italic, <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo / redo.
- Follows your VSCode color theme by default, or pin it to a GitHub-like light or dark theme.
- Built on the [`@vemonet/typodown`](https://www.npmjs.com/package/@vemonet/typodown) library.

## Usage

Open any `.md` file, then launch the editor from:

- the **Open with Typodown** button in the editor title bar,
- the explorer **right-click** context menu, or
- the command palette (**Typodown: Open with Typodown** / **Open with Typodown to the Side**).

The text file stays the only source of truth, so Typodown works alongside VSCode's text editor, source control and undo/redo.

To make it the default editor for Markdown, run **View: Reopen Editor With... → Configure default editor for `*.md`**.

## Settings

| Setting          | Default  | Description                                                                  |
| ---------------- | -------- | ---------------------------------------------------------------------------- |
| `typodown.theme` | `editor` | Color theme: `editor` (follow the current VSCode theme), `light`, or `dark`. |
