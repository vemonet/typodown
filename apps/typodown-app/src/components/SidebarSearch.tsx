import { createEffect, For, on, onCleanup, onMount, Show, type Component } from "solid-js";
import { CaseSensitive, ChevronDown, ChevronRight, Replace, ReplaceAll } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { vault, openFile, showEditor } from "@/lib/vault";
import {
  search,
  closeSearch,
  refreshSearch,
  replaceAll,
  replaceHit,
  setMatchCase,
  setQuery,
  setReplacementText,
  setSelectedHit,
  toggleReplace,
  type SearchHit,
} from "@/lib/search";
import { highlightEditorMatches, revealEditorMatch } from "@/components/Editor";

/** Vault-wide find & replace, shown in place of the file tree while the
 * explorer's search button is toggled on. Only mounted then: the query and its
 * results live in the search module, so toggling back and forth is free. */
export const SearchPanel: Component = () => {
  let input: HTMLInputElement | undefined;

  onMount(() => {
    // The tree may have changed while search was hidden, so start from disk.
    refreshSearch();
    input?.focus();
    input?.select();
  });

  // Files may have been added, removed or changed outside the app; the tree
  // signal is the app's notification that this happened.
  createEffect(on(vault.tree, () => refreshSearch(), { defer: true }));

  // Keep the open file's match highlights in sync with the query, so the editor
  // lights up the same occurrences the sidebar lists - and goes quiet when the
  // panel is closed.
  createEffect(() => highlightEditorMatches(search.query(), search.matchCase()));
  onCleanup(() => highlightEditorMatches("", false));

  const selectedHit = () => search.hits()[search.selected()];

  return (
    <>
      <div class="flex flex-col gap-1.5 px-2 pb-2">
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="sm"
              class="size-7 shrink-0 px-0 text-muted-foreground"
              aria-label="Toggle replace"
              aria-expanded={search.showReplace()}
              onClick={toggleReplace}
            >
              <Show when={search.showReplace()} fallback={<ChevronRight class="size-3.5" />}>
                <ChevronDown class="size-3.5" />
              </Show>
            </TooltipTrigger>
            <TooltipContent>
              {search.showReplace() ? "Hide replace" : "Show replace"}
            </TooltipContent>
          </Tooltip>
          <div class="relative min-w-0 flex-1">
            <input
              ref={input}
              class="h-7 w-full rounded-md border border-input bg-background pl-2 pr-8 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="Search in vault"
              aria-label="Search in vault"
              spellcheck={false}
              value={search.query()}
              disabled={!vault.vaultRoot()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  closeSearch();
                } else if (e.key === "Enter") {
                  const hit = selectedHit();
                  if (hit) void openHit(hit);
                }
              }}
            />
            <Tooltip>
              <TooltipTrigger
                as="button"
                type="button"
                class={cn(
                  "absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm transition-colors",
                  search.matchCase()
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent",
                )}
                aria-label="Match case"
                aria-pressed={search.matchCase()}
                onClick={() => setMatchCase(!search.matchCase())}
              >
                <CaseSensitive class="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Match case</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Show when={search.showReplace()}>
          <div class="flex items-center gap-1 pl-8">
            <input
              class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              placeholder="Replace with"
              aria-label="Replace with"
              spellcheck={false}
              value={search.replacement()}
              onInput={(e) => setReplacementText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const hit = selectedHit();
                  if (hit) void replaceHit(hit);
                }
              }}
            />
            <Tooltip>
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="sm"
                class="size-7 shrink-0 px-0"
                aria-label="Replace"
                disabled={!selectedHit()}
                onClick={() => {
                  const hit = selectedHit();
                  if (hit) void replaceHit(hit);
                }}
              >
                <Replace class="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Replace the selected hit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="sm"
                class="size-7 shrink-0 px-0"
                aria-label="Replace all"
                disabled={search.hits().length === 0}
                onClick={() => void replaceAll()}
              >
                <ReplaceAll class="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Replace every hit in the vault</TooltipContent>
            </Tooltip>
          </div>
        </Show>
      </div>

      <SearchResults />
    </>
  );
};

/** Open the file a hit belongs to and scroll its line into view. */
async function openHit(hit: SearchHit): Promise<void> {
  showEditor();
  if (vault.currentPath() !== hit.path) await openFile(hit.path);
  // The editor takes the new content from a Solid effect; reveal and select the
  // match once that has landed.
  requestAnimationFrame(() => {
    highlightEditorMatches(search.query(), search.matchCase());
    revealEditorMatch(hit.line, hit.column, search.query().length);
  });
}

/** "3 results in 2 files", or "No results" when the scan came back empty. */
function resultSummary(): string {
  if (!search.active()) return "Type to search every markdown file in the vault";
  const count = search.hits().length;
  if (count === 0) return "No results";
  const files = new Set(search.hits().map((h) => h.path)).size;
  const more = search.truncated() ? "+" : "";
  return `${count}${more} ${count === 1 ? "result" : "results"} in ${files} ${
    files === 1 ? "file" : "files"
  }`;
}

/** The result list, under the search inputs. */
const SearchResults: Component = () => {
  return (
    <ScrollArea class="flex-1">
      <div class="px-3 py-1 text-xs text-muted-foreground">
        <Show when={!search.running()} fallback="Searching…">
          {resultSummary()}
        </Show>
      </div>
      <ul class="px-1.5 pb-4">
        <For each={search.hits()}>{(hit, index) => <ResultRow hit={hit} index={index()} />}</For>
      </ul>
      <Show when={search.truncated()}>
        <p class="px-3 pb-3 text-xs text-muted-foreground">
          Showing the first {search.hits().length} hits; refine the search to see the rest.
        </p>
      </Show>
    </ScrollArea>
  );
};

const ResultRow: Component<{ hit: SearchHit; index: number }> = (props) => {
  const isSelected = () => search.selected() === props.index;
  // Long lines are clipped around the match so it stays visible.
  const snippet = () => {
    const { text, column } = props.hit;
    const start = Math.max(0, column - 24);
    const end = column + search.query().length;
    return {
      before: (start > 0 ? "…" : "") + text.slice(start, column),
      match: text.slice(column, end),
      after: text.slice(end, end + 80),
    };
  };

  return (
    <li>
      <button
        type="button"
        class={cn(
          "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-sidebar-accent/60",
          isSelected() && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        onClick={() => {
          setSelectedHit(props.index);
          void openHit(props.hit);
        }}
      >
        <span class="w-full truncate text-xs">
          {snippet().before}
          <mark class="rounded-[2px] bg-primary/30 px-0.5 text-inherit">{snippet().match}</mark>
          {snippet().after}
        </span>
        <span class="w-full truncate text-[11px] text-muted-foreground">
          {props.hit.name} · line {props.hit.line}
        </span>
      </button>
    </li>
  );
};
