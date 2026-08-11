// Floating document outline.
//
// A panel listing the document's headings, opened / closed from the formatting
// toolbar's "Outline" button. Clicking a heading scrolls it into view. Pure
// DOM, no framework, styled through the theme.css `--td-*` variables. On a
// wide screen it starts open by default; on a narrow screen it starts closed
// (and floats as a popover).
//
// It is a floating rounded card (`position: fixed`) inset by a small margin,
// with its geometry synced to the editor wrapper's visible rectangle, so it
// stays pinned to the viewport in every host: it opens wherever the reader is
// scrolled to (no jump to the top) and follows the window while the page
// scrolls (the demo site, the VS Code webview) as well as staying put over the
// fixed-height editor (the desktop app).
//
// On a wide screen it reserves matching space on the editor's right (via
// wrapper padding) so the text reflows beside the card. On a narrow screen
// (phones / the Android app) there isn't room to reflow, so it instead floats
// *over* the text as a lightweight popover: a transparent backdrop closes it on
// any outside tap, and tapping a heading closes it too.

import { EditorView } from "@codemirror/view";
import { type Prefs } from "./prefs.ts";

// Below this viewport width the outline floats over the text instead of
// reflowing it (matches the toolbar's small-screen breakpoint).
const FLOAT_QUERY = "(max-width: 767px)";

export interface OutlineHeading {
  level: number;
  text: string;
  /** 1-indexed document line where the heading sits. */
  line: number;
}

export interface OutlineHandle {
  /** Recompute headings from the current document, re-rendering if visible
   * (otherwise the rebuild is deferred until the panel is next shown). */
  refresh(): void;
  /** Open / close the panel. */
  toggle(): void;
  destroy(): void;
}

/** Mount the outline panel inside the `.typodown` wrapper (collapsed). */
export function createOutline(
  wrapper: HTMLElement,
  view: EditorView,
  prefs?: Prefs,
): OutlineHandle {
  let visible = false;
  let dirty = false;

  /** Tapping a heading must not blur the editor, or the caret / selection
   * would be lost. */
  const keepFocus = (e: Event): void => e.preventDefault();

  const panel = document.createElement("div");
  panel.className = "cm-td-outline";
  panel.style.display = "none";

  const list = document.createElement("div");
  list.className = "cm-td-outline-list";
  panel.append(list);

  // Transparent full-screen catcher shown only in float mode: any tap outside
  // the panel closes it. It sits below the panel but above everything else, so
  // a tap anywhere (including the toolbar toggle) closes without a reopen race.
  const backdrop = document.createElement("div");
  backdrop.className = "cm-td-outline-backdrop";
  backdrop.style.display = "none";
  backdrop.addEventListener("click", () => setVisible(false));

  wrapper.append(backdrop, panel);

  /** Whether the outline should float over the text (narrow screens) rather
   * than reflow it (wide screens / desktop). */
  const floating = (): boolean =>
    typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(FLOAT_QUERY).matches;

  // Gap the floating card leaves from the editor's visible edges (top, bottom,
  // right) and from the text column on its left.
  const MARGIN = 12;

  // Pin the fixed card to the viewport's right edge, inset by MARGIN, spanning
  // the on-screen slice of the editor's height. It docks at the window edge in
  // every host: when the editor fills the window (the app) the card sits just
  // inside its right edge; when the editor is a narrow centred column (the
  // demo) the card still goes to the window edge rather than gluing to the
  // column, with the empty space falling between the text and the card.
  //
  // While docked (wide screen) reserve only the width by which the card
  // actually overlaps the editor's scroller, so the text reflows out from
  // under it -- and nothing when the card sits entirely to its right. The
  // padding goes inside the scroller (not the wrapper) so the vertical
  // scrollbar stays glued to the editor's right edge; the same width is
  // published as a wrapper variable so the floating toolbar re-centers over
  // the narrowed text column (see theme.css).
  const syncGeometry = (): void => {
    const r = wrapper.getBoundingClientRect();
    // On a narrow screen the card floats over the text and would overlap the
    // sticky formatting toolbar, so drop its top below the toolbar's bottom
    // (plus the same margin). On a wide screen the toolbar sits in the text
    // column and the card starts at the wrapper's visible top.
    const toolbarBottom = floating()
      ? (wrapper.querySelector<HTMLElement>(".cm-td-toolbar-anchor")?.getBoundingClientRect()
          .bottom ?? 0)
      : 0;
    const top = Math.max(toolbarBottom + MARGIN, Math.max(0, r.top) + MARGIN);
    const bottom = Math.min(window.innerHeight, r.bottom) - MARGIN;
    const panelLeft = window.innerWidth - MARGIN - panel.offsetWidth;
    panel.style.top = `${top}px`;
    // Cap with max-height so a short list collapses to its content while a long
    // one still scrolls inside the editor's visible slice (bottom - top).
    panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    panel.style.left = `${panelLeft}px`;

    if (visible && !floating()) {
      const scrollerRight = view.scrollDOM.getBoundingClientRect().right;
      const reserved = `${Math.max(0, scrollerRight - panelLeft + MARGIN)}px`;
      view.scrollDOM.style.paddingRight = reserved;
      wrapper.style.setProperty("--td-outline-reserved", reserved);
    } else {
      view.scrollDOM.style.paddingRight = "";
      wrapper.style.removeProperty("--td-outline-reserved");
    }
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncGeometry) : null;
  const attach = (): void => {
    // Capture so it also catches scrolls on inner scroll containers.
    window.addEventListener("scroll", syncGeometry, true);
    window.addEventListener("resize", syncGeometry);
    ro?.observe(wrapper);
  };
  const detach = (): void => {
    window.removeEventListener("scroll", syncGeometry, true);
    window.removeEventListener("resize", syncGeometry);
    ro?.disconnect();
  };

  function setVisible(v: boolean, persist = true): void {
    if (v === visible) return;
    visible = v;
    if (persist) prefs?.set("outline", v);
    if (v) {
      if (dirty) render();
      panel.style.display = "";
      // Narrow screen: float over the text, closed by an outside tap. Wide
      // screen: syncGeometry reserves the reflow space (called next, now that
      // the panel is laid out so offsetWidth is available).
      if (floating()) backdrop.style.display = "";
      syncGeometry();
      attach();
    } else {
      panel.style.display = "none";
      backdrop.style.display = "none";
      view.scrollDOM.style.paddingRight = "";
      wrapper.style.removeProperty("--td-outline-reserved");
      detach();
    }
  }

  function render(): void {
    dirty = false;
    const headings = parseOutline(view.state.doc.toString());
    list.replaceChildren();
    if (headings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cm-td-outline-empty";
      empty.textContent = "No headings";
      list.appendChild(empty);
      return;
    }
    for (const h of headings) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cm-td-outline-item";
      if (h.level <= 2) item.classList.add("cm-td-outline-item-strong");
      item.style.paddingLeft = `${(h.level - 1) * 12 + 8}px`;
      item.title = h.text;
      item.textContent = h.text;
      item.addEventListener("mousedown", keepFocus);
      item.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToLine(view, h.line);
        // On a narrow screen the outline is a popover: jumping to a heading
        // dismisses it (like a table-of-contents drawer).
        if (floating()) setVisible(false);
      });
      list.appendChild(item);
    }
  }

  render();
  // Restore a persisted open state without re-writing it on this initial paint.
  // With no stored preference, default to open on wide screens and closed on
  // narrow ones (where the outline floats as a popover over the text).
  const stored = prefs?.get("outline");
  const initialOpen = stored === true || (stored === undefined && !floating());
  if (initialOpen) setVisible(true, false);

  return {
    refresh() {
      if (visible) render();
      else dirty = true;
    },
    toggle() {
      setVisible(!visible);
    },
    destroy() {
      detach();
      view.scrollDOM.style.paddingRight = "";
      wrapper.style.removeProperty("--td-outline-reserved");
      backdrop.remove();
      panel.remove();
    },
  };
}

