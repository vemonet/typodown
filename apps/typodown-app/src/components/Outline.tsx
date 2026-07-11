import { For, Show, type Component } from "solid-js";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { vault } from "@/lib/vault";

interface OutlineProps {
  onJumpToLine?: (line: number) => void;
}

const Outline: Component<OutlineProps> = (props) => {
  const jump = (line: number) => props.onJumpToLine?.(line);

  return (
    <div class="flex h-full flex-col">
      <div class="flex items-center gap-1.5 px-3 pb-2 pt-2">
        <span class="text-xs font-medium tracking-wide text-muted-foreground">Outline</span>
      </div>
      <ScrollArea class="flex-1">
        <Show
          when={vault.currentPath()}
          fallback={
            <div class="px-4 py-12 text-center text-xs text-muted-foreground">No file open.</div>
          }
        >
          <Show
            when={vault.outline().length > 0}
            fallback={
              <div class="px-4 py-12 text-center text-xs text-muted-foreground">
                No headings in this file.
              </div>
            }
          >
            <ul class="px-1.5 pb-4">
              <For each={vault.outline()}>
                {(heading) => (
                  <li>
                    <button
                      type="button"
                      class="flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      style={{ "padding-left": `${(heading.level - 1) * 12 + 8}px` }}
                      onClick={() => jump(heading.line)}
                      title={heading.text}
                    >
                      <span
                        class={cn("truncate", heading.level <= 2 && "font-medium text-foreground")}
                      >
                        {heading.text}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </ScrollArea>
    </div>
  );
};

export default Outline;
