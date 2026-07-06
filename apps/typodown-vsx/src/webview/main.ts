import { createTypodown } from "@vemonet/typodown";
import themeCss from "@vemonet/typodown/style.css";
import type { HostMessage, ThemeSetting, WebviewMessage } from "../protocol.ts";

const vscodeApi = acquireVsCodeApi();

function send(message: WebviewMessage): void {
  vscodeApi.postMessage(message);
}

// The editor's own stylesheet, plus a mapping of Typodown's theme variables onto
// VS Code's theme colours. The mapping applies only when the wrapper has the
// `td-vscode` class (the "follow editor theme" setting), so the editor adopts
// whatever colour theme the user has active in VS Code.
const VSCODE_THEME_CSS = `
.typodown.td-vscode {
  --td-fg: var(--vscode-editor-foreground);
  --td-bg: var(--vscode-editor-background);
  --td-muted: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
  --td-faint: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
  --td-border: var(--vscode-widget-border, var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(128,128,128,0.35))));
  --td-border-muted: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.25)));
  --td-link: var(--vscode-textLink-foreground);
  --td-code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
  --td-code-fg: var(--vscode-editor-foreground);
  --td-block-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
  --td-table-header-bg: var(--vscode-editorInlayHint-background, var(--vscode-textCodeBlock-background, rgba(128,128,128,0.18)));
  --td-table-alt-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
  --td-selection: var(--vscode-editor-selectionBackground);
}

/* Inset the editor surface so markdown lines don't stretch to the pane edges.
 * Applies regardless of theme setting. Padding (not margin) on the wrapper so
 * the editor background still fills the full width. */
.typodown {
  padding: 0 max(1.5rem, 4vw) 2rem;
}`;

for (const css of [themeCss, VSCODE_THEME_CSS]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

// Is VS Code currently showing a light theme? (It sets a class on <body>.)
function vscodeIsLight(): boolean {
  return document.body.classList.contains("vscode-light");
}

const host = document.getElementById("app")!;

// `ready` stays false until the host sends the initial content, so the editor's
// own construction/`setValue` calls never post an edit back (which would clobber
// the file on open). `applying` suppresses the echo during host-driven updates.
let ready = false;
let applying = false;
let themeSetting: ThemeSetting = "editor";

// VS Code webviews block navigator.clipboard, so read it from the extension
// host (vscode.env.clipboard) via a request/response round-trip.
let pendingClipboard: ((text: string) => void) | null = null;
function readClipboard(): Promise<string> {
  return new Promise((resolve) => {
    pendingClipboard = resolve;
    send({ type: "clipboard" });
    setTimeout(() => {
      if (pendingClipboard) {
        pendingClipboard = null;
        resolve("");
      }
    }, 1000);
  });
}

const editor = createTypodown(host, {
  value: "",
  theme: "dark",
  getClipboardText: readClipboard,
  onChange: (text) => {
    if (ready && !applying) send({ type: "edit", text });
  },
});

// Apply the current theme setting. In "editor" mode the `td-vscode` class maps
// our variables onto VS Code's colours; we still pick a light/dark base so the
// bits not covered by that mapping (syntax highlighting, alert accents) match.
function applyTheme(): void {
  if (themeSetting === "editor") {
    editor.wrapper.classList.add("td-vscode");
    editor.setTheme(vscodeIsLight() ? "light" : "dark");
  } else {
    editor.wrapper.classList.remove("td-vscode");
    editor.setTheme(themeSetting);
  }
}

function setContent(text: string): void {
  applying = true;
  editor.setValue(text);
  applying = false;
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    themeSetting = message.theme;
    applyTheme();
    setContent(message.text);
    ready = true;
  } else if (message.type === "update") {
    if (message.text !== editor.getValue()) setContent(message.text);
  } else if (message.type === "theme") {
    themeSetting = message.theme;
    applyTheme();
  } else if (message.type === "clipboard") {
    pendingClipboard?.(message.text);
    pendingClipboard = null;
  }
});

// React to VS Code theme switches (light <-> dark) without reloading.
new MutationObserver(() => applyTheme()).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});

applyTheme();
editor.focus();
send({ type: "ready" });
