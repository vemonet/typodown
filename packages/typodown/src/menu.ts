// Right-click context menu and the "Add table" dialog.
//
// A `contextmenu` DOM event on the editor opens a small floating menu near the
// cursor. By default it offers "Add table", which opens a dialog asking for a
// row/column count and inserts a fresh GFM table at the caret. Consumers can
// extend or replace the menu via the `menuItems` option (see TypodownOptions).

import { type EditorView } from "@codemirror/view";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";

/** A single entry in the right-click context menu. */
export interface MenuItem {
  /** Visible label (omit for separators). */
  label?: string;
  /**
   * Run when the item is clicked. `pos` is the document offset under the
   * cursor (-1 when the click missed the content).
   */
  action?: (view: EditorView, pos: number) => void;
  /** Render as a non-clickable horizontal separator (ignore `label`/`action`). */
  separator?: boolean;
  /** Greyed-out and non-clickable. */
  disabled?: boolean;
}

/** Context handed to a `MenuItemsProvider`. */
export interface MenuContext {
  view: EditorView;
  /** Document offset under the right-click, or -1 when the click missed the content. */
  pos: number;
  /**
   * Read the clipboard for the built-in "Paste" item. Uses the embedder-provided
   * reader when available (e.g. VS Code webviews where `navigator.clipboard` is
   * blocked), otherwise falls back to `navigator.clipboard.readText()`.
   */
  getClipboardText?: () => string | Promise<string>;
}

/** A function returning the items to show for a given context. Return an empty
 * array to show nothing (the native browser menu is then suppressed too, since
 * `contextmenu` was preventDefaulted; return nothing/empty to opt out entirely). */
export type MenuItemsProvider = (ctx: MenuContext) => MenuItem[];

const MENU_ATTR = "data-td-context-menu";
const DIALOG_ATTR = "data-td-insert-table";

/** Build the markdown source for a GFM table of the given size.
 * `rows` is the number of body rows (a header row is always added on top).
 * `cols` is the number of columns. Both are clamped to a minimum of 1. */
export function tableMarkdown(rows: number, cols: number): string {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(cols));
  const header = "| " + Array(c).fill("").join(" | ") + " |";
  const delim = "| " + Array(c).fill("---").join(" | ") + " |";
  const body = "| " + Array(c).fill("").join(" | ") + " |";
  return [header, delim, ...Array.from({ length: r }, () => body)].join("\n");
}

/** Insert a GFM table of the given size at the caret. The table is placed on its
 * own line (replacing an empty line, or starting a new block below the current
 * line) and the caret lands in the first body cell, ready to type. */
export function insertTable(view: EditorView, rows: number, cols: number): void {
  const md = tableMarkdown(rows, cols);
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const lineIsEmpty = line.text.trim() === "";

  const from = lineIsEmpty ? line.from : line.to;
  const to = line.to;
  const insert = lineIsEmpty ? md : `\n\n${md}`;

  // Place the caret in the first body cell (third line, after "| ").
  const firstNewline = md.indexOf("\n");
  const secondNewline = md.indexOf("\n", firstNewline + 1);
  const firstBodyLineStart = secondNewline + 1;
  const insertOffset = (lineIsEmpty ? 0 : 2) + firstBodyLineStart + 2;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insertOffset },
    userEvent: "input",
    scrollIntoView: true,
  });
}

/** The default context menu items: the native editing actions (Cut, Copy,
 * Paste, Undo, Redo) plus "Add table" which opens the rows/columns dialog.
 * Spread this in your own `menuItems` provider to keep the defaults while adding
 * your own entries. */
export function defaultMenuItems(ctx: MenuContext): MenuItem[] {
  const { view, getClipboardText } = ctx;
  const sel = view.state.selection.main;
  const hasSelection = !sel.empty;
  return [
    { label: "Cut", disabled: !hasSelection, action: () => cutSelection(view) },
    { label: "Copy", disabled: !hasSelection, action: () => copySelection(view) },
    { label: "Paste", action: () => pasteFromClipboard(view, getClipboardText) },
    { separator: true },
    { label: "Undo", disabled: undoDepth(view.state) === 0, action: () => undo(view) },
    { label: "Redo", disabled: redoDepth(view.state) === 0, action: () => redo(view) },
    { separator: true },
    { label: "Add table", action: () => openAddTableDialog(view) },
  ];
}

function openAddTableDialog(view: EditorView): void {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  const x = coords ? coords.left : window.innerWidth / 2;
  const y = coords ? coords.bottom + 4 : window.innerHeight / 2;
  openInsertTableDialog({ x, y }, view, (rows, cols) => insertTable(view, rows, cols));
}

/** Copy the current selection to the clipboard. Uses `document.execCommand` so
 * it works in VS Code webviews (where `navigator.clipboard.writeText` is
 * blocked), falling back to the async Clipboard API. */
export function copySelection(view: EditorView): void {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  view.focus();
  try {
    if (document.execCommand("copy")) return;
  } catch {
    // fall through to the async API
  }
  void navigator.clipboard?.writeText?.(view.state.sliceDoc(sel.from, sel.to));
}

/** Cut the current selection to the clipboard, deleting it from the document. */
export function cutSelection(view: EditorView): void {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  view.focus();
  try {
    if (document.execCommand("cut")) return;
  } catch {
    // fall through to the async API
  }
  const text = view.state.sliceDoc(sel.from, sel.to);
  void navigator.clipboard?.writeText?.(text).then(() => {
    view.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: "delete" });
    view.focus();
  });
}

/** Paste clipboard text at the current selection, replacing it. Uses the
 * embedder-provided `getClipboardText` when given (e.g. VS Code webview),
 * otherwise `navigator.clipboard.readText()`. */
