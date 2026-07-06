// Typodown editor.
//
// A Typora-style live-preview Markdown editor built on CodeMirror 6. The plain
// Markdown text is the single source of truth: CodeMirror owns the caret,
// selection, history, clipboard and viewport virtualisation, while a
// decoration layer (see live-preview.ts) styles the rendered result and hides
// the raw syntax except on the construct under the caret.

import {
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type Text,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt, type Command } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, insertNewline } from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  acceptCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import {
  insertNewlineContinueMarkup,
  deleteMarkupBackward,
  markdown,
  markdownLanguage,
} from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreview, ALERT_KINDS, markerEndOnLine } from "./live-preview.ts";
import { Math as MathExtension } from "./math.ts";
import { matchLanguages } from "./highlight.ts";
import { htmlToMarkdown } from "./clipboard.ts";
import { defaultMenuItems, openContextMenu, type MenuItemsProvider } from "./menu.ts";

export type Theme = "light" | "dark" | "auto";

export interface TypodownOptions {
  /** Initial markdown content. */
  value?: string;
  /** Colour theme. Defaults to "auto" (follows the OS preference). */
  theme?: Theme;
  /** Placeholder shown while the document is empty. */
  placeholder?: string;
  /** Enable the browser's native spellcheck (red squiggles). Defaults to false. */
  spellcheck?: boolean;
  /**
   * Read the clipboard for the Cmd/Ctrl+K link shortcut and plain paste. Defaults
   * to `navigator.clipboard.readText()`, which works in browsers but is blocked
   * in some embedders (e.g. VS Code webviews); provide this to read it from the
   * host instead.
   */
  getClipboardText?: () => string | Promise<string>;
  /** Called whenever the content changes. */
  onChange?: (value: string) => void;
  /** Render raw HTML blocks/tags as live widgets. Defaults to true. */
  html?: boolean;
  /**
   * Provide the items shown in the editor's right-click context menu. Return an
   * empty array to suppress the custom menu (the browser's native menu shows).
   * Defaults to a single "Add table" item that opens a rows/columns dialog.
   * Spread `defaultMenuItems(ctx)` to extend the defaults with your own items.
   */
  menuItems?: MenuItemsProvider;
}

/** A Typora-style live-preview Markdown editor built on CodeMirror 6. */
export class Typodown {
  readonly wrapper: HTMLElement;
  private readonly view: EditorView;
  private readonly getClipboardText?: () => string | Promise<string>;
  private readonly menuItems?: MenuItemsProvider;

