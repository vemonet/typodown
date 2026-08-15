// Typodown editor.
//
// A Typora-style live-preview Markdown editor built on CodeMirror 6. The plain
// Markdown text is the single source of truth: CodeMirror owns the caret,
// selection, history, clipboard and viewport virtualisation, while a
// decoration layer (see live-preview.ts) styles the rendered result and hides
// the raw syntax except on the construct under the caret.

import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type Text,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
  type Command,
  type ViewUpdate,
} from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, insertNewline } from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  acceptCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { search } from "@codemirror/search";
import { defaultHighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import {
  insertNewlineContinueMarkup,
  deleteMarkupBackward,
  markdown,
  markdownLanguage,
} from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreview, ALERT_KINDS, markerEndOnLine } from "./live-preview.ts";
import { openInsertTableDialog, insertTable } from "./menu.ts";
import { createOutline, scrollToLine as scrollViewToLine, type OutlineHandle } from "./outline.ts";
import { createPrefs } from "./prefs.ts";
import { Math as MathExtension } from "./math.ts";
import { matchLanguages } from "./highlight.ts";
import { loadEmojiIndex, searchEmoji } from "./emoji.ts";
import { createSearch, searchHighlighter, type SearchHandle } from "./search.ts";
import { htmlToMarkdown } from "./clipboard.ts";
import {
  createToolbar,
  defaultToolbarActions,
  type ToolbarHandle,
  type ToolbarMode,
} from "./toolbar.ts";

/** Themes bundled with Typodown. `light` and `dark` are the GitHub themes. */
export type BuiltInTheme =
  | "auto"
  | "light"
  | "dark"
  | "dracula"
  | "nord"
  | "solarized-light"
  | "solarized-dark";

/** A bundled theme name, or a custom name styled through `data-td-theme`. */
export type Theme = BuiltInTheme | (string & Record<never, never>);

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
   * Read the clipboard for the Ctrl/⌘+K link shortcut and plain paste. Defaults
   * to `navigator.clipboard.readText()`, which works in browsers but is blocked
   * in some embedders (e.g. VS Code webviews); provide this to read it from the
   * host instead.
   */
  getClipboardText?: () => string | Promise<string>;
  /**
   * Open a link's URL when it is Ctrl/⌘-clicked. Defaults to
   * `window.open(url, "_blank")`, which works in browsers but not in some
   * embedders (e.g. a Tauri webview, where it must go through the host's opener
   * plugin to reach the system browser); provide this to route it to the host.
   */
  openLink?: (url: string) => void;
  /** Resolve image destinations before rendering them. Useful for hosts that
   * need to translate paths relative to the open Markdown document. */
  resolveImageSrc?: (src: string) => string;
  /** Called whenever the content changes. */
  onChange?: (value: string) => void;
  /** Render raw HTML blocks/tags as live widgets. Defaults to true. */
  html?: boolean;
  /**
   * Show a Save action at the end of the formatting toolbar, invoked when the
   * user taps it. Hosts that prefer an explicit save (e.g. a mobile app that
   * disables auto-save to avoid churning cloud conflict copies) pass a callback
   * here; hosts that auto-save on every change leave it unset and the button is
   * omitted. The button does not refocus the editor, so a soft keyboard stays
   * open on touch devices.
   */
  save?: {
    /** Perform the save when the toolbar Save button is tapped. */
    run: () => void;
    /** Returns whether there are unsaved changes; the toolbar greys the
     * button out while this is false. */
    isDirty?: () => boolean;
  };
  /**
   * Visibility of the floating formatting toolbar (bold, italic, ..., add
   * table) pinned to the top of the editor.
   * - "shown" (default): starts visible everywhere.
   * - "auto": starts visible on small screens, hidden on large ones.
   * - "hidden": starts hidden everywhere.
   * Whatever the mode, a small floating button in the top-left margin lets the
   * user show / hide it.
   */
  toolbar?: ToolbarMode;
  /**
   * Show the document outline: a right-docked panel listing the headings, with
   * a toggle button in the top-right margin. The panel starts collapsed.
   * Defaults to true; set to false to drop the button and panel entirely.
   */
  outline?: boolean;
  /**
   * Remember UI preferences across reloads: whether the formatting toolbar is
   * expanded and whether the outline panel is open, saved to localStorage. Pass
   * a string to use it as the storage key (namespacing several editors); `true`
   * uses "typodown". Defaults to false (no persistence). The theme is host-owned
   * and not persisted here.
   */
  persist?: boolean | string;
}

/** A Typora-style live-preview Markdown editor built on CodeMirror 6. */
export class Typodown {
  readonly wrapper: HTMLElement;
  private readonly view: EditorView;
  private readonly getClipboardText?: () => string | Promise<string>;
  private readonly openLink?: (url: string) => void;
  private readonly toolbar: ToolbarHandle;
  private readonly outline?: OutlineHandle;
  private readonly search: SearchHandle;
  private readonly preview = new Compartment();
  private readonly html: boolean;
  private readonly resolveImageSrc?: (src: string) => string;
  private rawMarkdown = false;
  /** Where the last pointer press landed, and where that document position sat
   * on screen before the press was handled. See `anchorPointer`. */
  private clickAnchor: { pos: number; top: number } | null = null;