/** Scroll so the start of `line` (1-indexed) sits near the top of the visible
 * editor, without moving the caret. Clamps out-of-range lines to the first /
 * last line.
 *
 * Always go through CodeMirror's scroll effect. Calling `domAtPos` directly
 * for a distant line can return the nearest rendered DOM node while that line
 * is outside CodeMirror's virtual viewport, making the first click land at the
 * wrong place and only the second click succeed after the target is rendered. */
export function scrollToLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const n = Math.max(1, Math.min(line, doc.lines));
  const pos = doc.line(n).from;
  const scroller = view.scrollDOM;
  const rect = scroller.getBoundingClientRect();
  const visibleHeight =
    scroller.scrollHeight > scroller.clientHeight + 1
      ? scroller.clientHeight
      : Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, {
      y: "start",
      yMargin: Math.round(visibleHeight * 0.2),
    }),
  });
}

/** Parse markdown text into a flat list of headings.
 *
 * Recognises ATX (`# Heading`) and setext (`Heading\n===`) headings. Fenced
 * code blocks are skipped so a `#` inside them isn't mistaken for a heading, as
 * is a leading `---\n...\n---` front-matter block. */
export function parseOutline(markdown: string): OutlineHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: OutlineHeading[] = [];
  /** The open fence's delimiter, or null outside a fenced block. */
  let fence: { char: string; length: number } | null = null;
  let inFrontMatter = false;
  let frontMatterSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();

    // Front matter: `---` at the very start opens a block; the next `---` (or
    // `...`) on its own line closes it.
    if (i === 0 && trimmed === "---" && !frontMatterSeen) {
      inFrontMatter = true;
      frontMatterSeen = true;
      continue;
    }
    if (inFrontMatter) {
      if (trimmed === "---" || trimmed === "...") inFrontMatter = false;
      continue;
    }

    // Fenced code blocks open on a line starting with ``` or ~~~, and close on
    // a run of the *same character, at least as long*, with nothing after it
    // (CommonMark). Anything shorter, of the other character, or carrying an
    // info string is content -- which is what a markdown example nesting fences
    // inside a wider fence looks like.
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fenceMatch) {
      const run = fenceMatch[1]!;
      if (!fence) {
        fence = { char: run[0]!, length: run.length };
      } else if (
        run[0] === fence.char &&
        run.length >= fence.length &&
        fenceMatch[2]!.trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const atx = /^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(trimmed);
    if (atx) {
      const text = atx[2]!.trim();
      if (text) headings.push({ level: atx[1]!.length, text, line: i + 1 });
      continue;
    }

    // Setext heading: a line of `=` or `-` under a non-blank text line.
    const setext = /^([=-])\1*\s*$/.exec(trimmed);
    if (setext && i > 0) {
      const prev = lines[i - 1]!.trim();
      if (prev && !/^(#{1,6}\s|>|---|\*\*\*|\+\+\+)/.test(prev)) {
        const last = headings[headings.length - 1];
        if (!last || last.line !== i) {
          headings.push({ level: setext[1] === "=" ? 1 : 2, text: prev, line: i });
        }
      }
    }
  }
  return headings;
}