  constructor(parent: HTMLElement, options: TypodownOptions = {}) {
    this.getClipboardText = options.getClipboardText;
    this.menuItems = options.menuItems;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "typodown";
    this.setTheme(options.theme ?? "auto");
    parent.appendChild(this.wrapper);

    const extensions: Extension[] = [
      typodownMarkdown(),
      livePreview({ html: options.html ?? true }),
      clampCursorPastMarker,
      history(),
      EditorView.lineWrapping,
      autocompletion({ override: [languageCompletions, alertCompletions], icons: false }),
      EditorView.contentAttributes.of({
        spellcheck: options.spellcheck ? "true" : "false",
        "aria-label": "Markdown editor",
      }),
      keymap.of([
        // The completion popup must claim Enter / arrows first (each command
        // returns false when the popup is closed, falling through to ours).
        ...completionKeymap,
        { key: "Mod-b", run: wrap("**") },
        { key: "Mod-i", run: wrap("*") },
        { key: "`", run: closeFenceOnThirdBacktick },
        { key: "`", run: wrapBacktick },
        { key: "Mod-k", run: (v) => this.insertLink(v) },
        { key: "Mod-Shift-v", run: (v) => this.plainPaste(v) },
        {
          key: "Tab",
          run: (v) => acceptCompletion(v) || changeIndent(false)(v),
          shift: changeIndent(true),
        },
        // Enter starts a new paragraph (Typora-style); Shift+Enter is a soft
        // line break. In lists / blockquotes, Enter continues the markup.
        {
          key: "Enter",
          run: (v) =>
            continueAlert(v) ||
            exitMarkupOnEmptyEnter(v) ||
            insertNewlineContinueMarkup(v) ||
            insertParagraph(v),
          shift: insertNewline,
        },
        {
          key: "Backspace",
          run: (v) =>
            deleteCodeBlockAtStart(v) || deleteParagraphGapBackward(v) || deleteMarkupBackward(v),
        },
        // At the content start of a bullet/checkbox/quote line, Left exits to
        // the previous line (runs before the default cursorCharLeft).
        { key: "ArrowLeft", run: arrowLeftPastMarker },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.domEventHandlers({
        paste: (event, view) => this.handlePaste(event, view),
        mousedown: (event, view) => this.handleMouseDown(event, view),
        contextmenu: (event, view) => this.handleContextMenu(event, view),
      }),
      // Cmd/Ctrl+A: select the code content when inside a code block. Handled at
      // highest precedence with stopPropagation so a host (e.g. the VS Code
      // webview, which reimplements select-all at the window level) does not run
      // its own select-all afterwards and clobber our selection.
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            const mod = event.metaKey || event.ctrlKey;
            if (
              mod &&
              !event.altKey &&
              !event.shiftKey &&
              (event.key === "a" || event.key === "A")
            ) {
              if (selectCodeContent(view)) {
                event.preventDefault();
                event.stopPropagation();
                return true;
              }
            }
            return false;
          },
        }),
      ),
    ];
    if (options.placeholder) extensions.push(placeholderExt(options.placeholder));
    if (options.onChange) {
      const onChange = options.onChange;
      extensions.push(
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      );
    }

    this.view = new EditorView({
      state: EditorState.create({ doc: options.value ?? "", extensions }),
      parent: this.wrapper,
    });
    // The transaction filter only runs on transactions, not on the initial
    // state, so if the document opens on a marker line with the caret at the
    // very start (before the bullet), clamp it to the content start now.
    const initPos = this.view.state.selection.main.head;
    const initLine = this.view.state.doc.lineAt(initPos);
    const initMarkEnd = markerEndOnLine(this.view.state, initLine);
    if (initMarkEnd != null && initPos < initMarkEnd) {
      this.view.dispatch({ selection: { anchor: initMarkEnd } });
    }
  }

  // ---- public API ---------------------------------------------------------

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(value: string): void {
    const state = this.view.state;
    const oldDoc = state.doc.toString();
    // Map the existing selection through the whole-document replacement via
    // the longest common prefix/suffix between old and new docs. Without this,
    // CodeMirror's default mapping drops the caret at position 0 (the start
    // of the inserted text) every time the host pushes an update -- e.g. VS
    // Code's "format on save" / "trim trailing whitespace on save" modifying
    // the document -- yanking the caret to the top of the file.
    const ranges = state.selection.ranges.map((r) =>
      EditorSelection.range(
        mapPosThroughReplacement(oldDoc, value, r.from),
        mapPosThroughReplacement(oldDoc, value, r.to),
      ),
    );
    this.view.dispatch({
      changes: { from: 0, to: oldDoc.length, insert: value },
      selection: EditorSelection.create(ranges, state.selection.mainIndex),
    });
    // clampCursorPastMarker only runs on selection-only transactions, so
    // re-clamp the main caret in case the mapped position landed inside a
    // hidden marker prefix on its new line.
    const main = this.view.state.selection.main;
    if (!main.empty) return;
    const line = this.view.state.doc.lineAt(main.head);
    const markEnd = markerEndOnLine(this.view.state, line);
    if (markEnd != null && main.head < markEnd) {
      this.view.dispatch({ selection: { anchor: markEnd } });
    }
  }

  setTheme(theme: Theme): void {
    this.wrapper.dataset.tdTheme = theme;
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
    this.wrapper.remove();
  }

  // ---- clipboard ----------------------------------------------------------

  private handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    const html = event.clipboardData?.getData("text/html") ?? "";
    if (!html) return false; // let CodeMirror insert the plain text
    const md = htmlToMarkdown(html);
    if (!md) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(md), {
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    return true;
  }

  private plainPaste(view: EditorView): boolean {
    const read = this.getClipboardText
      ? Promise.resolve(this.getClipboardText())
      : navigator.clipboard?.readText?.();
    if (!read) return false;
    void read
      .then((text) => {
        if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste" });
      })
      .catch(() => {
        // Clipboard unavailable: nothing to paste.
      });
    return true;
  }

  /** Cmd/Ctrl-click a link to open it; a plain click just places the caret. */
  private handleMouseDown(event: MouseEvent, view: EditorView): void {
    if (!(event.metaKey || event.ctrlKey)) return;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return;
    const url = linkUrlAt(view.state, pos);
    if (url) {
      event.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  /** Right-click opens the context menu (defaults to "Add table"; consumers can
   * extend via the `menuItems` option). The native browser menu is suppressed
   * whenever our menu has items to show. */
  private handleContextMenu(event: MouseEvent, view: EditorView): boolean {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const resolvedPos = pos ?? -1;
    const provider = this.menuItems ?? defaultMenuItems;
    const items = provider({ view, pos: resolvedPos, getClipboardText: this.getClipboardText });
    if (items.length === 0) return false;
    event.preventDefault();
    openContextMenu({ x: event.clientX, y: event.clientY }, view, resolvedPos, items);
    return true;
  }

  /** Cmd/Ctrl+K: wrap the selection (or word) as a link; paste a URL from the
   * clipboard into the destination when one is available. Inside an existing
   * link it unwraps it instead (back to plain text), rather than nesting a
   * second, broken link around the first.
   */
  private insertLink(view: EditorView): boolean {
    const { state } = view;
    const sel = state.selection.main;
    const existing = linkRangeAt(state, sel.from) ?? linkRangeAt(state, sel.to);
    if (existing) {
      const text = state.sliceDoc(existing.textFrom, existing.textTo);
      view.dispatch({
        changes: { from: existing.from, to: existing.to, insert: text },
        selection: { anchor: existing.from + text.length },
        userEvent: "delete",
      });
      return true;
    }
    // Empty selection: expand to the word under the caret so the whole word
    // becomes the link text (Typora-style) rather than splitting it.
    const range = sel.empty ? wordRangeAt(state, sel.from) : sel;
    const doGetUrl = this.getClipboardText;
    const apply = (url: string): void => {
      const text = state.sliceDoc(range.from, range.to);
      const inserted = `[${text}](${url})`;
      const caret =
        text.length === 0
          ? range.from + 1
          : url.length === 0
            ? range.from + inserted.length - 1
            : range.from + inserted.length;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: inserted },
        selection: { anchor: caret },
        userEvent: "input",
      });
    };
    if (doGetUrl) {
      void Promise.resolve(doGetUrl())
        .then((clip) =>
          apply(/^(https?:\/\/|mailto:|www\.)\S+$/i.test(clip.trim()) ? clip.trim() : ""),
        )
        .catch(() => apply(""));
    } else {
      apply("");
    }
    return true;
  }
}