  constructor(parent: HTMLElement, options: TypodownOptions = {}) {
    this.getClipboardText = options.getClipboardText;
    this.openLink = options.openLink;
    this.html = options.html ?? true;
    this.resolveImageSrc = options.resolveImageSrc;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "typodown";
    this.setTheme(options.theme ?? "auto");
    parent.appendChild(this.wrapper);

    const extensions: Extension[] = [
      typodownMarkdown(),
      this.preview.of([
        livePreview({ html: this.html, resolveImageSrc: this.resolveImageSrc }),
        clampCursorPastMarker,
      ]),
      history(),
      // Match highlighting + find/replace commands. The built-in bottom-docked
      // panel is never opened; our floating panel (search.ts) drives this state
      // and Mod-f (below) opens it, so the package's searchKeymap is left out.
      // `search()` provides the query state + find/replace commands; its own
      // match highlighter only paints when its built-in panel is open, so
      // `searchHighlighter` (ours) does the highlighting for our floating panel.
      search(),
      searchHighlighter,
      EditorView.lineWrapping,
      EditorView.clipboardInputFilter.of((text) => normalizeQuoteMarkerSpaces(text)),
      EditorView.inputHandler.of((view, from, to, text) => {
        const line = view.state.doc.lineAt(from);
        const before = view.state.sliceDoc(line.from, from);
        const normalized = normalizeQuoteMarkerSpaces(before + text).slice(before.length);
        if (normalized === text) return false;
        view.dispatch({
          changes: { from, to, insert: normalized },
          selection: { anchor: from + normalized.length },
          userEvent: "input",
        });
        return true;
      }),
      autocompletion({
        override: [languageCompletions, alertCompletions, frontMatterCompletions, emojiCompletions],
        icons: false,
      }),
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
        { key: "`", run: (v) => !this.rawMarkdown && closeFenceOnThirdBacktick(v) },
        { key: "`", run: (v) => !this.rawMarkdown && wrapBacktick(v) },
        { key: "Mod-k", run: (v) => this.insertLink(v) },
        { key: "Mod-/", run: () => this.toggleRawMarkdown() },
        {
          key: "Mod-f",
          run: () => {
            this.search.open();
            return true;
          },
        },
        { key: "Mod-Shift-x", run: toggleTaskList },
        { key: "Mod-Shift-t", run: openTableDialog },
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
            !this.rawMarkdown &&
            (continueAlert(v) ||
              exitMarkupOnEmptyEnter(v) ||
              continueMarkup(v) ||
              insertParagraph(v)),
          shift: insertNewline,
        },
        {
          key: "Backspace",
          run: (v) =>
            !this.rawMarkdown &&
            (deleteCodeBlockAtStart(v) || deleteParagraphGapBackward(v) || deleteMarkupBackward(v)),
        },
        // At the content start of a bullet/checkbox/quote line, Left exits to
        // the previous line (runs before the default cursorCharLeft).
        { key: "ArrowLeft", run: (v) => !this.rawMarkdown && arrowLeftPastMarker(v) },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      // Mobile soft keyboards (notably Android's Gboard) route text input
      // through "beforeinput" / composition events with inputType
      // "insertText" rather than real keydown events, so the keymap binding
      // for "`" above never fires there. Intercept a single-backtick insert
      // here and reuse the same auto-close command: at beforeinput time the
      // backtick hasn't been applied yet, so the command's "state is still
      // ````" check still holds. Returning true suppresses the default
      // insertion (the command inserted the backtick itself, plus the
      // closing fence). Desktop keyboards keep using the keymap path.
      EditorView.inputHandler.of((view, from, to, text) => {
        if (this.rawMarkdown || text !== "`" || from !== to) return false;
        return closeFenceOnThirdBacktick(view);
      }),
      EditorView.domEventHandlers({
        paste: (event, view) => this.handlePaste(event, view),
        mousedown: (event, view) => this.handleMouseDown(event, view),
        pointerdown: (event, view) => this.anchorPointer(event, view),
      }),
      EditorView.updateListener.of((u) => this.reanchorClick(u)),
      // Ctrl/⌘+A: select the code content when inside a code block. Handled at
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
            // The shortcuts the editor owns (Ctrl/⌘+B, +I, +K, +Shift+X/T/V)
            // must not also fire the host's command for the same chord -- in the
            // VS Code webview, Cmd+B would otherwise toggle the side bar. The
            // keymap below still runs our command; stopping propagation here
            // keeps the event from bubbling out of the editor to the host's
            // keybinding listener (same trick as the Cmd+A case above). We only
            // swallow chords we actually bind, so other host shortcuts are left
            // alone. Returns false so the keymap handler still gets the event.
            if (isOwnedModShortcut(event)) event.stopPropagation();
            return false;
          },
        }),
      ),
    ];
    if (options.placeholder) extensions.push(placeholderExt(options.placeholder));
    const outlineEnabled = options.outline !== false;
    if (outlineEnabled) {
      // Keep the outline list in sync with the document. `this.outline` is
      // assigned right after the view is created, before any transaction can
      // fire this listener.
      extensions.push(
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.outline?.refresh();
        }),
      );
    }
    if (options.onChange) {
      const onChange = options.onChange;
      extensions.push(
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      );
    }
    // Refresh the toolbar's stateful buttons (Save's dirty flag, undo / redo
    // depth) after the onChange listener, so the host's dirty state has been
    // updated first, and keep the search panel's match counter accurate: the
    // doc changes on every edit, including the panel's own Replace / Replace
    // all. Both handles are assigned right after the view is created, before
    // any transaction can fire this listener.
    extensions.push(
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        this.toolbar?.refresh();
        this.search?.refresh();
      }),
    );

    this.view = new EditorView({
      state: EditorState.create({
        doc: normalizeQuoteMarkerSpaces(options.value ?? ""),
        extensions,
      }),
      parent: this.wrapper,
    });
    const prefs = options.persist
      ? createPrefs(options.persist === true ? "typodown" : options.persist)
      : undefined;
    this.search = createSearch(this.wrapper, this.view);
    this.toolbar = createToolbar(this.wrapper, this.view, {
      mode: options.toolbar ?? "shown",
      actions: defaultToolbarActions({
        wrapMarker: (marker) => (view) => void wrap(marker)(view),
        insertLink: (view) => void this.insertLink(view),
        toggleTask: (view) => void toggleTaskList(view),
        openTable: (view) => void openTableDialog(view),
      }),
      prefs,
      save: options.save,
      openSearch: () => this.search.toggle(),
      rawMarkdown: {
        toggle: () => void this.toggleRawMarkdown(),
        isRaw: () => this.rawMarkdown,
      },
      // `this.outline` is created just below; resolved lazily at click time.
      toggleOutline: outlineEnabled ? () => this.outline?.toggle() : undefined,
    });
    if (outlineEnabled) this.outline = createOutline(this.wrapper, this.view, prefs);
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
    const nextValue = normalizeQuoteMarkerSpaces(value);
    if (oldDoc === nextValue) return;
    // Map the existing selection through the host-provided document update so the
    // caret stays where the user left it. Without this, CodeMirror's default
    // mapping drops the caret at position 0 (the start of the inserted text)
    // every time the host pushes an update -- e.g. VS Code's "format on save"
    // / "trim trailing whitespace on save" modifying the document -- yanking it
    // to the top of the file. The dispatched edit itself is reduced to its
    // changed middle so CodeMirror can also preserve the current viewport.
    // See `mapPosThroughReplacement` for the selection mapping.
    const ranges = state.selection.ranges.map((r) =>
      EditorSelection.range(
        mapPosThroughReplacement(oldDoc, nextValue, r.from),
        mapPosThroughReplacement(oldDoc, nextValue, r.to),
      ),
    );
    const minLen = Math.min(oldDoc.length, nextValue.length);
    let from = 0;
    while (from < minLen && oldDoc[from] === nextValue[from]) from++;
    let suffix = 0;
    while (
      suffix < minLen - from &&
      oldDoc[oldDoc.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
    ) {
      suffix++;
    }
    this.view.dispatch({
      changes: {
        from,
        to: oldDoc.length - suffix,
        insert: nextValue.slice(from, nextValue.length - suffix),
      },
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

  /** Rebuild rendered widgets whose host-provided URL resolution context may
   * have changed without a Markdown edit, for example after switching files. */
  refreshPreview(): void {
    if (this.rawMarkdown) return;
    this.view.dispatch({
      effects: this.preview.reconfigure([
        livePreview({ html: this.html, resolveImageSrc: this.resolveImageSrc }),
        clampCursorPastMarker,
      ]),
    });
  }

  /** Switch between rendered live preview and plain Markdown source. Raw mode
   * keeps CodeMirror's Markdown parser, syntax highlighting, and diagnostics. */
  setRawMarkdown(raw: boolean): void {
    if (raw === this.rawMarkdown) return;
    this.rawMarkdown = raw;
    this.wrapper.toggleAttribute("data-td-raw", raw);
    // Keep the toolbar's raw-mode button pressed state in sync when the mode is
    // toggled from the keyboard or by the host rather than by the button.
    this.toolbar?.refresh();
    this.view.dispatch({
      effects: this.preview.reconfigure(
        raw
          ? syntaxHighlighting(defaultHighlightStyle)
          : [
              livePreview({ html: this.html, resolveImageSrc: this.resolveImageSrc }),
              clampCursorPastMarker,
            ],
      ),
    });
  }

  /** Toggle raw Markdown source mode. Returns true for CodeMirror commands. */
  toggleRawMarkdown(): true {
    this.setRawMarkdown(!this.rawMarkdown);
    return true;
  }

  isRawMarkdown(): boolean {
    return this.rawMarkdown;
  }

  /** Scroll the viewport so the start of `line` (1-indexed) is near the top, without
   * moving the caret. Used by hosts that show a clickable outline of the
   * document's headings. Out-of-range lines clamp to the first / last line. */
  scrollToLine(line: number): void {
    scrollViewToLine(this.view, line);
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.toolbar.destroy();
    this.outline?.destroy();
    this.search.destroy();
    this.view.destroy();
    this.wrapper.remove();
  }

  // ---- clipboard ----------------------------------------------------------

  private handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    if (this.rawMarkdown) return false;
    // Code is plain text by definition. Let CodeMirror use the clipboard's
    // text/plain payload directly instead of converting rich HTML to Markdown
    // (which would add emphasis, link, list, or fence markers to the code).
    if (selectionInCodeBlock(view.state)) return false;
    const html = event.clipboardData?.getData("text/html") ?? "";
    const plain = event.clipboardData?.getData("text/plain") ?? "";
    // No HTML: let CodeMirror insert the plain text itself, but if the caret is
    // in a blockquote/callout we still need to repeat the `>` prefix, so take
    // over the paste when the plain text is multi-line inside a quote.
    if (!html) {
      const quoted = quoteMultilinePaste(view.state, plain);
      if (quoted === plain) return false;
      event.preventDefault();
      view.dispatch(view.state.replaceSelection(quoted), {
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      return true;
    }
    const md = htmlToMarkdown(html);
    if (!md) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(quoteMultilinePaste(view.state, md)), {
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
        if (text)
          view.dispatch(view.state.replaceSelection(quoteMultilinePaste(view.state, text)), {
            userEvent: "input.paste",
          });
      })
      .catch(() => {
        // Clipboard unavailable: nothing to paste.
      });
    return true;
  }

  /** Records where the pressed spot sits on screen, so `reanchorClick` can put
   * it back there.
   *
   * Live preview reveals a construct's raw syntax when the caret enters it and
   * re-hides the one the caret left, and either can add or remove whole lines:
   * the ``` fences of a code block, the --- of the front matter, the blank line
   * separating two paragraphs (hidden as `cm-td-blank-sep`, a full line tall
   * once the caret is on it). When that happens *above* the press, the caret
   * lands on the right document position, but the text around it has already
   * moved up or down by a line or two -- so the caret shows up somewhere other
   * than where the click was, typically up and to the left, since a line that
   * re-wraps also throws its tail onto another row.
   *
   * The position itself is resolved against the layout the user was looking at,
   * so it is the one they aimed at; only the viewport ends up stale.
   *
   * `pointerdown` (not `mousedown`) so touch on the phone app is covered too,
   * and it fires while the old layout is still in place, which is the only
   * moment `top` can be read. Returns false: this only observes the press. */
  private anchorPointer(event: PointerEvent, view: EditorView): false {
    this.clickAnchor = null;
    if (event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const top = pos == null ? null : view.coordsAtPos(pos)?.top;
    if (pos != null && top != null) this.clickAnchor = { pos, top };
    return false;
  }

  /** Takes up whatever the press moved the pressed spot by, holding the
   * viewport still instead of letting the text slide out from under the
   * pointer.
   *
   * This runs from the selection update rather than straight from
   * `anchorPointer`: CodeMirror moves the selection on `mousedown`, which is
   * after `pointerdown`, and a measure cycle can be flushed in between -- a
   * measure requested during the press would read the layout before the reveal
   * and see nothing to correct. */
  private reanchorClick(update: ViewUpdate): void {
    const anchor = this.clickAnchor;
    if (!anchor || !update.transactions.some((tr) => tr.isUserEvent("select.pointer"))) return;
    this.clickAnchor = null;
    pin(update.view, anchor.pos, anchor.top, 3);
  }

  /** Ctrl/⌘-click a link to open it; a plain click just places the caret. */
  private handleMouseDown(event: MouseEvent, view: EditorView): void {
    if (!(event.metaKey || event.ctrlKey)) return;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return;
    const url = linkUrlAt(view.state, pos);
    if (url) {
      event.preventDefault();
      if (this.openLink) this.openLink(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  /** Ctrl/⌘+K: wrap the selection (or word) as a link; paste a URL from the
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

/** Create a new `Typodown` instance at given element. */
export function createTypodown(parent: HTMLElement, options?: TypodownOptions): Typodown {
  return new Typodown(parent, options);
}

/** The largest relayout a click is allowed to compensate for, in pixels. A
 * reveal adds at most a few lines (front matter delimiters, a pair of code
 * fences, a blank separator); anything bigger was not caused by the reveal, so
 * leave the scroll position alone. */
const MAX_ANCHOR_SHIFT = 200;

/** Hold `pos` at `top` in the viewport for the next few measure cycles.
 *
 * One pass is not enough: correcting the scroll position brings lines that were
 * only height-estimated into view, and measuring them for real shifts the
 * content again. Each pass re-reads the position and takes up whatever is
 * left, stopping as soon as nothing moved (or after `tries`, so a layout that
 * refuses to settle cannot spin). */
function pin(view: EditorView, pos: number, top: number, tries: number): void {
  view.requestMeasure({
    // Runs after the selection change has been rendered, so this reads the
    // revealed layout.
    read: () => view.coordsAtPos(pos)?.top,
    write: (after) => {
      if (after == null) return;
      const shift = after - top;
      if (Math.abs(shift) < 1 || Math.abs(shift) > MAX_ANCHOR_SHIFT) return;
      takeUpSlack(view.scrollDOM, shift);
      if (tries > 1) pin(view, pos, top, tries - 1);
    },
  });
}

/** Scroll `shift` pixels away, starting at the editor's own scroller and
 * walking up to the page. Which element scrolls depends on the host: the app
 * gives the editor a fixed height so `cm-scroller` scrolls, while the website
 * and the VS Code webview let it grow and scroll the page instead. Each
 * ancestor absorbs what it can (it may already be at an end) and passes the
 * rest up. Exported for the tests. */
export function takeUpSlack(from: HTMLElement, shift: number): void {
  let left = shift;
  for (let el: HTMLElement | null = from; el && Math.abs(left) >= 1; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const before = el.scrollTop;
    el.scrollTop = before + left;
    left -= el.scrollTop - before;
  }
}

/** Whether a keydown matches one of the Mod-based shortcuts the editor binds
 * (Bold, Italic, Link, Find, raw Markdown, Checkbox, Add table, plain paste). Used to stop those
 * chords from also triggering the host's own command (e.g. Cmd+B toggling the
 * VS Code side bar). Keep in sync with the keymap above. */
function isOwnedModShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (!event.shiftKey)
    return key === "b" || key === "i" || key === "k" || key === "f" || key === "/";
  return key === "x" || key === "t" || key === "v";
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
export function insertParagraph(view: EditorView): boolean {
  const { state } = view;
  if (inRawBlock(state, state.selection.main.head)) {
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
 * code, a table row, raw HTML, or YAML front matter -- where a newline is just
 * a newline, not a paragraph break. */
function inRawBlock(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (/FencedCode|CodeBlock|Table|HTMLBlock/.test(n.name)) return true;
  }
  // Front matter has no dedicated syntax node (Lezer parses `---` as
  // HorizontalRule / SetextHeading), so detect it by line scanning: a
  // newline inside the YAML block is just a newline, like in a code block.
  const fm = frontMatterBounds(state);
  if (fm) {
    const doc = state.doc;
    const fmFrom = doc.line(fm.openLine).from;
    const fmTo = doc.line(fm.closeLine).to;
    if (pos > fmFrom && pos < fmTo) return true;
  }
  return false;
}

/** Whether the main selection is fully contained in one code block. */
export function selectionInCodeBlock(state: EditorState): boolean {
  const { from, to } = state.selection.main;
  const blockAt = (pos: number) => {
    const node = syntaxTree(state).resolveInner(pos, -1);
    for (let n: typeof node | null = node; n; n = n.parent) {
      if (n.name === "FencedCode" || n.name === "CodeBlock") return n;
    }
    return null;
  };
  const start = blockAt(from);
  if (!start) return false;
  const end = blockAt(to);
  return end?.from === start.from && end.to === start.to;
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
  if (inRawBlock(state, pos)) return false;
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
 * an empty pair and places the caret between the markers. When the caret (or
 * selection) is already inside a construct of the same kind, it toggles it off
 * by stripping the surrounding marks -- mirroring the Cmd+K link unwrap.
 */
export function wrap(marker: string): Command {
  const m = marker.length;
  return (view) => {
    const { state } = view;
    view.dispatch(
      state.changeByRange((range) => {
        const marks = emphasisMarksAt(state, range.from, range.to, marker);
        if (marks) {
          const openLen = marks.openTo - marks.openFrom;
          const closeLen = marks.closeTo - marks.closeFrom;
          // Map a position through the two mark deletions so the caret / selection
          // lands at the same logical spot in the unwrapped text.
          const mapPos = (p: number): number => {
            if (p <= marks.openFrom) return p;
            if (p <= marks.openTo) return marks.openFrom;
            if (p <= marks.closeFrom) return p - openLen;
            if (p <= marks.closeTo) return marks.closeFrom - openLen;
            return p - openLen - closeLen;
          };
          return {
            changes: [
              { from: marks.openFrom, to: marks.openTo },
              { from: marks.closeFrom, to: marks.closeTo },
            ],
            range: range.empty
              ? EditorSelection.cursor(mapPos(range.head))
              : EditorSelection.range(mapPos(range.from), mapPos(range.to)),
          };
        }
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
        // With an active selection, wrap it. With an empty selection, expand to
        // the word under the caret and wrap that whole word (Typora-style,
        // mirroring the Cmd+K link behavior) rather than splitting it; if the
        // caret is not on a word, fall back to an empty pair with the caret
        // between the markers.
        const target = range.empty ? wordRangeAt(state, range.head) : range;
        const text = state.sliceDoc(target.from, target.to);
        return {
          changes: { from: target.from, to: target.to, insert: marker + text + marker },
          range:
            text.length === 0
              ? EditorSelection.cursor(target.from + m)
              : EditorSelection.range(target.from + m, target.to + m),
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
    // Map the selection through the changes with forward association (+1), so
    // the caret rides along after the freshly inserted spaces instead of being
    // reported at the pre-insertion column (CodeMirror's default Simple
    // mapping returns the original position when text is inserted exactly at
    // the caret, so the text would slide right while the caret stayed put).
    // For outdent (a pure deletion before the caret) the assoc is ignored --
    // `mapPos` resolves to the new line start either way.
    const changeSet = state.changes(changes);
    view.dispatch({
      changes,
      selection: EditorSelection.create(
        state.selection.ranges.map((r) => r.map(changeSet, 1)),
        state.selection.mainIndex,
      ),
      userEvent: "input.indent",
    });
    return true;
  };
}

// Any list prefix (bullet or ordered marker, plus an optional task checkbox)
// after the leading indent, e.g. `- `, `* `, `1. `, `- [ ] `, `- [x] `.
const LIST_MARKER = /^\s*(?:[-+*]|\d+[.)]) +(?:\[[ xX]\] +)?/;
// A GFM task-list item: a bullet marker followed by a `[ ]` / `[x]` checkbox.
const TASK_ITEM = /^\s*[-+*] +\[[ xX]\] +/;

/** The single prefix edit (offsets relative to the line start) that toggles one
 * line's task-list state. `off` strips an existing checkbox line back to plain
 * text; otherwise the line becomes a `- [ ] ` task item, replacing any existing
 * bullet / ordered marker while keeping the leading indent and the content. */
export function taskListLineEdit(
  text: string,
  off: boolean,
): { from: number; to: number; insert: string } {
  const indent = /^\s*/.exec(text)![0].length;
  const marker = LIST_MARKER.exec(text);
  const to = marker ? marker[0].length : indent;
  return { from: indent, to, insert: off ? "" : "- [ ] " };
}

/** Toggle every line the selection touches into a GFM task-list item (`- [ ] `),
 * or, when they are all already checkbox lines, back to plain text. Bound to the
 * toolbar's checkbox button and Ctrl/⌘+Shift+X (the X of `[x]`). */
export const toggleTaskList: Command = (view) => {
  const { state } = view;
  const nums = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) nums.add(n);
  }
  const lines = [...nums].sort((a, b) => a - b).map((n) => state.doc.line(n));
  // Toggle off only when every touched line is already a checkbox line.
  const off = lines.every((l) => TASK_ITEM.test(l.text));
  const changes = lines.map((line) => {
    const edit = taskListLineEdit(line.text, off);
    return { from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert };
  });
  view.dispatch({ changes, userEvent: "input" });
  return true;
};

/** Open the insert-table dialog anchored at the caret. Bound to the toolbar's
 * table button and Ctrl/⌘+Shift+T. */
export const openTableDialog: Command = (view) => {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  const x = coords ? coords.left : window.innerWidth / 2;
  const y = coords ? coords.bottom + 4 : window.innerHeight / 3;
  openInsertTableDialog({ x, y }, view, (rows, cols) => insertTable(view, rows, cols));
  return true;
};

// Ctrl/⌘+A inside a fenced code block selects only that block's code content;
// outside a code block it returns false so the browser's select-all runs.
export const selectCodeContent: Command = (view) => {
  const { state } = view;
  const node = syntaxTree(state).resolveInner(state.selection.main.head, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "FencedCode") {
      const code = n.getChildren("CodeText");
      const first = code[0];
      const last = code[code.length - 1];
      if (!first || !last) return false;
      view.dispatch({ selection: EditorSelection.range(first.from, last.to) });
      return true;
    }
  }
  return false;
};

/** Backspace on the blank paragraph left by Enter (see insertParagraph) undoes
 * it in a single press. Enter always adds exactly one "\n\n", so Backspace
 * always removes exactly that much (the two newlines ending the two lines
 * right before the caret), regardless of how many blank lines already
 * surrounded it. Splitting between two already-separated paragraphs, for
 * instance, leaves a 3-line blank run; this drops it back to the 1 blank line
 * that was there before, not down to zero. A lone blank line (no blank
 * neighbor) is left for plain Backspace to remove normally.
 */
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

/** When the caret sits inside a blockquote or callout, a multi-line paste must
 * repeat the leading `>` prefix on every new line, otherwise only the first
 * pasted line stays in the block (it lands on the already-prefixed line) and
 * the rest break out of the quote. Empty lines keep the bare `>` marker so the
 * markdown stays canonical. Returns the text unchanged when there is nothing to
 * continue (single line, or caret not in a quote).
 */
export function quoteMultilinePaste(state: EditorState, text: string): string {
  if (!text.includes("\n")) return text;
  const line = state.doc.lineAt(state.selection.main.from);
  const prefix = /^(\s*(?:> ?)+)/.exec(line.text)?.[1];
  if (!prefix) return text;
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? l : `${prefix}${l}`.trimEnd()))
    .join("\n");
}

/** Enter after a `> [!NOTE/TIP/...]` alert marker inserts an empty `>` separator
 * line (paragraph break inside the blockquote) and a `> ` content line, landing
 * the caret on the content line. The empty `>` line is visually collapsed by
 * the live-preview layer, so the result reads as the alert label directly
 * followed by the cursor, ready to type -- while the markdown stays canonical.
 */
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

/** Enter on an empty list-item / checkbox / blockquote line exits the construct
 * (or dedents one level when nested) in a single press. The raw markers are
 * always hidden by the live-preview layer, so on an empty marker line the
 * caret sits at "the start of the line" (right after the hidden marker) which
 * is the end of the line -- that's the signal to leave. CodeMirror's
 * insertNewlineContinueMarkup instead continues the markup first (a second
 * empty `>` line, or making a tight list non-tight) before exiting, so this
 * runs before it to match Typora's one-press exit.
 */
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

/** Continue Markdown markup and repair the empty task left above the caret when
 * Enter splits a task at the start of its text. The upstream command emits
 * `- [ ]` without the separator required for it to remain a parsed task. */
export const continueMarkup: Command = (view) => {
  if (!insertNewlineContinueMarkup(view)) return false;
  const doc = view.state.doc;
  const current = doc.lineAt(view.state.selection.main.head);
  const candidates = current.from > 0 ? [doc.lineAt(current.from - 1), current] : [current];
  const emptyTask = candidates.find((line) => /^\s*[-+*] +\[[ xX]\]$/.test(line.text));
  if (emptyTask) view.dispatch({ changes: { from: emptyTask.to, insert: " " } });
  return true;
};

/** The atomic ranges from live-preview skip the caret over the *interior* of
 * hidden markers, but the line-start boundary (position 0 of a marker line, or
 * the first line which has no preceding newline to extend the range into) can
 * still be reached -- by Home, a click on the bullet, or arrow motion. This
 * filter clamps any empty caret that lands before the marker end to the content
 * start, so it is impossible for the caret to sit left of (or inside) the
 * hidden bullet / checkbox / quote marker. Selections (non-empty ranges) are
 * left untouched, and doc-changing transactions are skipped (the dedicated
 * commands already land the caret past the marker).
 */
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

/** Left from the content start of a bullet / checkbox / quote line exits to the
 * previous line's end. Without this, the transaction filter would clamp the
 * caret back to the content start (Left into the hidden marker is a no-op),
 * so there'd be no way to leave a marker line to the left. This gives a
 * single predictable exit: at the content start, one Left jumps to the
 * previous line (mirroring how Right from the previous line's end is clamped
 * straight to the content start). At any other position the default Left runs.
 */
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

/** Convert visually space-like no-break characters only within a line's
 * leading blockquote marker run. Markdown accepts ASCII space or tab after
 * `>`, while copied rich text often supplies U+00A0/U+202F and otherwise turns
 * alert markers and fences into paragraph text. */
export function normalizeQuoteMarkerSpaces(value: string): string {
  return value.replace(/^([ \t]*(?:>[ \t\u00a0\u202f]?)+)/gm, (prefix) =>
    prefix.replace(/[\u00a0\u202f]/g, " "),
  );
}

/** Map a document offset through a full-document replacement so it lands at the
 * same logical spot. Offsets in the unchanged common prefix stay put; offsets in
 * the common suffix shift by the length delta (so a line inserted before a
 * caret sitting at the end of the file follows that end); offsets inside the
 * changed middle keep their line and column within the middle, clamped to the
 * new line's length. That middle rule is what stops "format on save" / "trim
 * trailing whitespace on save" from yanking the caret to the top of the file:
 * the previous behaviour clamped any middle offset to the end of the common
 * prefix, which is 0 as soon as the first line is touched. Used by `setValue`
 * to keep the caret where the user left it. */
export function mapPosThroughReplacement(oldDoc: string, newDoc: string, pos: number): number {
  const oldLen = oldDoc.length;
  const newLen = newDoc.length;
  if (pos === 0 || oldLen === 0) return Math.min(pos, newLen);
  const minLen = Math.min(oldLen, newLen);
  let prefix = 0;
  while (prefix < minLen && oldDoc[prefix] === newDoc[prefix]) prefix++;
  if (pos <= prefix) return pos;
  let suffix = 0;
  while (suffix < minLen - prefix && oldDoc[oldLen - 1 - suffix] === newDoc[newLen - 1 - suffix]) {
    suffix++;
  }
  if (pos >= oldLen - suffix) return pos + (newLen - oldLen);
  // The caret is inside the changed middle (between the common prefix and
  // suffix): keep its line and column within the middle rather than clamping
  // to the prefix end, which can be 0 and would yank it to the top of the file.
  const midStart = prefix;
  const newMidEnd = newLen - suffix;
  let line = 0;
  let col = 0;
  for (let i = midStart; i < pos; i++) {
    if (oldDoc[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  let nl = midStart;
  let curLine = 0;
  while (curLine < line && nl < newMidEnd) {
    if (newDoc[nl] === "\n") curLine++;
    nl++;
  }
  if (curLine < line) return newMidEnd; // the middle lost this line
  let lineEnd = nl;
  while (lineEnd < newMidEnd && newDoc[lineEnd] !== "\n") lineEnd++;
  return nl + Math.min(col, lineEnd - nl);
}

// A word, for the purpose of "expand the caret to the whole word": letters,
// digits and `_` (\w), plus the punctuation that reads as part of one token in
// prose about code -- `.` for file names (`test.md`), `-` for kebab-case, `/`
// for paths. Those three only count *between* word characters, so a sentence's
// trailing full stop or a dash used as punctuation is not swallowed.
const WORD_CHAR = /[\w.\-/]/;
const WORD_INNER_ONLY = /[.\-/]/;

/** Expand an empty selection at `pos` to the word it sits in -- the run of word
 * characters around it, with any leading / trailing inner-only punctuation
 * trimmed back off, so `test.md` wraps whole while `word.` keeps its full stop
 * outside. If the caret is not on a word, returns an empty range at `pos`. */
function wordRangeAt(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  let from = pos;
  while (from > line.from && WORD_CHAR.test(state.sliceDoc(from - 1, from))) from--;
  let to = pos;
  while (to < line.to && WORD_CHAR.test(state.sliceDoc(to, to + 1))) to++;
  while (to > from && WORD_INNER_ONLY.test(state.sliceDoc(to - 1, to))) to--;
  while (from < to && WORD_INNER_ONLY.test(state.sliceDoc(from, from + 1))) from++;
  // Nothing but inner-only punctuation around the caret (`a -|- b`): there is no
  // word here, so stay put rather than jumping to the start of the run.
  return from === to ? { from: pos, to: pos } : { from, to };
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

/** If the caret or selection [from, to] sits inside an emphasis / inline-code
 * construct that uses `marker`, return the source ranges of its opening and
 * closing marks so `wrap` can strip them to toggle the construct off. Only
 * matches when the whole selection lies within the construct. */
function emphasisMarksAt(
  state: EditorState,
  from: number,
  to: number,
  marker: string,
): { openFrom: number; openTo: number; closeFrom: number; closeTo: number } | null {
  const name =
    marker === "**"
      ? "StrongEmphasis"
      : marker === "*"
        ? "Emphasis"
        : marker === "~~"
          ? "Strikethrough"
          : marker === "`"
            ? "InlineCode"
            : null;
  if (!name) return null;
  const markName =
    marker === "`" ? "CodeMark" : marker === "~~" ? "StrikethroughMark" : "EmphasisMark";
  const tree = syntaxTree(state);
  for (const pos of [from, to]) {
    const node = tree.resolveInner(pos, -1);
    for (let n: typeof node | null = node; n; n = n.parent) {
      if (n.name !== name) continue;
      if (from < n.from || to > n.to) continue; // selection crosses the boundary
      const marks = n.getChildren(markName);
      if (marks.length >= 2) {
        return {
          openFrom: marks[0]!.from,
          openTo: marks[0]!.to,
          closeFrom: marks[marks.length - 1]!.from,
          closeTo: marks[marks.length - 1]!.to,
        };
      }
    }
  }
  return null;
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
export function alertCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /^(\s*>\s?)\[!([A-Za-z]*)$/.exec(before);
  if (!match) return null;
  const from = line.from + match[1]!.length + 2;
  const query = match[2]!.toUpperCase();
  const closing = context.state.sliceDoc(context.pos, context.pos + 1) === "]" ? "" : "]";
  const options = ALERT_KINDS.map((kind) => kind.toUpperCase())
    .filter((label) => label.startsWith(query))
    .map((label) => ({ label, type: "keyword", apply: `${label}${closing}` }));
  if (options.length === 0) return null;
  return { from, to: context.pos, options, filter: false };
}

/** Emoji picker on a `:shortcode` typed anywhere in the text, e.g. `:smi`
 * suggests `:smile:` and inserts the actual emoji character. A lightweight,
 * self-hosted alternative to the OS emoji picker, which a VS Code webview
 * blocks.
 *
 * The trigger is deliberately narrow so it never fights plain typing: the `:`
 * must open a word (start of line or preceded by a non-word char, so times
 * like `10:30` and URLs like `https:` are left alone). One query character is
 * enough (`:t`), and the charset is lowercase letters/digits/`_+-` only, so
 * the punctuation emoticons `:)` and `:(` never match. Typing a space (or
 * anything outside the shortcode charset) breaks the match, so the popup
 * closes on its own.
 *
 * Async because the emoji dataset is dynamically imported on first use; the
 * regex guard returns synchronously so plain typing never awaits, and the
 * loaded index is cached so every later keystroke resolves immediately. */
export async function emojiCompletions(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /(?:^|[^\w])(:([a-z0-9_+-]+))$/.exec(before);
  if (!m) return null;
  const query = m[2]!;
  const from = context.pos - (query.length + 1); // land on the ":"
  const index = await loadEmojiIndex();
  const options = searchEmoji(index, query).map(([name, emoji], i) => ({
    label: `${emoji} :${name}:`,
    apply: emoji,
    type: "text" as const,
    boost: -i, // preserve searchEmoji's ranking (best match first)
  }));
  if (options.length === 0) return null;
  return { from, to: context.pos, options, filter: false };
}

// ---- YAML front matter completions ----------------------------------------

// OKF / Open Knowledge Foundation Open Data Handbook resource `MediaType`
// values (https://github.com/okfn/opendatahandbook), used as suggestions for
// the YAML front matter `type:` field. The value can be anything: these are
// only suggestions, the editor lets free text through.
const OKF_RESOURCE_TYPES = ["Article", "Publication", "Website", "Podcast", "Software"];

// Common front matter keys, suggested when typing a field name at the start of
// a line inside the block. Free text is always allowed; `type` additionally
// drives node colours in the graph view.
const FRONT_MATTER_KEYS = [
  "title",
  "type",
  "description",
  "tags",
  "author",
  "date",
  "url",
  "source",
  "status",
];

/** Returns the 1-based {openLine, closeLine} of the YAML front matter block
 * if the document begins with `---\\n...\\n---` (or `...`), otherwise null. */
function frontMatterBounds(state: EditorState): { openLine: number; closeLine: number } | null {
  const doc = state.doc;
  if (doc.lines < 3) return null;
  if (doc.line(1).text.trimEnd() !== "---") return null;
  const limit = Math.min(doc.lines, 200);
  for (let n = 2; n <= limit; n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === "---" || t === "...") return { openLine: 1, closeLine: n };
  }
  return null;
}

/** Autocomplete inside the YAML front matter block: field names when typing at
 * the start of a line, and OKF Open Data Handbook resource `MediaType` values
 * for the `type:` field. Everything stays free text; these are suggestions. */
export function frontMatterCompletions(context: CompletionContext): CompletionResult | null {
  const bounds = frontMatterBounds(context.state);
  if (!bounds) return null;

  const doc = context.state.doc;
  const openLineEnd = doc.line(bounds.openLine).to;
  const closeLineFrom = doc.line(bounds.closeLine).from;
  const pos = context.pos;

  // Cursor must be strictly inside the front matter block.
  if (pos <= openLineEnd || pos >= closeLineFrom) return null;

  const line = doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);

  // Value completions for the `type:` field (OKF convention).
  const typeMatch = /^type:\s*(.*)$/.exec(textBefore);
  if (typeMatch) {
    const typed = typeMatch[1]!.trimStart();
    const valueFrom = pos - typed.length;
    const options = OKF_RESOURCE_TYPES.map((v) => ({ label: v, type: "text" as const }));
    return { from: valueFrom, to: line.to, options };
  }

  // Field-name completions while typing a top-level key at the start of a
  // line (no `:` yet). Keys already present in the block are not re-suggested.
  const keyMatch = /^([A-Za-z0-9_-]*)$/.exec(textBefore);
  if (keyMatch) {
    const typed = keyMatch[1]!;
    // Don't pop up spontaneously on a blank line; Ctrl-Space still works.
    if (!typed && !context.explicit) return null;
    const existing = new Set<string>();
    for (let n = bounds.openLine + 1; n < bounds.closeLine; n++) {
      if (n === line.number) continue;
      const m = /^([A-Za-z0-9_-]+):/.exec(doc.line(n).text);
      if (m) existing.add(m[1]!);
    }
    const options = FRONT_MATTER_KEYS.filter((k) => !existing.has(k)).map((k) => ({
      label: k,
      apply: `${k}: `,
      type: "property" as const,
    }));
    if (options.length === 0) return null;
    return { from: line.from, options, validFor: /^[A-Za-z0-9_-]*$/ };
  }

  return null;
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
