// Find & replace panel.
//
// A floating Typora-style search box pinned to the top-right of the editor
// (centred on narrow screens). A collapse arrow expands a replace row with
// Replace / Replace-all actions. Pure DOM, no framework, styled through the
// theme.css `--td-*` variables.
//
// The actual searching, match highlighting and replacing are CodeMirror's own
// (`@codemirror/search`): this module only drives that state -- it sets the
// query (`setSearchQuery`, which lights up every match) and runs the
// `findNext` / `findPrevious` / `replaceNext` / `replaceAll` commands. The
// package's built-in panel is never opened; this replaces it so the widget can
// float where Typora puts it and match the editor's theme.

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";

// Marks for every match of the active query and the currently selected one.
const matchMark = Decoration.mark({ class: "cm-searchMatch" });
const selectedMark = Decoration.mark({ class: "cm-searchMatch cm-searchMatch-selected" });

/** Highlight all matches of the active search query in the viewport.
 *
 * `@codemirror/search`'s own highlighter only paints when its built-in panel is
 * open (`if (!panel ...) return Decoration.none`); since Typodown drives search
 * from a custom floating panel and never opens the built-in one, that
 * highlighter stays dark. This replacement decorates the matches whenever a
 * valid query is set, panel or not. Include it alongside `search()` (which
 * still provides the query state and the find / replace commands). */
export const searchHighlighter: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function build(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state);
  if (!query.search || !query.valid) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const cursor = query.getCursor(view.state, from, to);
    for (let m = cursor.next(); !m.done; m = cursor.next()) {
      const selected = view.state.selection.ranges.some(
        (r) => r.from === m.value.from && r.to === m.value.to,
      );
      builder.add(m.value.from, m.value.to, selected ? selectedMark : matchMark);
    }
  }
  return builder.finish();
}

export interface SearchHandle {
  /** Show the panel (prefilling from the current selection) and focus it. */
  open(): void;
  /** Hide the panel and clear the query (removing the match highlights). */
  close(): void;
  toggle(): void;
  /** Recompute the match counter; called by the editor on document changes so
   * the "3/12" stays accurate while the panel is open. Noop when closed. */
  refresh(): void;
  destroy(): void;
}