export function createTypodown(parent: HTMLElement, options?: TypodownOptions): Typodown {
  return new Typodown(parent, options);
}

// ---- commands -------------------------------------------------------------

/** Enter starts a new paragraph. Markdown needs a blank line between two
 * paragraphs, so that's the one rule -- but how much to insert depends on
 * what's being split:
 *
 * - Inside a fenced code block, table, or raw HTML block, none of that
 *   applies: a newline there is just a newline (source code, table rows,
 *   HTML), not a paragraph break, so Enter falls through to a plain single
 *   "\n" like it would in any code editor.
 * - Splitting a single continuous Paragraph (a plain mid-line split, or a
 *   soft-wrapped line break) needs exactly one fresh blank-line separator:
 *   "foo|bar" -> "foo\n\nbar". There's nothing else to reconcile because the
 *   two halves weren't separated by anything before.
 * - Splitting at the edge of one block next to a *different* one (a fence, a
 *   heading, or another paragraph across an existing blank line) is inserting
 *   a brand new paragraph *between* two already-separate things, which needs
 *   a full blank-line separator on each of its two new edges -- reusing
 *   what's already there and topping it up to exactly one blank line,
 *   whether that was zero newlines, one, or several. Otherwise the new
 *   paragraph stays attached to whatever's on the short side once typed into
 *   (a single leftover newline is still "the same paragraph" to Markdown).
 *
 * On an already-blank line, insert a single newline instead so repeated
 * Enters don't double up on blank lines.
 */
