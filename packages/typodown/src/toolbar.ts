// Floating formatting toolbar.
//
// A light pill-shaped action bar floating at the top of the editor with the
// classic formatting actions (bold, italic, strikethrough, inline code, link)
// plus "Add table". It can be hidden; while hidden a small round button floats
// in the top-left margin to bring it back. By default it starts visible on
// small screens (where there is no right-click menu and no keyboard shortcuts)
// and hidden on large ones; hosts can force either via the `toolbar` option.

import { type EditorView } from "@codemirror/view";
import { openInsertTableDialog, insertTable } from "./menu.ts";

/** Visibility policy for the floating toolbar.
 * - "auto" (default): starts visible on small screens, hidden on large ones.
 * - "shown": starts visible everywhere.
 * - "hidden": starts hidden everywhere.
 * The user can always toggle it with the floating button. */
export type ToolbarMode = "auto" | "shown" | "hidden";

interface ToolbarAction {
  label: string;
  icon: string;
  run: (view: EditorView) => void;
}

export interface ToolbarHandle {
  destroy(): void;
}

const SMALL_SCREEN = "(max-width: 767px)";

/** Mount the floating toolbar inside the `.typodown` wrapper. */
export function createToolbar(
  wrapper: HTMLElement,
  view: EditorView,
  mode: ToolbarMode,
  actions: ToolbarAction[],
): ToolbarHandle {
  // Zero-height sticky strip holding the bar and the show button. Sticky (not
  // absolute) so that when the page itself scrolls (demo site, VS Code
  // webview) the bar follows the window; in hosts where the wrapper has a
  // fixed height and only the CodeMirror scroller scrolls (the mobile app),
  // sticky simply stays at the top of the wrapper.
  const anchor = document.createElement("div");
  anchor.className = "cm-td-toolbar-anchor";

  const bar = document.createElement("div");
  bar.className = "cm-td-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Formatting");

  // Tapping a button must not move focus out of the editor, or the selection
  // the action applies to would collapse before the click lands.
  const keepFocus = (e: Event): void => e.preventDefault();

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-td-toolbar-btn";
    btn.title = action.label;
    btn.setAttribute("aria-label", action.label);
    btn.innerHTML = icon(action.icon);
    btn.addEventListener("mousedown", keepFocus);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      action.run(view);
      view.focus();
    });
    bar.appendChild(btn);
  }

  bar.appendChild(separator());

  const hideBtn = document.createElement("button");
  hideBtn.type = "button";
  hideBtn.className = "cm-td-toolbar-btn";
  hideBtn.title = "Hide toolbar";
  hideBtn.setAttribute("aria-label", "Hide toolbar");
  hideBtn.innerHTML = icon("hide");
  hideBtn.addEventListener("mousedown", keepFocus);
  bar.appendChild(hideBtn);

  const showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.className = "cm-td-toolbar-show";
  showBtn.title = "Show toolbar";
  showBtn.setAttribute("aria-label", "Show toolbar");
  showBtn.innerHTML = icon("format");
  showBtn.addEventListener("mousedown", keepFocus);

  const setVisible = (visible: boolean): void => {
    bar.style.display = visible ? "" : "none";
    showBtn.style.display = visible ? "none" : "";
  };
  hideBtn.addEventListener("click", () => {
    setVisible(false);
    view.focus();
  });
  showBtn.addEventListener("click", () => {
    setVisible(true);
    view.focus();
  });

  const initiallyVisible =
    mode === "shown" || (mode === "auto" && window.matchMedia(SMALL_SCREEN).matches);
  setVisible(initiallyVisible);

  anchor.appendChild(bar);
  anchor.appendChild(showBtn);
  wrapper.prepend(anchor);

  // Float the show button in the margin left of the text column: as far out
  // as 2.75rem, but never past the viewport edge (hosts differ in whether the
  // margin comes from page layout, wrapper padding, or nothing at all). The
  // measured offset is published as a CSS variable so host stylesheets can
  // still override `left` outright.
  const updateShowOffset = (): void => {
    const space = anchor.getBoundingClientRect().left;
    const outside = Math.min(44, Math.max(4, space - 4));
    wrapper.style.setProperty("--td-toolbar-show-left", `${-outside}px`);
  };
  updateShowOffset();
  window.addEventListener("resize", updateShowOffset);

  return {
    destroy() {
      window.removeEventListener("resize", updateShowOffset);
      anchor.remove();
    },
  };
}

/** The default action set: classic formatting plus "Add table". */
export function defaultToolbarActions(opts: {
  wrapMarker: (marker: string) => (view: EditorView) => void;
  insertLink: (view: EditorView) => void;
}): ToolbarAction[] {
  return [
    { label: "Bold", icon: "bold", run: opts.wrapMarker("**") },
    { label: "Italic", icon: "italic", run: opts.wrapMarker("*") },
    { label: "Strikethrough", icon: "strikethrough", run: opts.wrapMarker("~~") },
    { label: "Inline code", icon: "code", run: opts.wrapMarker("`") },
    { label: "Link", icon: "link", run: opts.insertLink },
    {
      label: "Add table",
      icon: "table",
      run: (view) => {
        const head = view.state.selection.main.head;
        const coords = view.coordsAtPos(head);
        const x = coords ? coords.left : window.innerWidth / 2;
        const y = coords ? coords.bottom + 4 : window.innerHeight / 3;
        openInsertTableDialog({ x, y }, view, (rows, cols) => insertTable(view, rows, cols));
      },
    },
  ];
}

// ---- icons ------------------------------------------------------------------

// Inline 16px stroke icons (lucide outlines) so the library needs no icon
// dependency. Rendered with currentColor.
const ICONS: Record<string, string> = {
  bold: '<path d="M6 12h8a4 4 0 0 0 0-8H6v8Z"/><path d="M6 12h9a4 4 0 0 1 0 8H6v-8Z"/>',
  italic:
    '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  strikethrough:
    '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  table:
    '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  hide: '<path d="m18 15-6-6-6 6"/>',
  format:
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
};

function icon(name: string): string {
  const body = ICONS[name] ?? "";
  return (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    body +
    "</svg>"
  );
}

function separator(): HTMLElement {
  const sep = document.createElement("span");
  sep.className = "cm-td-toolbar-sep";
  sep.setAttribute("aria-hidden", "true");
  return sep;
}