export function pasteFromClipboard(
  view: EditorView,
  getClipboardText?: () => string | Promise<string>,
): void {
  const read = getClipboardText ?? (() => navigator.clipboard?.readText?.() ?? "");
  void Promise.resolve(read())
    .then((text) => {
      if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste" });
      view.focus();
    })
    .catch(() => {
      view.focus();
    });
}

/** Open the context menu at the given screen coordinates. */
export function openContextMenu(
  anchor: { x: number; y: number },
  view: EditorView,
  pos: number,
  items: MenuItem[],
): void {
  closeContextMenu();
  if (items.length === 0) return;

  const menu = document.createElement("div");
  menu.className = "cm-td-context-menu";
  menu.setAttribute(MENU_ATTR, "");
  inheritTheme(menu, view);

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("hr");
      sep.className = "cm-td-context-menu-separator";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-td-context-menu-item";
    btn.textContent = item.label ?? "";
    btn.disabled = !!item.disabled;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const action = item.action;
      closeContextMenu();
      if (action) action(view, pos);
    });
    menu.appendChild(btn);
  }

  menu.style.position = "fixed";
  document.body.appendChild(menu);
  // Clamp into the viewport after measuring.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(anchor.x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(anchor.y + 4, window.innerHeight - rect.height - 8)}px`;

  // Close on the next outside mousedown (deferred so the opening click doesn't
  // immediately close it) and on Escape.
  setTimeout(() => {
    const onDown = (ev: MouseEvent): void => {
      if (!menu.contains(ev.target as Node)) {
        closeContextMenu();
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        closeContextMenu();
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
  }, 0);
}

/** Close any open context menu. */
export function closeContextMenu(): void {
  document.querySelectorAll<HTMLElement>(`[${MENU_ATTR}]`).forEach((m) => m.remove());
}

/** Open a small dialog asking for a row and column count, then call `onConfirm`. */
export function openInsertTableDialog(
  anchor: { x: number; y: number },
  view: EditorView,
  onConfirm: (rows: number, cols: number) => void,
): void {
  closeInsertTableDialog();

  const dialog = document.createElement("div");
  dialog.className = "cm-td-insert-table-dialog";
  dialog.setAttribute(DIALOG_ATTR, "");
  inheritTheme(dialog, view);

  const rowsInput = numberField("Rows", 3, 1, 50);
  const colsInput = numberField("Columns", 3, 1, 20);

  const submit = (): void => {
    const rows = clampInt(rowsInput.value, 1, 50);
    const cols = clampInt(colsInput.value, 1, 20);
    closeInsertTableDialog();
    onConfirm(rows, cols);
  };
  const cancel = (): void => {
    closeInsertTableDialog();
  };

  rowsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  colsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });

  const form = document.createElement("div");
  form.className = "cm-td-insert-table-fields";
  form.appendChild(fieldLabel("Rows", rowsInput));
  form.appendChild(fieldLabel("Columns", colsInput));
  dialog.appendChild(form);

  const actions = document.createElement("div");
  actions.className = "cm-td-insert-table-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cm-td-insert-table-btn cm-td-insert-table-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  });
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "cm-td-insert-table-btn cm-td-insert-table-confirm";
  confirmBtn.textContent = "Insert";
  confirmBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    submit();
  });
  actions.appendChild(confirmBtn);
  dialog.appendChild(actions);

  dialog.style.position = "fixed";
  document.body.appendChild(dialog);
  const rect = dialog.getBoundingClientRect();
  dialog.style.left = `${Math.min(anchor.x, window.innerWidth - rect.width - 8)}px`;
  dialog.style.top = `${Math.min(anchor.y + 4, window.innerHeight - rect.height - 8)}px`;

  rowsInput.focus();
  rowsInput.select();

  // Close on outside click (deferred) and Escape.
  setTimeout(() => {
    const onDown = (ev: MouseEvent): void => {
      if (!dialog.contains(ev.target as Node)) {
        closeInsertTableDialog();
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        closeInsertTableDialog();
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
  }, 0);
}

/** Close any open insert-table dialog. */
export function closeInsertTableDialog(): void {
  document.querySelectorAll<HTMLElement>(`[${DIALOG_ATTR}]`).forEach((d) => d.remove());
}

// ---- helpers --------------------------------------------------------------

/** Copy the theme CSS variables from the `.typodown` wrapper onto a menu/dialog
 * element that lives on `document.body` (outside the wrapper, so it can't
 * inherit them). The variables are scoped to `.typodown` in theme.css. */
function inheritTheme(el: HTMLElement, view: EditorView): void {
  const wrapper = view.dom.closest(".typodown") as HTMLElement | null;
  if (!wrapper) return;
  const style = getComputedStyle(wrapper);
  const names = [
    "--td-fg",
    "--td-bg",
    "--td-border",
    "--td-border-muted",
    "--td-muted",
    "--td-faint",
    "--td-table-header-bg",
    "--td-selection",
    "--td-link",
    "--td-font",
    "--td-mono",
  ];
  for (const name of names) {
    const value = style.getPropertyValue(name);
    if (value) el.style.setProperty(name, value);
  }
}

function numberField(label: string, value: number, min: number, max: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.className = "cm-td-insert-table-input";
  input.setAttribute("aria-label", label);
  return input;
}

function fieldLabel(text: string, input: HTMLInputElement): HTMLElement {
  const label = document.createElement("label");
  label.className = "cm-td-insert-table-field";
  const span = document.createElement("span");
  span.className = "cm-td-insert-table-field-label";
  span.textContent = text;
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

function clampInt(value: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