function insertParagraph(view: EditorView): boolean {
  const { state } = view;
  if (inRawBlock(syntaxTree(state), state.selection.main.head)) {
    return insertNewline(view);
  }
  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head);
      const blank = line.text.trim() === "";
      if (blank) {
        return {
          changes: { from: range.from, to: range.to, insert: "\n" },
          range: EditorSelection.cursor(range.from + 1),
        };
      }

      const paragraph = enclosingParagraph(syntaxTree(state), range.head);
      if (paragraph && paragraph.from < range.from && paragraph.to > range.to) {
        // Consume a newline sitting exactly at the split point (splitting a
        // paragraph at one of its own internal soft-wrapped line breaks) so
        // it isn't left stacked alongside the freshly inserted one -- the
        // result is the same one blank line as a plain mid-line split.
        const before = /\n*$/.exec(state.sliceDoc(Math.max(0, range.from - 2), range.from))!;
        const from = range.from - before[0].length;
        const after = /^\n*/.exec(
          state.sliceDoc(range.to, Math.min(state.doc.length, range.to + 2)),
        )!;
        const to = range.to + after[0].length;
        return {
          changes: { from, to, insert: "\n\n" },
          range: EditorSelection.cursor(from + 2),
        };
      }

      let from =
        range.empty && range.from === line.from && line.from > 0 ? line.from - 1 : range.from;
      let to = range.empty ? from : range.to;
      const before = /\n*$/.exec(state.sliceDoc(Math.max(0, from - 8), from))!;
      from -= before[0].length;
      const after = /^\n*/.exec(state.sliceDoc(to, Math.min(state.doc.length, to + 8)))!;
      to += after[0].length;
      return {
        changes: { from, to, insert: "\n\n\n\n" },
        range: EditorSelection.cursor(from + 2),
      };
    }),
    { scrollIntoView: true, userEvent: "input" },
  );
  return true;
}

/** The nearest Paragraph node enclosing (or immediately before, at a line
 * boundary) `pos`, or null if the caret isn't inside/adjacent to one. */
function enclosingParagraph(
  tree: ReturnType<typeof syntaxTree>,
  pos: number,
): ReturnType<typeof tree.resolveInner> | null {
  const node = tree.resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "Paragraph") return n;
  }
  return null;
}

/** Whether `pos` is inside a construct with its own line semantics -- source
 * code, a table row, raw HTML -- where a newline is just a newline, not a
 * paragraph break. */
function inRawBlock(tree: ReturnType<typeof syntaxTree>, pos: number): boolean {
  const node = tree.resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (/FencedCode|CodeBlock|Table|HTMLBlock/.test(n.name)) return true;
  }
  return false;
}

/** Backtick with an active selection auto-fences the selection as inline code
 * (Typora-style). With an empty selection it falls through so the character is
 * inserted normally.
 */
const wrapBacktick: Command = (view) => {
  if (view.state.selection.ranges.every((r) => r.empty)) return false;
  return wrap("`")(view);
};

/** Typing the third backtick on a line that's just two backticks (with optional
 * leading whitespace) auto-closes the fence: the third backtick is inserted
 * along with a closing fence on a new line, and the caret lands at the
 * info-string position on the opening fence line, where typing a letter opens
 * the language autocomplete (the "language selector"). Inside a code block /
 * table / HTML block the line would be content (or a closing fence), so the
 * auto-close is skipped there. */
export const closeFenceOnThirdBacktick: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const pos = range.head;
  const line = state.doc.lineAt(pos);
  if (pos !== line.to) return false;
  if (!/^\s*``$/.test(line.text)) return false;
  if (inRawBlock(syntaxTree(state), pos)) return false;
  view.dispatch({
    changes: { from: pos, to: pos, insert: "`\n\n```" },
    selection: { anchor: pos + 1 },
    userEvent: "input",
    scrollIntoView: true,
  });
  // The language selector input is rendered by live-preview once the block
  // becomes active; focus it so the user can type or pick a language directly.
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => {
      const input = view.contentDOM?.querySelector<HTMLInputElement>(".cm-td-lang-input");
      input?.focus();
      input?.select();
    });
  }
  return true;
};

