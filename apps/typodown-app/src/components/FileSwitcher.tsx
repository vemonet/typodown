import { createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { FileText } from "lucide-solid";
import { cn } from "@/lib/utils";
import { vault, openFile, showEditor } from "@/lib/vault";

/** Ctrl+Tab switcher over the open files, in most-recently-used order.
 *
 * Holding Ctrl and pressing Tab walks a snapshot of the MRU list (Shift+Tab
 * walks back) without touching the editor; releasing Ctrl opens the highlighted
 * file, which is what promotes it to the front of the MRU. Cycling on a live
 * list would just toggle between two files, and opening on every Tab would
 * re-read files from disk. */
const FileSwitcher: Component = () => {
  const [order, setOrder] = createSignal<string[] | null>(null);
  const [index, setIndex] = createSignal(0);

  const stop = () => {
    setOrder(null);
    setIndex(0);
  };

  const commit = () => {
    const list = order();
    const target = list?.[index()];
    stop();
    if (!target) return;
    showEditor();
    if (target !== vault.currentPath()) void openFile(target);
  };

  onMount(() => {
    // Capture phase: the editor's own key handling runs on the document and
    // would otherwise swallow Tab.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && order()) {
        e.preventDefault();
        stop();
        return;
      }
      if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey) return;
      const list = order() ?? vault.openPaths();
      if (list.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      if (!order()) {
        setOrder(list);
        setIndex(e.shiftKey ? list.length - 1 : 1);
        return;
      }
      const step = e.shiftKey ? -1 : 1;
      setIndex((i) => (i + step + list.length) % list.length);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (order() && (e.key === "Control" || !e.ctrlKey)) commit();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    // Losing focus (e.g. the OS taking over) never delivers the keyup.
    window.addEventListener("blur", stop);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
    });
  });

  return (
    <Show when={order()}>
      {(list) => (
        <div class="fixed inset-0 z-100 flex items-center justify-center bg-black/20">
          <div class="max-h-[70vh] w-[22rem] max-w-[90vw] overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg">
            <For each={list()}>
              {(path, i) => (
                <div
                  class={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    i() === index() && "bg-accent text-accent-foreground",
                  )}
                >
                  <FileText class="size-4 shrink-0 text-muted-foreground" />
                  <span class="truncate">{fileName(path)}</span>
                  <Show when={vault.isDirty(path)}>
                    <span class="ml-auto size-1.5 shrink-0 rounded-full bg-foreground/60" />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
};

function fileName(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

export default FileSwitcher;
