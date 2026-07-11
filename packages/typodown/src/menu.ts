// The "Add table" dialog and table-insertion helpers.
//
// The editor deliberately does NOT redefine the right-click / long-press menu:
// the browser's native menu keeps native copy/paste working everywhere
// (especially mobile, where the selection toolbar is the only way to paste).
// "Add table" is reachable from the floating toolbar instead (see toolbar.ts).

import { type EditorView } from "@codemirror/view";

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

/** Copy the theme CSS variables from the `.typodown` wrapper onto a dialog
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
