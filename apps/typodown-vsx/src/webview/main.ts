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

/* Inset the editor without creating a second scrolling surface.
 *
 * The side inset lives on .cm-content, not on the wrapper. Padding the wrapper
 * moves the whole editor in, which takes the CodeMirror scroller's right edge
 * (and the vertical scrollbar on it) away from the window edge, leaving the bar
 * floating in the middle of the page. Putting it on .cm-content indents only the
 * text, so the scroller still spans the full width and its scrollbar stays glued
 * to the right. The desktop app's App.css does the same thing for the same
 * reason, and outline.ts reserves its docked-panel space inside the scroller
 * rather than on the wrapper for this exact reason too. */
.typodown {
  padding: 0 0 2rem;
}

.typodown .cm-content {
  padding-left: max(1.5rem, 4vw);
  padding-right: max(1.5rem, 4vw);
}

/* Scrollbars follow the selected Typodown theme, not VS Code's.
 *
 * VS Code sets \`html { scrollbar-color: var(--vscode-scrollbarSlider-background)
 * ... }\` in the content frame, inside @layer vscode-default. It is inherited, so
 * it reaches every scroller in the editor, and a non-auto value makes Chromium
 * ignore ::-webkit-scrollbar-* rules -- overriding those does nothing here.
 * Setting the same property works, since an unlayered rule wins over any layer.
 * In "follow editor theme" mode the VS Code colours are the right ones. */
.typodown:not(.td-vscode) {
  scrollbar-color: color-mix(in srgb, var(--td-faint) 45%, transparent) transparent;
}

/* scrollbar-width does not inherit, so it has to reach the scrollers themselves.
 * The toolbar is excluded because it sets \`none\` to hide its own overflow. */
.typodown:not(.td-vscode) :not(.cm-td-toolbar) {
  scrollbar-width: thin;
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
let imageBaseUri = "";

function resolveImageSrc(src: string): string {
  if (!imageBaseUri || !src || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(src)) return src;
  try {
    return new URL(src, imageBaseUri).toString();
  } catch {
    return src;
  }
}

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
  resolveImageSrc,
  // VS Code webviews block window.open, so route Ctrl/⌘-clicked links through
  // the extension host, which opens them with vscode.env.openExternal.
  openLink: (url) => send({ type: "openLink", url }),
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

  // Built-in themes scope their variables to the editor wrapper. Mirror the
  // resolved surface colour onto the webview so the area around short
  // documents always matches the selected editor theme.
  const background = getComputedStyle(editor.wrapper).getPropertyValue("--td-bg").trim();
  document.documentElement.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
  host.style.backgroundColor = background;
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
    imageBaseUri = message.imageBaseUri;
    editor.setJoinSoftBreaks(message.joinSoftBreaks);
    editor.setTabSize(message.tabSize);
    applyTheme();
    setContent(message.text);
    ready = true;
  } else if (message.type === "update") {
    if (message.text !== editor.getValue()) setContent(message.text);
  } else if (message.type === "theme") {
    themeSetting = message.theme;
    applyTheme();
  } else if (message.type === "joinSoftBreaks") {
    editor.setJoinSoftBreaks(message.join);
  } else if (message.type === "tabSize") {
    editor.setTabSize(message.size);
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
