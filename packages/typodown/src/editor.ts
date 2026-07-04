// Typodown editor.
//
// A WYSIWYG markdown editor in the spirit of Typora: the document is rendered
// as styled HTML, and the raw markdown syntax is revealed only on the block
// that currently holds the caret.
//
// The source string is the single source of truth. All edits are intercepted
// at the `beforeinput` stage, applied to the string, and the affected DOM is
// re-rendered. The caret is tracked as a source offset so it survives every
// re-render (see render.ts for how offsets map onto Text nodes).

import type { Block, Inline } from "./ast.ts";
import { parse } from "./parse.ts";
import { renderBlock, type BlockRender, type Region } from "./render.ts";
import { matchLanguages } from "./highlight.ts";
import { htmlToMarkdown } from "./clipboard.ts";

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
   * Read the clipboard for the Cmd/Ctrl+K link shortcut. Defaults to
   * `navigator.clipboard.readText()`, which works in browsers but is blocked in
   * some embedders (e.g. VS Code webviews) provide this to read it from the
   * host instead.
   */
  getClipboardText?: () => string | Promise<string>;
  /** Called whenever the content changes. */
  onChange?: (value: string) => void;
  /** Allow raw HTML in the markdown. Defaults to true. */
  html?: boolean;
}

interface HistoryEntry {
  value: string;
  start: number;
  end: number;
}

interface CaretPos {
  node: Node;
  offset: number;
}

const HISTORY_LIMIT = 200;

export class Typodown {
  readonly wrapper: HTMLElement;
  readonly content: HTMLElement;

  private value = "";
  // The value `ast`/`blocks` were last built from, so `render` can diff the new
  // value against it and reuse the DOM of blocks that did not change.
  private renderedValue = "";
  private ast: Block[] = [];
  private blocks: BlockRender[] = [];
  private regions: Region[] = [];
  private onRegions: Region[] = [];
  private pieceMap = new Map<Text, number>();
  private lastSel = { start: 0, end: 0 };
  private readonly onChange?: (value: string) => void;
  private readonly getClipboardText?: () => string | Promise<string>;
  private readonly placeholder: string;
  private readonly htmlEnabled: boolean;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private composing = false;
  private coalesce = false;

  // Language autocomplete dropdown state.
  private langMenu: HTMLElement | null = null;
  private langItems: string[] = [];
  private langIndex = 0;
  private langRange: { from: number; to: number } | null = null;
  private langDismissed = false;

  private readonly onBeforeInput = (e: InputEvent): void => this.handleBeforeInput(e);
  private readonly onSelectionChange = (): void => this.handleSelectionChange();
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
  private readonly onMouseDown = (e: MouseEvent): void => {
    // Keep focus on the editor when clicking a task checkbox so the caret can
    // be restored after the source toggle re-renders.
    const t = e.target as HTMLElement | null;
    if (t && t.closest(".td-task-box")) e.preventDefault();
  };
  private readonly onClick = (e: MouseEvent): void => this.handleClick(e);
  private readonly onCopy = (e: ClipboardEvent): void => this.handleCopy(e, false);
  private readonly onCut = (e: ClipboardEvent): void => this.handleCopy(e, true);
  private readonly onCompositionStart = (): void => {
    this.composing = true;
  };
  private readonly onCompositionEnd = (): void => {
    this.composing = false;
    this.resyncActiveBlock();
  };

  constructor(parent: HTMLElement, options: TypodownOptions = {}) {
    this.onChange = options.onChange;
    this.getClipboardText = options.getClipboardText;
    this.htmlEnabled = options.html ?? true;
    this.placeholder = options.placeholder ?? "";

    this.wrapper = document.createElement("div");
    this.wrapper.className = "typodown";
    this.setTheme(options.theme ?? "auto");

    this.content = document.createElement("div");
    this.content.className = "typodown-content";
    this.content.contentEditable = "true";
    this.content.spellcheck = options.spellcheck ?? false;
    this.content.setAttribute("role", "textbox");
    this.content.setAttribute("aria-multiline", "true");
    if (this.placeholder) this.content.dataset.placeholder = this.placeholder;

    this.wrapper.appendChild(this.content);
    parent.appendChild(this.wrapper);

    this.content.addEventListener("beforeinput", this.onBeforeInput);
    this.content.addEventListener("keydown", this.onKeyDown);
    this.content.addEventListener("mousedown", this.onMouseDown);
    this.content.addEventListener("click", this.onClick);
    this.content.addEventListener("copy", this.onCopy);
    this.content.addEventListener("cut", this.onCut);
    this.content.addEventListener("compositionstart", this.onCompositionStart);
    this.content.addEventListener("compositionend", this.onCompositionEnd);
    document.addEventListener("selectionchange", this.onSelectionChange);

    this.setValue(options.value ?? "");
  }

