// Floating formatting toolbar.
//
// A light pill-shaped action bar floating at the top of the editor: history
// (undo / redo), the classic formatting actions (bold, italic, strikethrough,
// inline code, link, checkbox, table), then the editor's own utilities (find,
// save, raw Markdown) and view toggles (outline, hide). It can be hidden; while
// hidden a small round button floats in the top-left margin to bring it back.
// By default it starts visible everywhere; hosts can force "auto" (visible only
// on small screens) or "hidden" via the `toolbar` option.
//
// Every button -- formatting or utility -- is one `ToolbarAction`, so state
// (disabled / pressed), tooltips and focus handling are implemented once.

import { type EditorView } from "@codemirror/view";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { type Prefs } from "./prefs.ts";

/** Visibility policy for the floating toolbar.
 * - "shown" (default): starts visible everywhere.
 * - "auto": starts visible on small screens, hidden on large ones.
 * - "hidden": starts hidden everywhere.
 * The user can always toggle it with the floating button. */
export type ToolbarMode = "auto" | "shown" | "hidden";

export interface ToolbarAction {
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
   * editor is blurred so any open keyboard is dismissed too. */
  refocus?: boolean;
  /** Greys the button out while this returns false. Re-read by `refresh()`. */
  enabled?: () => boolean;
  /** Renders the button pressed while this returns true (a mode toggle rather
   * than a one-shot action). Re-read by `refresh()`. */
  active?: () => boolean;
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

export interface ToolbarOptions {
  mode: ToolbarMode;
  /** The formatting actions, rendered as the second group. */
  actions: ToolbarAction[];
  prefs?: Prefs;
  /** Optional Save action, grouped with the editor's other utilities. Used by
   * hosts that disable auto-save and want an explicit Save button. */
  save?: ToolbarSave;
  /** Open the find & replace panel. Omit to drop the button. */
  openSearch?: () => void;
  /** Toggle raw Markdown source mode, and report whether it is currently on so
   * the button can render pressed. Omit to drop the button. */
  rawMarkdown?: { toggle: () => void; isRaw: () => boolean };
  /** Toggle the document outline panel. Omit when the outline is disabled. */
  toggleOutline?: () => void;
}

export interface ToolbarHandle {
  destroy(): void;
  /** Re-read every action's `enabled()` / `active()` state (Save's dirty flag,
   * undo/redo depth, raw mode). Called by the editor on every doc-changed
   * transaction so the buttons track the document. */
  refresh(): void;
}

const SMALL_SCREEN = "(max-width: 767px)";

/** Mount the floating toolbar inside the `.typodown` wrapper. */
export function createToolbar(
  wrapper: HTMLElement,
  view: EditorView,
  options: ToolbarOptions,
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

  // The bar scrolls horizontally when it doesn't fit, which clips anything
  // painted inside it, and native `title` tooltips don't show in every host
  // (notably a VS Code webview). So tooltips are our own element, parked in the
  // zero-height anchor next to the bar and positioned under the hovered button.
  const tip = document.createElement("div");
  tip.className = "cm-td-toolbar-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;

  const showTip = (btn: HTMLElement, text: string): void => {
    tip.textContent = text;
    tip.hidden = false;
    const anchorBox = anchor.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    // Centre under the button, clamped to the anchor so it can't overflow the
    // editor's edges.
    const left = btnBox.left - anchorBox.left + btnBox.width / 2 - tip.offsetWidth / 2;
    const max = anchorBox.width - tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(left, Math.max(0, max)))}px`;
    tip.style.top = `${btnBox.bottom - anchorBox.top + 6}px`;
  };
  const hideTip = (): void => {
    tip.hidden = true;
  };

  /** Tapping a button must not move focus out of the editor, or the selection
   * the action applies to would collapse before the click lands.
   */
  const keepFocus = (e: Event): void => e.preventDefault();

  /** All the buttons with dynamic state, refreshed together. */
  const stateful: { btn: HTMLButtonElement; action: ToolbarAction }[] = [];
  /** Set while a save has been requested but no edit has landed since. */
  let savePending = false;

  const refresh = (): void => {
    for (const { btn, action } of stateful) {
      if (action.enabled) btn.disabled = !action.enabled();
      if (action.active) btn.setAttribute("aria-pressed", String(action.active()));
    }
  };

  const button = (action: ToolbarAction): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-td-toolbar-btn";
    const hint = action.shortcut
      ? `${action.label} (${formatShortcut(action.shortcut)})`
      : action.label;
    btn.setAttribute("aria-label", action.label);
    btn.innerHTML = icon(action.icon);
    btn.addEventListener("mousedown", keepFocus);
    btn.addEventListener("pointerenter", () => showTip(btn, hint));
    btn.addEventListener("pointerleave", hideTip);
    btn.addEventListener("focus", () => showTip(btn, hint));
    btn.addEventListener("blur", hideTip);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      hideTip();
      action.run(view);
      if (action.refocus === false) {
        // Don't pull focus back into the editor: on mobile that would pop the
        // soft keyboard. Blur it so an already-open keyboard is dismissed too.
        view.contentDOM.blur();
      } else {
        view.focus();
      }
      refresh();
    });
    if (action.enabled || action.active) stateful.push({ btn, action });
    return btn;
  };

  const setVisible = (visible: boolean, persist = true): void => {
    anchor.classList.toggle("cm-td-toolbar-anchor-visible", visible);
    bar.style.display = visible ? "" : "none";
    showBtn.style.display = visible ? "none" : "";
    hideTip();
    if (persist) options.prefs?.set("toolbar", visible);
  };

  // History first, then the formatting actions, then the editor's utilities and
  // the view toggles: one group per run of related buttons, separated by a rule.
  const history: ToolbarAction[] = [
    {
      label: "Undo",
      icon: "undo",
      shortcut: "Mod-z",
      run: (v) => void undo(v),
      enabled: () => undoDepth(view.state) > 0,
    },
    {
      label: "Redo",
      icon: "redo",
      shortcut: "Mod-Shift-z",
      run: (v) => void redo(v),
      enabled: () => redoDepth(view.state) > 0,
    },
  ];
  const utilities: ToolbarAction[] = [];
  if (options.openSearch) {
    utilities.push({
      label: "Find",
      icon: "search",
      shortcut: "Mod-f",
      // The search panel focuses its own input, so don't refocus the editor.
      refocus: false,
      run: options.openSearch,
    });
  }
  if (options.save) {
    const save = options.save;
    utilities.push({
      label: "Save",
      icon: "save",
      run: () => {
        save.run();
        // The write is async, and `refresh()` runs right after the click: latch
        // the button off so a rapid double-tap can't queue a second save. The
        // next document change clears the latch (see the returned `refresh`).
        savePending = true;
      },
      enabled: () => !savePending && (save.isDirty?.() ?? true),
    });
  }
  if (options.rawMarkdown) {
    const raw = options.rawMarkdown;
    utilities.push({
      label: "Raw Markdown",
      icon: "raw",
      shortcut: "Mod-/",
      run: raw.toggle,
      active: raw.isRaw,
    });
  }
  // View toggles: they change what is on screen rather than the document, so
  // the hide chevron belongs here too, last.
  const toggles: ToolbarAction[] = [];
  if (options.toggleOutline) {
    toggles.push({
      label: "Toggle outline",
      icon: "list",
      // Don't pull focus back into the editor: on mobile that would pop the
      // soft keyboard.
      refocus: false,
      run: options.toggleOutline,
    });
  }
  toggles.push({ label: "Hide toolbar", icon: "hide", run: () => setVisible(false) });

  for (const group of [history, options.actions, utilities, toggles]) {
    if (group.length === 0) continue;
    if (bar.childElementCount > 0) bar.appendChild(separator());
    for (const action of group) bar.appendChild(button(action));
  }

  const showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.className = "cm-td-toolbar-show";
  showBtn.title = "Show toolbar";
  showBtn.setAttribute("aria-label", "Show toolbar");
  showBtn.innerHTML = icon("format");
  showBtn.addEventListener("mousedown", keepFocus);

  showBtn.addEventListener("click", () => {
    setVisible(true);
    view.focus();
  });

  // A saved preference wins over the mode default; the initial paint must not
  // overwrite that stored value (persist=false).
  const stored = options.prefs?.get("toolbar");
  const initiallyVisible =
    typeof stored === "boolean"
      ? stored
      : options.mode === "shown" ||
        (options.mode === "auto" && window.matchMedia(SMALL_SCREEN).matches);
  setVisible(initiallyVisible, false);
  refresh();

  anchor.append(bar, showBtn, tip);
  wrapper.prepend(anchor);

  return {
    destroy() {
      anchor.remove();
    },
    refresh() {
      savePending = false; // the document changed, so there is something to save
      refresh();
    },
  };
}

/** The default action set: classic formatting plus "Add table". History,
 * utilities and view toggles are rendered by `createToolbar` in their own
 * groups. */
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
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  raw: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 12.5-2 2.5 2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>',
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
