import { createEffect, onCleanup, onMount, Show, type Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Typodown, type Theme, type ToolbarSave } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";
import { vault, onContentChange } from "@/lib/vault";
import { IS_TAURI } from "@/lib/tauri";

interface EditorProps {
  theme?: Theme;
  /** When set, the editor toolbar shows a Save button backed by this handle
   * (run callback + dirty getter so it can grey out when nothing to save).
   * Used on Android where auto-save is disabled in favour of an explicit save. */
  save?: ToolbarSave;
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
      // window.open is a no-op in the Tauri webview; route Ctrl/⌘-clicked
      // links to the system browser via the opener plugin.
      openLink: (url) => {
        if (IS_TAURI) void openUrl(url);
        else window.open(url, "_blank", "noopener,noreferrer");
      },
      save: props.save,
    });
    ready = true;
  });

  // React to theme changes.
  createEffect(() => {
    if (!editor) return;
    editor.setTheme(props.theme ?? "auto");
  });

  // React to file opens / switches by pushing the new content into the editor.
  // `ready` is read so we skip the very first run (the editor already opened
  // with the current content in onMount).
  createEffect(() => {
    const content = vault.currentContent();
    if (!ready || !editor) return;
    if (editor.getValue() !== content) editor.setValue(content);
  });

  onCleanup(() => {
    editor?.destroy();
    editor = undefined;
  });

  return (
    <div class="relative h-full overflow-hidden bg-background">
      <div ref={hostRef} class="h-full" />
      <Show when={!vault.currentPath()}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div class="text-center">
            <p class="text-sm text-muted-foreground">No file selected</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Open a folder or a markdown file from the sidebar.
            </p>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Editor;
