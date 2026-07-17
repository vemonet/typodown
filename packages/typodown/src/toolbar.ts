// Floating formatting toolbar.
//
// A light pill-shaped action bar floating at the top of the editor with the
// classic formatting actions (bold, italic, strikethrough, inline code, link)
// plus "Add table". It can be hidden; while hidden a small round button floats
// in the top-left margin to bring it back. By default it starts visible
// everywhere; hosts can force "auto" (visible only on small screens) or
// "hidden" via the `toolbar` option.

import { type EditorView } from "@codemirror/view";
import { type Prefs } from "./prefs.ts";

/** Visibility policy for the floating toolbar.
 * - "shown" (default): starts visible everywhere.
 * - "auto": starts visible on small screens, hidden on large ones.
 * - "hidden": starts hidden everywhere.
 * The user can always toggle it with the floating button. */
export type ToolbarMode = "auto" | "shown" | "hidden";

interface ToolbarAction {
  label: string;
  icon: string;
  run: (view: EditorView) => void;
  /** Keyboard shortcut in CodeMirror key-spec form (e.g. "Mod-Shift-x"),
   * appended to the button tooltip. `Mod` renders as ⌘ on macOS, Ctrl
   * elsewhere. Omit for actions with no keybinding. */
  shortcut?: string;
  /** Whether to return focus to the editor after running (default true, so a
   * formatting action keeps the caret/selection live). Set false for actions
   * that shouldn't touch the caret -- e.g. toggling the outline, where
   * refocusing the editor would pop the soft keyboard on mobile; instead the
   * editor is blurred so any open keyboard is dismissed. */
  refocus?: boolean;
}