/** Toggle an emphasis marker around each selection. With no selection it inserts
 * an empty pair and places the caret between the markers.
 */
function wrap(marker: string): Command {
  const m = marker.length;
  return (view) => {
    const { state } = view;
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - m, range.from);
        const after = state.sliceDoc(range.to, range.to + m);
        if (before === marker && after === marker) {
          // Strip the surrounding markers.
          return {
            changes: [
              { from: range.from - m, to: range.from },
              { from: range.to, to: range.to + m },
            ],
            range: EditorSelection.range(range.from - m, range.to - m),
          };
        }
        const text = state.sliceDoc(range.from, range.to);
        return {
          changes: { from: range.from, to: range.to, insert: marker + text + marker },
          range: range.empty
            ? EditorSelection.cursor(range.from + m)
            : EditorSelection.range(range.from + m, range.to + m),
        };
      }),
      { userEvent: "input" },
    );
    return true;
  };
}

/** Indent (Tab) or outdent (Shift+Tab) every line the selection touches by two
 * spaces, nesting / un-nesting list items.
 */
function changeIndent(outdent: boolean): Command {
  return (view) => {
    const { state } = view;
    const lines = new Set<number>();
    for (const r of state.selection.ranges) {
      const first = state.doc.lineAt(r.from).number;
      const last = state.doc.lineAt(r.to).number;
      for (let n = first; n <= last; n++) lines.add(n);
    }
    const changes: { from: number; to?: number; insert?: string }[] = [];
    for (const n of lines) {
      const line = state.doc.line(n);
      if (outdent) {
        const match = /^(\t| {1,2})/.exec(line.text);
        if (match) changes.push({ from: line.from, to: line.from + match[0].length });
      } else {
        changes.push({ from: line.from, insert: "  " });
      }
    }
    if (changes.length === 0) return false;
    view.dispatch({ changes, userEvent: "input.indent" });
    return true;
  };
}

// Cmd/Ctrl+A inside a fenced code block selects only that block's code content;
// outside a code block it returns false so the browser's select-all runs.
const selectCodeContent: Command = (view) => {
  const { state } = view;
  const node = syntaxTree(state).resolveInner(state.selection.main.head, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "FencedCode") {
      const code = n.getChild("CodeText");
      if (!code) return false;
      view.dispatch({ selection: EditorSelection.range(code.from, code.to) });
      return true;
    }
  }
  return false;
};

// Backspace on the blank paragraph left by Enter (see insertParagraph) undoes
// it in a single press -- Enter always adds exactly one "\n\n", so Backspace
// always removes exactly that much (the two newlines ending the two lines
// right before the caret), regardless of how many blank lines already
// surrounded it. Splitting between two already-separated paragraphs, for
// instance, leaves a 3-line blank run; this drops it back to the 1 blank line
// that was there before, not down to zero. A lone blank line (no blank
// neighbor) is left for plain Backspace to remove normally.
const deleteParagraphGapBackward: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (line.length !== 0 || range.head !== line.from || line.number <= 2) return false;
  const prev = state.doc.line(line.number - 1);
  if (prev.length !== 0) return false;
  const beforePrev = state.doc.line(prev.number - 1);
  view.dispatch({ changes: { from: beforePrev.to, to: line.to }, userEvent: "delete" });
  return true;
};

// Backspace at the very start of a code block removes the block: the fences are
// dropped and the content is kept as plain text (so an empty block disappears
// entirely). Elsewhere it returns false so the normal Backspace runs.
const deleteCodeBlockAtStart: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const node = syntaxTree(state).resolveInner(range.head, -1);
  let block: typeof node | null = null;
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "FencedCode") {
      block = n;
      break;
    }
  }
  if (!block) return false;
  const doc = state.doc;
  const openLine = doc.lineAt(block.from);
  if (openLine.number >= doc.lines) return false;
  const firstContent = doc.line(openLine.number + 1);
  if (range.head !== firstContent.from) return false; // only at the block start
  const marks = block.getChildren("CodeMark");
  const changes = [{ from: openLine.from, to: firstContent.from }]; // opening fence + newline
  if (marks.length >= 2) {
    const closeLine = doc.lineAt(marks[marks.length - 1]!.from);
    changes.push({ from: closeLine.from - 1, to: closeLine.to }); // newline + closing fence
  }
  view.dispatch({ changes, selection: { anchor: openLine.from }, userEvent: "delete" });
  return true;
};

