import { createEffect, onCleanup, onMount, Show, type Component } from "solid-js";
import { Typodown, type Theme } from "@vemonet/typodown";
import "@vemonet/typodown/style.css";
import { vault, onContentChange } from "@/lib/vault";

interface EditorProps {
  theme?: Theme;
  /** Ref callback that receives the Typodown instance so the parent can call
   * scrollToLine on outline clicks. */
  onReady?: (editor: Typodown) => void;
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
    });
    ready = true;
    props.onReady?.(editor);
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