/** True on macOS, where `Mod` shortcuts use ⌘ rather than Ctrl. */
const IS_MAC = /Mac|iPhone|iPad/i.test(
  (typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "",
);

/** Render a CodeMirror key spec ("Mod-Shift-x") as a tooltip hint, mapping
 * `Mod` to ⌘ on macOS and Ctrl elsewhere. */
function formatShortcut(spec: string): string {
  return spec
    .split("-")
    .map((part) => {
      if (part === "Mod") return IS_MAC ? "⌘" : "Ctrl";
      if (part === "Shift") return "⇧";
      if (part === "Alt") return IS_MAC ? "Option" : "Alt";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

export interface ToolbarSave {
  /** Perform the save. Ignores the editor view. */
  run: () => void;
  /** Returns whether there are unsaved changes; the button is disabled while
   * this is false (no current file, or content already written). */
  isDirty?: () => boolean;
}

export interface ToolbarHandle {
  destroy(): void;
  /** Re-read `save.isDirty()` and update the Save button's disabled state.
   * Called by the editor on every doc-changed transaction so the button
   * re-enables the moment the user starts typing again. Noop when there is
   * no Save button. */
  refreshSave(): void;
}

const SMALL_SCREEN = "(max-width: 767px)";

/** Mount the floating toolbar inside the `.typodown` wrapper. */
export function createToolbar(
  wrapper: HTMLElement,
  view: EditorView,
  mode: ToolbarMode,
  actions: ToolbarAction[],
  prefs?: Prefs,
  /** Optional Save action appended after the formatting actions, in its own
   * group. Used by hosts that disable auto-save and want an explicit Save
   * button in the toolbar instead. */
  save?: ToolbarSave,
  /** Toggle the document outline panel, rendered in the same rightmost group
   * as the hide-toolbar chevron. Omit when the outline feature is disabled. */
  toggleOutline?: () => void,
  /** Open the find & replace panel. Rendered as a button in the same group as
   * the Save button (the editor's utility actions). Omit to drop the button. */
  openSearch?: () => void,
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

  /** Tapping a button must not move focus out of the editor, or the selection
   * the action applies to would collapse before the click lands.
   */
  const keepFocus = (e: Event): void => e.preventDefault();

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-td-toolbar-btn";
    btn.title = action.shortcut
      ? `${action.label} (${formatShortcut(action.shortcut)})`
      : action.label;
    btn.setAttribute("aria-label", action.label);
    btn.innerHTML = icon(action.icon);
    btn.addEventListener("mousedown", keepFocus);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      action.run(view);
      if (action.refocus === false) {
        // Don't pull focus back into the editor: on mobile that would pop the
        // soft keyboard. Blur it so an already-open keyboard is dismissed too.
        view.contentDOM.blur();
      } else {
        view.focus();
      }
    });
    bar.appendChild(btn);
  }

  bar.appendChild(separator());

  // Utility group: Save. Rendered in its own group set off by separators.
  let saveBtn: HTMLButtonElement | null = null;
  const updateSaveDisabled = (): void => {
    if (!saveBtn || !save) return;
    saveBtn.disabled = save.isDirty ? !save.isDirty() : false;
  };

  if (save) {
    saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "cm-td-toolbar-btn";
    saveBtn.title = "Save";
    saveBtn.setAttribute("aria-label", "Save");
    saveBtn.innerHTML = icon("save");
    saveBtn.addEventListener("mousedown", keepFocus);
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      save.run();
      // Disable immediately: the write is async, and the next doc-changed
      // transaction (when the user types again) re-enables it via
      // `refreshSave`. Stops a rapid double-tap from queuing a second save.
      saveBtn!.disabled = true;
      view.focus();
    });
    bar.appendChild(saveBtn);
    updateSaveDisabled();
  }

  if (save) bar.appendChild(separator());

  // The rightmost group holds the Find button, outline toggle (when present),
  // and the hide-toolbar chevron together: all are UI controls rather than
  // formatting actions, so they share one group with no separators between them.
  if (openSearch) {
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "cm-td-toolbar-btn";
    searchBtn.title = `Find (${formatShortcut("Mod-f")})`;
    searchBtn.setAttribute("aria-label", "Find");
    searchBtn.innerHTML = icon("search");
    searchBtn.addEventListener("mousedown", keepFocus);
    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // Don't refocus the editor: the search panel focuses its own input.
      openSearch();
    });
    bar.appendChild(searchBtn);
  }

  if (toggleOutline) {
    const outlineBtn = document.createElement("button");
    outlineBtn.type = "button";
    outlineBtn.className = "cm-td-toolbar-btn";
    outlineBtn.title = "Toggle outline";
    outlineBtn.setAttribute("aria-label", "Toggle outline");
    outlineBtn.innerHTML = icon("list");
    outlineBtn.addEventListener("mousedown", keepFocus);
    outlineBtn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleOutline();
      // Don't pull focus back into the editor: on mobile that would pop the
      // soft keyboard. Blur it so an already-open keyboard is dismissed too.
      view.contentDOM.blur();
    });
    bar.appendChild(outlineBtn);
  }

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

  const setVisible = (visible: boolean, persist = true): void => {
    anchor.classList.toggle("cm-td-toolbar-anchor-visible", visible);
    bar.style.display = visible ? "" : "none";
    showBtn.style.display = visible ? "none" : "";
    if (persist) prefs?.set("toolbar", visible);
  };
  hideBtn.addEventListener("click", () => {
    setVisible(false);
    view.focus();
  });
  showBtn.addEventListener("click", () => {
    setVisible(true);
    view.focus();
  });

  // A saved preference wins over the mode default; the initial paint must not
  // overwrite that stored value (persist=false).
  const saved = prefs?.get("toolbar");
  const initiallyVisible =
    typeof saved === "boolean"
      ? saved
      : mode === "shown" || (mode === "auto" && window.matchMedia(SMALL_SCREEN).matches);
  setVisible(initiallyVisible, false);

  anchor.appendChild(bar);
  anchor.appendChild(showBtn);
  wrapper.prepend(anchor);

  /** Float the show button in the margin left of the text column: as far out
   * as 2.75rem, but never past the viewport edge (hosts differ in whether the
   * margin comes from page layout, wrapper padding, or nothing at all). The
   * measured offset is published as a CSS variable so host stylesheets can
   * still override `left` outright.
   */
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
    refreshSave: updateSaveDisabled,
  };
}

/** The default action set: classic formatting plus "Add table". The outline
 * toggle is intentionally not part of this list -- it is rendered by
 * `createToolbar` in its own group next to the hide chevron. */
export function defaultToolbarActions(opts: {
  wrapMarker: (marker: string) => (view: EditorView) => void;
  insertLink: (view: EditorView) => void;
  toggleTask: (view: EditorView) => void;
  openTable: (view: EditorView) => void;
}): ToolbarAction[] {
  return [
    { label: "Bold", icon: "bold", run: opts.wrapMarker("**"), shortcut: "Mod-b" },
    { label: "Italic", icon: "italic", run: opts.wrapMarker("*"), shortcut: "Mod-i" },
    { label: "Strikethrough", icon: "strikethrough", run: opts.wrapMarker("~~") },
    { label: "Inline code", icon: "code", run: opts.wrapMarker("`") },
    { label: "Link", icon: "link", run: opts.insertLink, shortcut: "Mod-k" },
    { label: "Checkbox", icon: "checkbox", run: opts.toggleTask, shortcut: "Mod-Shift-x" },
    { label: "Add table", icon: "table", run: opts.openTable, shortcut: "Mod-Shift-t" },
  ];
}

// ---- icons ------------------------------------------------------------------

/** Inline 16px stroke icons (lucide outlines) so the library needs no icon
 * dependency. Rendered with currentColor.
 */
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
  checkbox:
    '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  hide: '<path d="m18 15-6-6-6 6"/>',
  format:
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
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