// Enter after a `> [!NOTE/TIP/...]` alert marker inserts an empty `>` separator
// line (paragraph break inside the blockquote) and a `> ` content line, landing
// the caret on the content line. The empty `>` line is visually collapsed by
// the live-preview layer, so the result reads as the alert label directly
// followed by the cursor, ready to type -- while the markdown stays canonical.
const continueAlert: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || range.head !== state.doc.lineAt(range.head).to) return false;
  const line = state.doc.lineAt(range.head);
  if (!/^(\s*)>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.test(line.text)) return false;
  const insert = "\n>\n> ";
  view.dispatch({
    changes: { from: range.head, insert },
    selection: { anchor: range.head + insert.length },
    userEvent: "input",
  });
  return true;
};

// Enter on an empty list-item / checkbox / blockquote line exits the construct
// (or dedents one level when nested) in a single press. The raw markers are
// always hidden by the live-preview layer, so on an empty marker line the
// caret sits at "the start of the line" (right after the hidden marker) which
// is the end of the line -- that's the signal to leave. CodeMirror's
// insertNewlineContinueMarkup instead continues the markup first (a second
// empty `>` line, or making a tight list non-tight) before exiting, so this
// runs before it to match Typora's one-press exit.
export const exitMarkupOnEmptyEnter: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const pos = range.head;
  const line = state.doc.lineAt(pos);
  if (pos !== line.to) return false;
  const text = line.text;
  const node = syntaxTree(state).resolveInner(pos, -1);

  // Empty blockquote line (`>`, `> `, `> > ` ...): leave the quote, or drop one
  // level when nested.
  if (/^\s*(?:> ?)+\s*$/.test(text)) {
    for (let n: typeof node | null = node; n; n = n.parent) {
      if (n.name !== "Blockquote") continue;
      let levels = 0;
      for (let i = 0; i < text.length; i++) if (text[i] === ">") levels++;
      if (levels <= 1) {
        view.dispatch({
          changes: { from: line.from, to: line.to },
          selection: { anchor: line.from },
          userEvent: "input",
        });
      } else {
        let lastGt = 0;
        for (let i = 0; i < text.length; i++) if (text[i] === ">") lastGt = i;
        view.dispatch({
          changes: { from: line.from + lastGt, to: line.to },
          selection: { anchor: line.from + lastGt },
          userEvent: "input",
        });
      }
      return true;
    }
  }

  // Empty bullet / checkbox line (`- `, `- [ ] ` ...): leave the list, or
  // dedent one level when nested by re-adding the parent item's marker.
  if (/^\s*[-+*] +(?:\[[ xX]\] +)?\s*$/.test(text)) {
    let item: typeof node | null = null;
    for (let n: typeof node | null = node; n; n = n.parent) {
      if (n.name === "ListItem") {
        item = n;
        break;
      }
    }
    if (item) {
      let parentItem: typeof node | null = null;
      for (let n: typeof node | null = item.parent; n; n = n.parent) {
        if (n.name === "ListItem") {
          parentItem = n;
          break;
        }
      }
      if (!parentItem) {
        view.dispatch({
          changes: { from: line.from, to: line.to },
          selection: { anchor: line.from },
          userEvent: "input",
        });
      } else {
        const parentLine = state.doc.lineAt(parentItem.from);
        const pm = /^(\s*)(?:[-+*]|\d+[.)]) +(?:\[[ xX]\] +)?/.exec(parentLine.text);
        const insert = pm ? pm[0] : "- ";
        view.dispatch({
          changes: { from: line.from, to: line.to, insert },
          selection: { anchor: line.from + insert.length },
          userEvent: "input",
        });
      }
      return true;
    }
  }

  return false;
};