  // ---- public API ---------------------------------------------------------

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.undoStack = [];
    this.redoStack = [];
    this.render(0, 0);
    this.emitChange();
  }

  setTheme(theme: Theme): void {
    this.wrapper.dataset.tdTheme = theme;
  }

  focus(): void {
    this.content.focus();
  }

  destroy(): void {
    this.content.removeEventListener("beforeinput", this.onBeforeInput);
    this.content.removeEventListener("keydown", this.onKeyDown);
    this.content.removeEventListener("mousedown", this.onMouseDown);
    this.content.removeEventListener("click", this.onClick);
    this.content.removeEventListener("copy", this.onCopy);
    this.content.removeEventListener("cut", this.onCut);
    this.content.removeEventListener("compositionstart", this.onCompositionStart);
    this.content.removeEventListener("compositionend", this.onCompositionEnd);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.hideLangMenu();
    this.wrapper.remove();
  }

  // ---- rendering ----------------------------------------------------------

  private render(caretStart?: number, caretEnd?: number): void {
    const newAst = parse(this.value, this.htmlEnabled);
    this.reconcile(newAst);
    // A blank line directly following a content block is just the paragraph
    // separator: mark it so CSS can collapse it to margin. Every other blank
    // (a leading/trailing blank, or an extra one in a run of two or more) stays
    // a visible, navigable empty line, so blank lines can be added freely.
    for (let i = 0; i < this.ast.length; i++) {
      if (this.ast[i]!.type !== "blank") continue;
      const prev = this.ast[i - 1];
      this.blocks[i]!.el.classList.toggle("td-blank-sep", !!prev && prev.type !== "blank");
    }
    this.pieceMap = new Map();
    this.regions = [];
    // `onRegions` is NOT reset: reused block elements keep their `.td-on` class
    // across a render, so the next `updateReveal` must still see the previously
    // revealed regions to clear the ones no longer under the caret. Regions from
    // re-rendered blocks are detached, so clearing their class is harmless.
    for (const b of this.blocks) {
      for (const p of b.pieces) this.pieceMap.set(p.node, p.from);
      for (const r of b.regions) this.regions.push(r);
    }
    this.content.toggleAttribute("data-empty", this.value.length === 0);

    if (caretStart !== undefined) {
      const end = caretEnd ?? caretStart;
      this.lastSel = { start: caretStart, end };
      // Reveal the target construct's marks first, so the caret can land on them.
      // Use the known new caret rather than the DOM selection: `replaceChildren`
      // above has just collapsed the live selection onto the content root, which
      // would otherwise reveal the first block's syntax for a frame (flicker)
      // until `setSelection` fires `selectionchange`.
      this.updateReveal(this.lastSel);
      this.setSelection(caretStart, end);
    } else {
      this.updateReveal();
    }
    this.updateLangMenu();
  }

  // Update the DOM to match `newAst` by reusing the elements of blocks that did
  // not change. An edit is a single splice, so the block list differs only in a
  // contiguous middle: blocks before it are untouched, blocks after it keep
  // their DOM (shifted by the net length delta), and only the middle is
  // re-rendered. This keeps a keystroke O(edited blocks) rather than rebuilding
  // the whole document, which is faster and no longer churns the live selection.
  private reconcile(newAst: Block[]): void {
    const oldAst = this.ast;
    const oldBlocks = this.blocks;
    const oldValue = this.renderedValue;
    const newValue = this.value;
    const delta = newValue.length - oldValue.length;
    const oldLen = oldAst.length;
    const newLen = newAst.length;
    const maxCommon = Math.min(oldLen, newLen);
    const sliceOf = (v: string, b: Block): string => v.slice(b.from, b.to);

    // Leading blocks that are identical and at the same offset.
    let p = 0;
    while (p < maxCommon) {
      const ob = oldAst[p]!;
      const nb = newAst[p]!;
      if (
        ob.from !== nb.from ||
        ob.to !== nb.to ||
        sliceOf(oldValue, ob) !== sliceOf(newValue, nb)
      ) {
        break;
      }
      p++;
    }
    // Trailing blocks that are identical but shifted by the length delta.
    let s = 0;
    while (s < maxCommon - p) {
      const ob = oldAst[oldLen - 1 - s]!;
      const nb = newAst[newLen - 1 - s]!;
      if (
        nb.from !== ob.from + delta ||
        nb.to !== ob.to + delta ||
        sliceOf(oldValue, ob) !== sliceOf(newValue, nb)
      ) {
        break;
      }
      s++;
    }

    const middle = newAst.slice(p, newLen - s).map((b) => renderBlock(newValue, b));

    // Drop the old middle from the DOM, then splice the new middle in before the
    // first reused tail element (or append when there is no tail).
    const firstTailEl = s > 0 ? oldBlocks[oldLen - s]!.el : null;
    for (let i = p; i < oldLen - s; i++) oldBlocks[i]!.el.remove();
    if (middle.length > 0) {
      const frag = document.createDocumentFragment();
      for (const b of middle) frag.appendChild(b.el);
      if (firstTailEl) this.content.insertBefore(frag, firstTailEl);
      else this.content.appendChild(frag);
    }

    const tail = oldBlocks.slice(oldLen - s);
    if (delta !== 0) for (const b of tail) this.shiftBlock(b, delta);

    this.ast = newAst;
    this.blocks = [...oldBlocks.slice(0, p), ...middle, ...tail];
    this.renderedValue = newValue;
  }

  // Move a reused block's source offsets by `delta` in place: its own range, its
  // caret pieces and reveal regions, plus the descendant elements that bake in
  // absolute offsets (list-item content starts and task-checkbox toggles).
  private shiftBlock(b: BlockRender, delta: number): void {
    b.from += delta;
    b.to += delta;
    for (const piece of b.pieces) piece.from += delta;
    for (const r of b.regions) {
      r.from += delta;
      r.to += delta;
    }
    b.el.dataset.from = String(b.from);
    b.el.dataset.to = String(b.to);
    for (const el of b.el.querySelectorAll<HTMLElement>("[data-content-from]")) {
      el.dataset.contentFrom = String(Number(el.dataset.contentFrom) + delta);
    }
    for (const el of b.el.querySelectorAll<HTMLElement>("[data-td-toggle]")) {
      el.dataset.tdToggle = String(Number(el.dataset.tdToggle) + delta);
    }
  }

  // Reveal the raw markdown syntax only for the construct(s) the caret is
  // actually inside, at the granularity of the individual construct (a bold
  // span, a single list item, a heading, ...) rather than the whole block.
  private updateReveal(forced?: { start: number; end: number }): void {
    const sel = forced ?? this.readSelection() ?? this.lastSel;
    const next: Region[] = [];
    for (const r of this.regions) {
      // Overlap test (inclusive) between the region and the selection so a caret
      // sitting anywhere within the construct reveals it.
      if (r.from <= sel.end && sel.start <= r.to) next.push(r);
    }
    for (const r of this.onRegions) {
      if (!next.includes(r)) r.el.classList.remove("td-on");
    }
    for (const r of next) r.el.classList.add("td-on");
    this.onRegions = next;

    // Mark the block(s) the caret is in. A collapsed paragraph separator only
    // expands to show the cursor when a *collapsed* caret sits on it; a range
    // selection spanning several blocks must not reveal the separators between
    // them (that would insert a visible empty line between each block).
    const lo = Math.min(this.blockIndexOf(sel.start), this.blockIndexOf(sel.end));
    const hi = Math.max(this.blockIndexOf(sel.start), this.blockIndexOf(sel.end));
    const collapsed = sel.start === sel.end;
    this.blocks.forEach((b, i) => {
      const active = i >= lo && i <= hi && (collapsed || !b.el.classList.contains("td-blank-sep"));
      b.el.classList.toggle("td-line-active", active);
    });
  }

  // ---- language autocomplete ---------------------------------------------

  // The info-string range of the code block whose opening fence the caret is on.
  private infoRangeAt(offset: number): { from: number; to: number } | null {
    for (const b of this.ast) {
      if (b.type === "code" && offset >= b.info.from && offset <= b.info.to) {
        return { from: b.info.from, to: b.info.to };
      }
    }
    return null;
  }

  private updateLangMenu(): void {
    const sel = this.readSelection() ?? this.lastSel;
    if (sel.start !== sel.end) return this.hideLangMenu();
    const info = this.infoRangeAt(sel.start);
    if (!info) {
      this.langDismissed = false;
      return this.hideLangMenu();
    }
    if (this.langDismissed) return;
    const query = this.value.slice(info.from, info.to).trim().toLowerCase();
    const matches = matchLanguages(query);
    if (matches.length === 0 || (matches.length === 1 && matches[0] === query)) {
      return this.hideLangMenu();
    }
    this.langRange = info;
    this.langItems = matches;
    if (this.langIndex >= matches.length) this.langIndex = 0;
    this.showLangMenu();
  }

  private showLangMenu(): void {
    if (!this.langMenu) {
      this.langMenu = document.createElement("div");
      this.langMenu.className = "td-lang-menu";
      this.langMenu.setAttribute("role", "listbox");
      // Keep the editor focused: act on mousedown before the blur.
      this.langMenu.addEventListener("mousedown", (e) => {
        const item = (e.target as HTMLElement).closest(".td-lang-item");
        if (!item) return;
        e.preventDefault();
        this.langIndex = Number((item as HTMLElement).dataset.index);
        this.chooseLang();
      });
      this.wrapper.appendChild(this.langMenu);
    }
    this.langMenu.replaceChildren(
      ...this.langItems.map((name, i) => {
        const item = document.createElement("div");
        item.className = "td-lang-item";
        item.textContent = name;
        item.dataset.index = String(i);
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(i === this.langIndex));
        return item;
      }),
    );
    this.positionLangMenu();
  }

  private positionLangMenu(): void {
    if (!this.langMenu) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const base = this.wrapper.getBoundingClientRect();
    this.langMenu.style.left = `${rect.left - base.left}px`;
    this.langMenu.style.top = `${rect.bottom - base.top + 4}px`;
  }

  private hideLangMenu(): void {
    if (this.langMenu) {
      this.langMenu.remove();
      this.langMenu = null;
    }
    this.langRange = null;
  }

  private chooseLang(): void {
    if (!this.langRange) return;
    const name = this.langItems[this.langIndex];
    if (name === undefined) return;
    const { from, to } = this.langRange;
    this.langDismissed = true;
    this.hideLangMenu();
    this.applyEdit(from, to, name);
  }

  private langMenuKey(e: KeyboardEvent): boolean {
    if (!this.langMenu) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.langIndex = (this.langIndex + 1) % this.langItems.length;
      this.showLangMenu();
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.langIndex = (this.langIndex - 1 + this.langItems.length) % this.langItems.length;
      this.showLangMenu();
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.chooseLang();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.langDismissed = true;
      this.hideLangMenu();
      return true;
    }
    return false;
  }

  // ---- selection <-> source offset ---------------------------------------

  private blockIndexOf(offset: number): number {
    const blocks = this.blocks;
    for (let i = 0; i < blocks.length; i++) {
      if (offset >= blocks[i]!.from && offset < blocks[i]!.to) return i;
    }
    return Math.max(0, blocks.length - 1);
  }

  private nodeToOffset(node: Node, domOffset: number): number | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const from = this.pieceMap.get(node as Text);
      if (from !== undefined) return from + domOffset;
    }
    // Caret sits in an element (e.g. an empty line or list item): snap to a
    // child text piece boundary when one is adjacent, then to the enclosing
    // list item's content start, then to the block start.
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node.childNodes[domOffset - 1];
      if (child && child.nodeType === Node.TEXT_NODE && this.pieceMap.has(child as Text)) {
        return this.pieceMap.get(child as Text)! + (child as Text).length;
      }
      // Caret sits between block elements (notably on the content root, e.g.
      // after Select All): snap to the source range of the block on either side
      // so the selection maps to a real offset instead of failing.
      const after = node.childNodes[domOffset];
      if (after instanceof HTMLElement && after.dataset.from !== undefined) {
        return Number(after.dataset.from);
      }
      const before = node.childNodes[domOffset - 1];
      if (before instanceof HTMLElement && before.dataset.to !== undefined) {
        return Number(before.dataset.to);
      }
      const li = this.closestListItem(node);
      if (li) return Number(li.dataset.contentFrom);
    }
    const blockEl = this.closestBlock(node);
    if (!blockEl) return null;
    return Number(blockEl.dataset.from);
  }

  private closestBlock(node: Node): HTMLElement | null {
    return this.closestWith(node, "from");
  }

  // The nearest enclosing list item (each carries `data-content-from`).
  private closestListItem(node: Node): HTMLElement | null {
    return this.closestWith(node, "contentFrom");
  }

  private closestWith(node: Node, dataKey: string): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== this.content) {
      if (
        cur.nodeType === Node.ELEMENT_NODE &&
        (cur as HTMLElement).dataset[dataKey] !== undefined
      ) {
        return cur as HTMLElement;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  private readSelection(): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
    if (!anchorNode || !focusNode) return null;
    if (!this.content.contains(anchorNode) || !this.content.contains(focusNode)) return null;
    const a = this.nodeToOffset(anchorNode, anchorOffset);
    const b = this.nodeToOffset(focusNode, focusOffset);
    if (a === null || b === null) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  private offsetToCaret(offset: number): CaretPos {
    const b = this.blocks[this.blockIndexOf(offset)]!;
    return this.placeInBlock(b, offset);
  }

  private placeInBlock(b: BlockRender, offset: number): CaretPos {
    let best: CaretPos | null = null;
    for (const p of b.pieces) {
      const end = p.from + p.node.length;
      if (offset >= p.from && offset <= end) {
        if (offset < end) return { node: p.node, offset: offset - p.from };
        best = { node: p.node, offset: p.node.length };
      }
    }
    if (best) return best;
    if (b.pieces.length > 0) {
      const first = b.pieces[0]!;
      if (offset <= first.from) return { node: first.node, offset: 0 };
      const last = b.pieces[b.pieces.length - 1]!;
      return { node: last.node, offset: last.node.length };
    }
    return { node: b.el, offset: 0 };
  }

  private setSelection(start: number, end: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    const a = this.offsetToCaret(start);
    const b = start === end ? a : this.offsetToCaret(end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- editing ------------------------------------------------------------

  private handleSelectionChange(): void {
    if (this.composing) return;
    const sel = this.readSelection();
    if (!sel) return;
    this.lastSel = sel;
    this.updateReveal();
    this.updateLangMenu();
  }

  private handleBeforeInput(e: InputEvent): void {
    if (this.composing) return;
    const type = e.inputType;
    const sel = this.readSelection() ?? this.lastSel;
    let { start, end } = sel;
    // Sync the tracked selection to what we actually read: `selectionchange` is
    // async, so `lastSel` can lag a fast caret move that precedes this edit.
    // `pushHistory` snapshots `lastSel`, so a stale value here would make undo
    // restore the caret to the wrong place (often the document start).
    this.lastSel = { start, end };

    // For a collapsed caret, let the browser tell us how far a word/line delete
    // reaches (getTargetRanges). For a real selection the selection *is* the
    // range to delete -- trusting getTargetRanges there is both unnecessary and,
    // in nested lists, sometimes wrong (it can report an endpoint far past the
    // selection, deleting following items).
    const targets = e.getTargetRanges?.();
    if (start === end && targets && targets.length > 0 && type.startsWith("delete")) {
      const r0 = targets[0]!;
      const rN = targets[targets.length - 1]!;
      const a = this.nodeToOffset(r0.startContainer, r0.startOffset);
      const b = this.nodeToOffset(rN.endContainer, rN.endOffset);
      if (a !== null && b !== null) {
        start = Math.min(a, b);
        end = Math.max(a, b);
      }
    }

    e.preventDefault();

    switch (type) {
      case "insertText":
      case "insertReplacementText":
        this.applyEdit(start, end, e.data ?? "", type === "insertText" && start === end);
        break;
      case "insertParagraph":
        this.insertParagraph(start, end);
        break;
      case "insertLineBreak":
        this.applyEdit(start, end, "\n");
        break;
      case "deleteContentBackward":
      case "deleteWordBackward":
      case "deleteSoftLineBackward":
      case "deleteHardLineBackward": {
        if (start === end) start = this.deleteBoundary(start, type, true);
        this.applyEdit(start, end, "");
        break;
      }
      case "deleteContentForward":
      case "deleteWordForward":
      case "deleteSoftLineForward":
      case "deleteHardLineForward": {
        if (start === end) end = this.deleteBoundary(end, type, false);
        this.applyEdit(start, end, "");
        break;
      }
      case "deleteContent":
      case "deleteByCut":
      case "deleteByDrag":
        this.applyEdit(start, end, "");
        break;
      case "insertFromPaste":
      case "insertFromDrop": {
        const plain = e.dataTransfer?.getData("text/plain") ?? e.data ?? "";
        const html = e.dataTransfer?.getData("text/html") ?? "";
        // Rich HTML: keep the Markdown-expressible formatting (bold, links, ...)
        // and drop the rest. Fall back to the plain text when there is no HTML
        // or the conversion is empty (e.g. our own copies carry no HTML).
        const md = html ? htmlToMarkdown(html) : "";
        this.applyEdit(start, end, md || plain);
        break;
      }
      case "historyUndo":
        this.undo();
        break;
      case "historyRedo":
        this.redo();
        break;
      default:
        if (e.data) this.applyEdit(start, end, e.data);
    }
  }

  // Compute the offset one deletion step away from `pos`.
  private deleteBoundary(pos: number, type: string, backward: boolean): number {
    if (type.includes("Content")) {
      return backward ? Math.max(0, pos - 1) : Math.min(this.value.length, pos + 1);
    }
    // Word / line deletion.
    if (type.includes("Word")) {
      if (backward) {
        let i = pos;
        while (i > 0 && /\s/.test(this.value[i - 1]!)) i--;
        while (i > 0 && !/\s/.test(this.value[i - 1]!)) i--;
        return i;
      }
      let i = pos;
      while (i < this.value.length && /\s/.test(this.value[i]!)) i++;
      while (i < this.value.length && !/\s/.test(this.value[i]!)) i++;
      return i;
    }
    // Line deletion.
    if (backward) {
      const nl = this.value.lastIndexOf("\n", pos - 1);
      return nl + 1;
    }
    const nl = this.value.indexOf("\n", pos);
    return nl === -1 ? this.value.length : nl;
  }

  private applyEdit(from: number, to: number, insert: string, coalesceable = false): void {
    this.pushHistory(coalesceable && this.coalesce);
    this.coalesce = coalesceable;
    this.value = this.value.slice(0, from) + insert + this.value.slice(to);
    const caret = from + insert.length;
    this.render(caret, caret);
    this.emitChange();
  }

  private insertParagraph(from: number, to: number): void {
    const idx = this.blockIndexOf(from);
    const blk = this.ast[idx];
    let insert = "\n\n";
    if (blk) {
      // On an already-blank line, add a single newline so each Enter adds one
      // empty line rather than a double paragraph break.
      if (blk.type === "blank") insert = "\n";
      else if (blk.type === "code") insert = "\n";
      else if (blk.type === "heading" || blk.type === "table") insert = "\n";
      else if (blk.type === "blockquote") insert = "\n> ";
      else if (blk.type === "list") {
        const cont = this.listContinuation(blk, from);
        if (cont === null) {
          // Empty item: exit the list by removing the marker line.
          const item = blk.items.find((it) => from >= it.from && from <= it.to);
          if (item) {
            this.applyEdit(item.from, item.to, "");
            return;
          }
        } else {
          insert = cont;
        }
      }
    }
    this.applyEdit(from, to, insert);
  }

  private listContinuation(blk: Extract<Block, { type: "list" }>, offset: number): string | null {
    const item = blk.items.find((it) => offset >= it.from && offset <= it.to);
    if (!item) return "\n";
    // Empty item -> signal the caller to break out of the list.
    if (item.to - (item.from + item.markLen) <= 0) return null;
    const marker = item.marker.trimStart();
    const indent = item.marker.slice(0, item.marker.length - marker.length);
    if (blk.ordered) {
      const num = parseInt(marker, 10);
      const sep = marker.replace(/^\d+/, "");
      return `\n${indent}${Number.isFinite(num) ? num + 1 : 1}${sep} `;
    }
    const box = item.checked !== null ? "[ ] " : "";
    return `\n${indent}${marker} ${box}`;
  }

  private resyncActiveBlock(): void {
    const sel = this.readSelection();
    const idx = sel ? this.blockIndexOf(sel.start) : -1;
    const b = this.blocks[idx];
    if (!b) {
      return;
    }
    const newText = b.el.textContent ?? "";
    const caretInBlock = sel ? sel.start - b.from : newText.length;
    this.value = this.value.slice(0, b.from) + newText + this.value.slice(b.to);
    const caret = b.from + Math.max(0, caretInBlock);
    this.render(caret, caret);
    this.emitChange();
  }

  // Splice [from, to) -> insert, then restore the selection to [selStart, selEnd].
  private edit(from: number, to: number, insert: string, selStart: number, selEnd: number): void {
    this.pushHistory(false);
    this.coalesce = false;
    this.value = this.value.slice(0, from) + insert + this.value.slice(to);
    this.render(selStart, selEnd);
    this.emitChange();
  }

  // Toggle an inline emphasis marker ("**" or "*") around the selection. With no
  // selection it inserts an empty pair and places the caret between the markers.
  private toggleWrap(marker: string): void {
    const value = this.value;
    const { start, end } = this.readSelection() ?? this.lastSel;
    const m = marker.length;
    if (start === end) {
      this.edit(start, start, marker + marker, start + m, start + m);
      return;
    }
    const selected = value.slice(start, end);
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= 2 * m) {
      const inner = selected.slice(m, -m);
      this.edit(start, end, inner, start, start + inner.length);
    } else if (value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
      // Markers sit just outside the selection: strip them.
      this.edit(start - m, end + m, selected, start - m, end - m);
    } else {
      this.edit(start, end, marker + selected + marker, start + m, end + m);
    }
  }

  // Cmd/Ctrl+K link toggle:
  //  - caret inside an existing link -> unwrap it (removes the [](...) syntax)
  //  - no selection but on a word -> wrap that word
  //  - otherwise wrap the selection
  // If the clipboard holds a URL it becomes the destination; otherwise the caret
  // lands between the () so the URL can be typed.
  private async insertLink(): Promise<void> {
    const sel = this.readSelection() ?? this.lastSel;

    const link = this.linkAt(sel.start, sel.end);
    if (link) {
      const text = this.value.slice(link.textFrom, link.textTo);
      this.edit(link.from, link.to, text, link.from, link.from + text.length);
      return;
    }

    let { start, end } = sel;
    if (start === end) {
      const word = wordBounds(this.value, start);
      start = word.from;
      end = word.to;
    }
    const text = this.value.slice(start, end);

    let url = "";
    // Only attempt an auto-paste when the host provides a clipboard reader
    // (e.g. the VS Code webview, where it is synchronous and prompt-free). In a
    // plain browser, `navigator.clipboard.readText()` would show a permission
    // prompt and delay the link insertion; skip it and land the caret between
    // the () so the user can paste the URL themselves.
    if (this.getClipboardText) {
      try {
        const clip = (await this.getClipboardText()).trim();
        if (/^(https?:\/\/|mailto:|www\.)\S+$/i.test(clip)) url = clip;
      } catch {
        // Clipboard unavailable: fall back to empty URL.
      }
    }

    const inserted = `[${text}](${url})`;
    let caret: number;
    if (text.length === 0)
      caret = start + 1; // between [ ]
    else if (url.length === 0)
      caret = start + inserted.length - 1; // between ( )
    else caret = start + inserted.length; // after the link
    this.edit(start, end, inserted, caret, caret);
  }

  // Find a link / autolink whose source range contains [from, to], returning the
  // node range plus the range of its visible text (between the [ ] markers).
  private linkAt(
    from: number,
    to: number,
  ): { from: number; to: number; textFrom: number; textTo: number } | null {
    const blk = this.ast[this.blockIndexOf(from)];
    if (!blk) return null;
    const arrays: Inline[][] = [];
    if (blk.type === "paragraph" || blk.type === "heading") arrays.push(blk.inline);
    else if (blk.type === "blockquote") for (const l of blk.lines) arrays.push(l.inline);
    else if (blk.type === "list") for (const it of blk.items) arrays.push(it.inline);

    let found: { from: number; to: number; textFrom: number; textTo: number } | null = null;
    const walk = (nodes: Inline[]): void => {
      for (const n of nodes) {
        if ((n.type === "link" || n.type === "autolink") && n.from <= from && to <= n.to) {
          const first = n.children[0]!;
          const last = n.children[n.children.length - 1]!;
          found = { from: n.from, to: n.to, textFrom: first.to, textTo: last.from };
        }
        if ("children" in n) walk(n.children);
      }
    };
    for (const arr of arrays) walk(arr);
    return found;
  }

  // Indent (Tab) or outdent (Shift+Tab) every line touched by the selection by
  // one level (two spaces). On list items this nests / un-nests them; on other
  // lines it just adds or removes leading indentation.
  private changeIndent(outdent: boolean): void {
    const UNIT = 2;
    const value = this.value;
    const sel = this.readSelection() ?? this.lastSel;
    const firstStart = value.lastIndexOf("\n", sel.start - 1) + 1;
    const nl = value.indexOf("\n", sel.end);
    const regionEnd = nl === -1 ? value.length : nl;

    const parts = value.slice(firstStart, regionEnd).split("\n");
    const starts: number[] = [];
    const deltas: number[] = [];
    let cursor = firstStart;
    let changed = false;
    const newParts = parts.map((ln) => {
      starts.push(cursor);
      cursor += ln.length + 1;
      if (outdent) {
        const m = /^(\t| {1,2})/.exec(ln);
        const removed = m ? m[0].length : 0;
        deltas.push(-removed);
        if (removed > 0) changed = true;
        return ln.slice(removed);
      }
      deltas.push(UNIT);
      changed = true;
      return " ".repeat(UNIT) + ln;
    });
    if (!changed) return;

    // Remap a source offset through the per-line indentation change.
    const remap = (o: number): number => {
      if (o < firstStart) return o;
      let cum = 0;
      for (let i = 0; i < parts.length; i++) {
        const lineStart = starts[i]!;
        const lineEnd = lineStart + parts[i]!.length;
        if (o <= lineEnd || i === parts.length - 1) {
          if (deltas[i]! >= 0) return o + cum + deltas[i]!;
          const kept = Math.max(0, o - lineStart + deltas[i]!);
          return lineStart + cum + kept;
        }
        cum += deltas[i]!;
      }
      return o + cum;
    };

    this.pushHistory(false);
    this.coalesce = false;
    this.value = value.slice(0, firstStart) + newParts.join("\n") + value.slice(regionEnd);
    this.render(remap(sel.start), remap(sel.end));
    this.emitChange();
  }

  // ---- history ------------------------------------------------------------

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.langMenuKey(e)) return;
    // Claim a shortcut: cancel the default action AND stop the event from
    // bubbling to any host listener. VS Code webviews register a window-level
    // keydown handler that reimplements Cmd/Ctrl+A (select all), Cmd+B, etc.;
    // without stopPropagation it runs after us and clobbers what we just did
    // (e.g. re-selecting the whole document over our code-only selection).
    const claim = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      claim();
      this.changeIndent(e.shiftKey);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "b") {
        claim();
        this.toggleWrap("**");
        return;
      }
      if (key === "i") {
        claim();
        this.toggleWrap("*");
        return;
      }
      if (key === "k") {
        claim();
        void this.insertLink();
        return;
      }
      if (key === "v" && e.shiftKey) {
        claim();
        this.plainPaste();
        return;
      }
    }
    if (mod && !e.altKey && (e.key === "a" || e.key === "A") && this.selectAllInCode()) {
      claim();
      return;
    }
    if (mod && !e.altKey && (e.key === "z" || e.key === "Z")) {
      claim();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && (e.key === "y" || e.key === "Y")) {
      claim();
      this.redo();
    }
  }

  // Cmd/Ctrl+A selects only the code content (not the fences) when the caret is
  // inside a fenced code block; otherwise the browser's select-all runs.
  private selectAllInCode(): boolean {
    const sel = this.readSelection() ?? this.lastSel;
    const pos = sel.start;
    for (const b of this.ast) {
      if (b.type === "code" && pos >= b.from && pos < b.to) {
        this.lastSel = { start: b.content.from, end: b.content.to };
        this.setSelection(b.content.from, b.content.to);
        this.updateReveal();
        return true;
      }
    }
    return false;
  }

  // Toggle a task-list checkbox from the source, and only follow links when the
  // user cmd/ctrl-clicks them (a plain click just places the caret).
  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const box = target.closest(".td-task-box") as HTMLInputElement | null;
    if (box) {
      e.preventDefault();
      const off = Number(box.dataset.tdToggle);
      if (Number.isInteger(off) && off >= 0 && off < this.value.length) {
        this.applyEdit(off, off + 1, this.value[off] === " " ? "x" : " ");
      }
      return;
    }
    const a = target.closest("a");
    if (a && !(e.metaKey || e.ctrlKey)) e.preventDefault();
  }

  // Copy / cut the Markdown *source* of the selection rather than the rendered
  // DOM, so the clipboard carries clean Markdown (bold stays `**bold**`, links
  // stay `[text](url)`, code is plain text) with none of the syntax-highlight
  // colours or other styling that Markdown cannot express.
  private handleCopy(e: ClipboardEvent, cut: boolean): void {
    const sel = this.readSelection();
    if (!sel || sel.start === sel.end) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", this.value.slice(sel.start, sel.end));
    if (cut) this.applyEdit(sel.start, sel.end, "");
  }

  // Cmd/Ctrl+Shift+V: insert the clipboard's plain text verbatim, skipping the
  // HTML-to-Markdown conversion a normal paste applies.
  private plainPaste(): void {
    const read = this.getClipboardText
      ? Promise.resolve(this.getClipboardText())
      : navigator.clipboard?.readText?.();
    if (!read) return;
    void read
      .then((text) => {
        if (!text) return;
        const sel = this.readSelection() ?? this.lastSel;
        this.applyEdit(sel.start, sel.end, text);
      })
      .catch(() => {
        // Clipboard unavailable (e.g. permission denied): nothing to paste.
      });
  }

  private pushHistory(coalesce: boolean): void {
    if (coalesce && this.undoStack.length > 0) return;
    this.undoStack.push({ value: this.value, start: this.lastSel.start, end: this.lastSel.end });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ value: this.value, start: this.lastSel.start, end: this.lastSel.end });
    this.value = entry.value;
    this.coalesce = false;
    this.render(entry.start, entry.end);
    this.emitChange();
  }

  private redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ value: this.value, start: this.lastSel.start, end: this.lastSel.end });
    this.value = entry.value;
    this.coalesce = false;
    this.render(entry.start, entry.end);
    this.emitChange();
  }

  private emitChange(): void {
    this.onChange?.(this.value);
  }
}

export function createTypodown(parent: HTMLElement, options?: TypodownOptions): Typodown {
  return new Typodown(parent, options);
}

// The word surrounding `offset` (letters, digits, `_`, `-`, `'`). Returns an
// empty range at `offset` when the caret is not on a word.
function wordBounds(value: string, offset: number): { from: number; to: number } {
  const isWord = (ch: string | undefined): boolean =>
    ch !== undefined && /[\p{L}\p{N}_'-]/u.test(ch);
  let from = offset;
  let to = offset;
  while (from > 0 && isWord(value[from - 1])) from--;
  while (to < value.length && isWord(value[to])) to++;
  return { from, to };
}
