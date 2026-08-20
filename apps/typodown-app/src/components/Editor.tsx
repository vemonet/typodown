import { createEffect, onCleanup, onMount, Show, type Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Typodown, type Theme, type ToolbarSave } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";
import { vault, onContentChange } from "@/lib/vault";
import { settings } from "@/lib/settings";
import { IS_TAURI, resolveLocalImageSrc } from "@/lib/tauri";

interface EditorProps {
  theme?: Theme;
  /** When set, the editor toolbar shows a Save button backed by this handle
   * (run callback + dirty getter so it can grey out when nothing to save).
   * Used on Android where auto-save is disabled in favour of an explicit save. */
  save?: ToolbarSave;
}

/** The mounted editor, so hosts outside the component tree (the sidebar's
 * search results) can reveal a line without prop-drilling a handle. There is
 * only ever one editor. */
let active: Typodown | undefined;

/** Scroll to a search hit and select it, so the user sees which occurrence the
 * clicked row points at. */
export function revealEditorMatch(line: number, column: number, length: number): void {
  active?.selectRange(line, column, length);
}

/** Light up every occurrence of the sidebar's query in the open file. Called
 * with an empty query to clear the highlights. */
export function highlightEditorMatches(query: string, caseSensitive: boolean): void {
  active?.highlightMatches(query, caseSensitive);
}

const Editor: Component<EditorProps> = (props) => {
  let hostRef: HTMLDivElement | undefined;
  let editor: Typodown | undefined;
  let ready = false;

  onMount(() => {
    if (!hostRef) return;
    editor = new Typodown(hostRef, {
      value: vault.currentContent(),
      theme: props.theme ?? "auto",
      placeholder: "Open a markdown file to start writing…",
      onChange: onContentChange,
      resolveImageSrc: (src) => resolveLocalImageSrc(src, vault.currentPath()),
      // window.open is a no-op in the Tauri webview; route Ctrl/⌘-clicked
      // links to the system browser via the opener plugin.
      openLink: (url) => {
        if (IS_TAURI) void openUrl(url);
        else window.open(url, "_blank", "noopener,noreferrer");
      },
      save: props.save,
      joinSoftBreaks: settings.joinSoftBreaks(),
    });
    active = editor;
    ready = true;
  });

  // React to theme changes.
  createEffect(() => {
    if (!editor) return;
    editor.setTheme(props.theme ?? "auto");
  });

  // React to the wrapped-lines setting being toggled from the sidebar.
  createEffect(() => {
    const join = settings.joinSoftBreaks();
    if (!ready || !editor) return;
    editor.setJoinSoftBreaks(join);
  });

  // React to file opens / switches by pushing the new content into the editor.
  // `ready` is read so we skip the very first run (the editor already opened
  // with the current content in onMount).
  createEffect(() => {
    const content = vault.currentContent();
    vault.currentPath();
    if (!ready || !editor) return;
    if (editor.getValue() !== content) editor.setValue(content);
    editor.refreshPreview();
  });

  onCleanup(() => {
    editor?.destroy();
    if (active === editor) active = undefined;
    editor = undefined;
  });

  return (
    <div class="relative h-full overflow-hidden bg-background">
      <div ref={hostRef} class="h-full" />
      <Show when={!vault.currentPath()}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div class="text-center">
            <Show
              when={vault.opening()}
              fallback={
                <>
                  <p class="text-sm text-muted-foreground">No file selected</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Open a folder or a markdown file from the sidebar.
                  </p>
                </>
              }
            >
              {(path) => (
                <>
                  <p class="text-sm text-muted-foreground">Opening {fileName(path())}…</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Files stored in the cloud have to download first.
                  </p>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

function fileName(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

export default Editor;