/** Mount the find & replace panel inside the `.typodown` wrapper (hidden). */
export function createSearch(wrapper: HTMLElement, view: EditorView): SearchHandle {
  let visible = false;
  let expanded = false;
  let caseSensitive = false;

  // Zero-height sticky anchor holding the panel, so it stays pinned to the top
  // of the visible editor as the page scrolls (demo site / VS Code webview) or
  // the editor's own scroller scrolls (desktop app) -- same trick as the
  // formatting toolbar, no per-scroll JS needed.
  const anchor = document.createElement("div");
  anchor.className = "cm-td-search-anchor";

  const panel = document.createElement("div");
  panel.className = "cm-td-search";
  panel.style.display = "none";

  // -- main row: expand arrow, query input, counter, prev / next, close ------
  const mainRow = document.createElement("div");
  mainRow.className = "cm-td-search-row";

  const expandBtn = iconButton("chevron-right", "Show replace");
  expandBtn.classList.add("cm-td-search-expand");

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "cm-td-search-input";
  searchInput.placeholder = "Find";
  searchInput.setAttribute("aria-label", "Find");

  const count = document.createElement("span");
  count.className = "cm-td-search-count";

  const caseBtn = textButton("Aa", "Match case");
  caseBtn.classList.add("cm-td-search-case");
  caseBtn.setAttribute("aria-pressed", "false");

  const prevBtn = iconButton("chevron-up", "Previous match");
  const nextBtn = iconButton("chevron-down", "Next match");
  const closeBtn = iconButton("close", "Close");

  mainRow.append(expandBtn, searchInput, count, caseBtn, prevBtn, nextBtn, closeBtn);

  // -- replace row: input, Replace, Replace all (hidden until expanded) ------
  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-td-search-row cm-td-search-replace-row";
  replaceRow.style.display = "none";

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = "cm-td-search-input";
  replaceInput.placeholder = "Replace";
  replaceInput.setAttribute("aria-label", "Replace");

  const replaceBtn = iconButton("replace", "Replace");
  const replaceAllBtn = iconButton("replace-all", "Replace all");

  replaceRow.append(replaceInput, replaceBtn, replaceAllBtn);

  panel.append(mainRow, replaceRow);
  anchor.append(panel);
  // Prepend (not append): a sticky element pins relative to its natural flow
  // position, so it must sit at the top of the wrapper's flow to stay pinned to
  // the top while scrolling through the editor (same as the toolbar anchor).
  wrapper.prepend(anchor);

  /** Build the current query from both inputs and push it into the editor
   * (lighting up the matches). With `select`, also move the selection to the
   * first match at or after the caret so typing is an incremental find; without
   * it the selection is left alone (used when only the replace text changed, or
   * when opening the panel over an existing selection). */
  function commit(select: boolean): void {
    const query = new SearchQuery({
      search: searchInput.value,
      replace: replaceInput.value,
      caseSensitive,
      literal: true,
    });
    const spec: Parameters<EditorView["dispatch"]>[0] = { effects: setSearchQuery.of(query) };
    if (select && query.search && query.valid) {
      const match = firstMatchFrom(query, view.state, view.state.selection.main.from);
      if (match) {
        spec.selection = { anchor: match.from, head: match.to };
        spec.scrollIntoView = true;
      }
    }
    view.dispatch(spec);
    updateCount();
  }

  function updateCount(): void {
    const query = getSearchQuery(view.state);
    if (!query.search) {
      count.textContent = "";
      return;
    }
    if (!query.valid) {
      count.textContent = "0/0";
      return;
    }
    const sel = view.state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(view.state);
    for (let m = cursor.next(); !m.done; m = cursor.next()) {
      total++;
      if (m.value.from === sel.from && m.value.to === sel.to) current = total;
    }
    count.textContent = `${current}/${total}`;
  }

  function setExpanded(v: boolean): void {
    expanded = v;
    replaceRow.style.display = v ? "" : "none";
    expandBtn.innerHTML = icon(v ? "chevron-down" : "chevron-right");
    expandBtn.title = v ? "Hide replace" : "Show replace";
  }

  // -- events ----------------------------------------------------------------
  searchInput.addEventListener("input", () => commit(true));
  replaceInput.addEventListener("input", () => commit(false));
  expandBtn.addEventListener("click", () => {
    setExpanded(!expanded);
    (expanded ? replaceInput : searchInput).focus();
  });
  caseBtn.addEventListener("click", () => {
    caseSensitive = !caseSensitive;
    caseBtn.setAttribute("aria-pressed", String(caseSensitive));
    caseBtn.classList.toggle("cm-td-search-btn-active", caseSensitive);
    commit(false);
  });
  prevBtn.addEventListener("click", () => {
    findPrevious(view);
    updateCount();
  });
  nextBtn.addEventListener("click", () => {
    findNext(view);
    updateCount();
  });
  replaceBtn.addEventListener("click", () => {
    commit(false);
    replaceNext(view);
    updateCount();
  });
  replaceAllBtn.addEventListener("click", () => {
    commit(false);
    replaceAll(view);
    updateCount();
  });
  closeBtn.addEventListener("click", () => close());
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.target === replaceInput) {
        commit(false);
        replaceNext(view);
      } else if (e.shiftKey) {
        findPrevious(view);
      } else {
        findNext(view);
      }
      updateCount();
    } else if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      caseBtn.click();
    }
  });

  const onWindowKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && visible) close();
  };
  window.addEventListener("keydown", onWindowKey);

  function open(): void {
    if (!visible) {
      visible = true;
      panel.style.display = "";
    }
    // Prefill from a single-line selection (Typora / browser behaviour).
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (text && !text.includes("\n")) searchInput.value = text;
    }
    commit(false);
    searchInput.focus();
    searchInput.select();
  }

  function close(): void {
    if (!visible) return;
    visible = false;
    panel.style.display = "none";
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    view.focus();
  }

  return {
    open,
    close,
    toggle() {
      if (visible) close();
      else open();
    },
    refresh() {
      if (visible) updateCount();
    },
    destroy() {
      window.removeEventListener("keydown", onWindowKey);
      anchor.remove();
    },
  };
}

/** The first match at or after `from`, wrapping around to the document start if
 * there is none before the end. Null when the query matches nothing. */
export function firstMatchFrom(
  query: SearchQuery,
  state: EditorState,
  from: number,
): { from: number; to: number } | null {
  const after = query.getCursor(state, from).next();
  if (!after.done) return after.value;
  const wrapped = query.getCursor(state, 0, from).next();
  return wrapped.done ? null : wrapped.value;
}

// ---- icons ------------------------------------------------------------------

/** Inline 16px stroke icons (lucide outlines), matching toolbar.ts. */
const ICONS: Record<string, string> = {
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "chevron-up": '<polyline points="18 15 12 9 6 15"/>',
  close: '<line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>',
  // A return arrow: apply the replacement to this one match.
  replace: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  // A double check: apply the replacement to every match.
  "replace-all": '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
};

function icon(name: string): string {
  return (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] ?? "") +
    "</svg>"
  );
}

function iconButton(name: string, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cm-td-search-btn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = icon(name);
  // Keep the editor selection alive: a button mousedown must not blur the
  // inputs / move focus in a way that collapses the match being acted on.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  return btn;
}

function textButton(text: string, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cm-td-search-btn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.textContent = text;
  // Keep the editor selection alive: a button mousedown must not blur the
  // inputs / move focus in a way that collapses the match being acted on.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  return btn;
}