// The atomic ranges from live-preview skip the caret over the *interior* of
// hidden markers, but the line-start boundary (position 0 of a marker line, or
// the first line which has no preceding newline to extend the range into) can
// still be reached -- by Home, a click on the bullet, or arrow motion. This
// filter clamps any empty caret that lands before the marker end to the content
// start, so it is impossible for the caret to sit left of (or inside) the
// hidden bullet / checkbox / quote marker. Selections (non-empty ranges) are
// left untouched, and doc-changing transactions are skipped (the dedicated
// commands already land the caret past the marker).
export const clampCursorPastMarker = EditorState.transactionFilter.of(
  (tr: Transaction): TransactionSpec | Transaction => {
    const sel = tr.selection;
    if (!sel || !tr.changes.empty) return tr;
    const main = sel.main;
    if (!main.empty || sel.ranges.length > 1) return tr;
    const pos = main.head;
    const state = tr.startState;
    const line = state.doc.lineAt(pos);
    const markEnd = markerEndOnLine(state, line);
    if (markEnd == null || pos >= markEnd) return tr;
    return {
      selection: EditorSelection.cursor(markEnd, main.assoc),
      effects: tr.effects,
      scrollIntoView: tr.scrollIntoView,
    };
  },
);

// Left from the content start of a bullet / checkbox / quote line exits to the
// previous line's end. Without this, the transaction filter would clamp the
// caret back to the content start (Left into the hidden marker is a no-op),
// so there'd be no way to leave a marker line to the left. This gives a
// single predictable exit: at the content start, one Left jumps to the
// previous line (mirroring how Right from the previous line's end is clamped
// straight to the content start). At any other position the default Left runs.
export const arrowLeftPastMarker: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const pos = range.head;
  const line = state.doc.lineAt(pos);
  const markEnd = markerEndOnLine(state, line);
  if (markEnd == null || pos !== markEnd) return false;
  if (line.from === 0) return false; // first line, nothing to the left
  const prev = state.doc.lineAt(line.from - 1);
  view.dispatch({
    selection: { anchor: prev.to },
    userEvent: "select",
  });
  return true;
};

// ---- helpers --------------------------------------------------------------

/** Map a document offset through a full-document replacement using the longest
 * common prefix and suffix between the old and new texts, so the offset lands
 * at the same logical spot. Offsets inside the changed region clamp to the end
 * of the common prefix. Used by `setValue` to keep the caret where the user
 * left it instead of letting CodeMirror drop it at position 0. */
export function mapPosThroughReplacement(oldDoc: string, newDoc: string, pos: number): number {
  const minLen = Math.min(oldDoc.length, newDoc.length);
  let prefix = 0;
  while (prefix < minLen && oldDoc[prefix] === newDoc[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldDoc[oldDoc.length - 1 - suffix] === newDoc[newDoc.length - 1 - suffix]
  ) {
    suffix++;
  }
  if (pos <= prefix) return pos;
  if (pos >= oldDoc.length - suffix) return pos + (newDoc.length - oldDoc.length);
  return prefix;
}

/** Expand an empty selection at `pos` to the run of word characters it sits in.
 * If the caret is not on a word character, returns an empty range at `pos`. */
function wordRangeAt(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  let from = pos;
  while (from > line.from && /\w/.test(state.sliceDoc(from - 1, from))) from--;
  let to = pos;
  while (to < line.to && /\w/.test(state.sliceDoc(to, to + 1))) to++;
  return { from, to };
}

/** The URL of a Link / autolink whose source range contains `pos`, or null. */
function linkUrlAt(state: EditorState, pos: number): string | null {
  let url: string | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === "URL") {
        url = state.sliceDoc(node.from, node.to);
      } else if (node.name === "Link" || node.name === "Autolink") {
        const child = node.node.getChild("URL");
        if (child) url = state.sliceDoc(child.from, child.to);
      }
    },
  });
  return url;
}

/** The full range of a bracketed `[text](url)` Link whose source range
 * contains `pos`, plus the range of its display text (between the brackets),
 * or null. Autolinks (`<url>`) have no separate display text to unwrap to, so
 * they are not matched here. Returns null when `pos` is on an Image inside the
 * Link, so a link wrapping an image (e.g. a badge) is not unwrapped when the
 * caret lands on the image. */
