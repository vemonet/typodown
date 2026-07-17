# Typodown

Seamless open-source markdown editing, inspired by [Typora](https://typora.io).

Typodown renders markdown inline as you type, no split preview to keep in sync. Put your caret on a heading, bold run, link or code span and its raw markdown syntax (`#`, `**`, `` ` ``) reveals for just that construct.

**[⚡️ Live demo →](https://vemonet.github.io/typodown)**

## Features

- **Seamless markdown editing.** WYSIWYG, edit rendered markdown directly. No preview to keep in sync.
- **GitHub Flavored Markdown**. GFM alerts (`> [!NOTE]`), checkboxes lists, editable tables, images, links, YAML front matter and arbitrary HTML.
- **LaTeX maths and Mermaid diagram visualization**. Inline `$...$` and block `$$...$$` math rendered with KaTeX.
- **Editor shortcuts**: <kbd>Ctrl/⌘</kbd>+<kbd>B</kbd> bold, <kbd>Ctrl/⌘</kbd>+<kbd>I</kbd> italic, <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> link, <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo / redo.
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