function linkRangeAt(
  state: EditorState,
  pos: number,
): { from: number; to: number; textFrom: number; textTo: number } | null {
  // If the caret is directly inside an Image, don't match the enclosing Link:
  // the image is the link's content, not something to unwrap on Cmd+K.
  const resolved = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof resolved | null = resolved; n; n = n.parent) {
    if (n.name === "Image") return null;
  }
  let result: { from: number; to: number; textFrom: number; textTo: number } | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name !== "Link") return;
      const marks = node.node.getChildren("LinkMark");
      if (marks.length >= 2) {
        result = { from: node.from, to: node.to, textFrom: marks[0]!.to, textTo: marks[1]!.from };
      }
    },
  });
  return result;
}

/** Language autocomplete on a fenced code block's info string. Picking a
 * language also closes the block (adds the matching closing fence and drops the
 * caret inside) when it is still open, so typing ```lang gives you a ready block. */
function languageCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const fence = /^(\s*)(```+|~~~+)([A-Za-z0-9#+._-]*)$/.exec(line.text);
  if (!fence) return null;
  // Only when the caret is within the info string on the opening fence line.
  const infoFrom = line.from + fence[1]!.length + fence[2]!.length;
  if (context.pos < infoFrom || context.pos > line.to) return null;
  if (!isOpeningFence(context.state.doc, line.number)) return null;
  const marker = fence[2]!;
  const query = line.text.slice(fence[1]!.length + marker.length).trim();
  const options = matchLanguages(query, 12).map((label) => ({
    label,
    type: "keyword",
    apply: (view: EditorView, _c: unknown, from: number, to: number) => {
      if (blockIsClosed(view.state, line.number)) {
        view.dispatch({
          changes: { from, to, insert: label },
          selection: { anchor: from + label.length },
        });
      } else {
        // Add the closing fence and land the caret on the empty line inside.
        const insert = `${label}\n\n${marker}`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + label.length + 1 },
          userEvent: "input.complete",
        });
      }
    },
  }));
  if (options.length === 0) return null;
  return { from: infoFrom, to: line.to, options, filter: false };
}

/** Alert-kind autocomplete inside a blockquote's `[!...]` marker, e.g. typing
 * `> [!CAU` suggests CAUTION, the GFM alert kinds live-preview.ts renders
 * specially (note/tip/important/warning/caution). */
function alertCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /^(\s*>\s?)\[!([A-Za-z]*)$/.exec(before);
  if (!match) return null;
  const from = line.from + match[1]!.length + 2;
  const query = match[2]!.toUpperCase();
  const options = ALERT_KINDS.map((kind) => kind.toUpperCase())
    .filter((label) => label.startsWith(query))
    .map((label) => ({ label, type: "keyword", apply: `${label}]` }));
  if (options.length === 0) return null;
  return { from, to: context.pos, options, filter: false };
}

/** Whether the fenced code block opened on `lineNumber` already has a closing fence. */
function blockIsClosed(state: EditorState, lineNumber: number): boolean {
  const node = syntaxTree(state).resolveInner(state.doc.line(lineNumber).from, 1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "FencedCode") return n.getChildren("CodeMark").length >= 2;
  }
  return false;
}

/** A fence line opens a block when an odd number of fence lines precede it. */
function isOpeningFence(doc: Text, lineNumber: number): boolean {
  let fences = 0;
  for (let n = 1; n < lineNumber; n++) {
    if (/^\s*(```+|~~~+)/.test(doc.line(n).text)) fences++;
  }
  return fences % 2 === 0;
}

/** The markdown language for the editor: CommonMark + GitHub Flavored Markdown
 * (tables, task lists, strikethrough, autolinks).
 *
 * This gives CodeMirror an incrementally-updated Lezer syntax tree that the live-preview decorations walk.
 */
export function typodownMarkdown(): Extension {
  return markdown({
    base: markdownLanguage,
    extensions: [GFM, MathExtension],
    // We provide our own shortcuts and completions.
    addKeymap: false,
    completeHTMLTags: false,
  });
}
