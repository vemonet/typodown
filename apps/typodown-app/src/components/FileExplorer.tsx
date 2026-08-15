import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
  untrack,
} from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import {
  ChevronRight,
  Bot,
  BookOpenText,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  BookOpen,
  Handshake,
  ListTree,
  ListTodo,
  Pencil,
  Share2,
  Sun,
  Moon,
  Monitor,
  Palette,
  ScrollText,
} from "lucide-solid";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type TreeNode } from "@/lib/tauri";
import {
  vault,
  openFolder,
  openFile,
  showGraph,
  showEditor,
  renameEntry,
  copyFileToClipboard,
} from "@/lib/vault";
import { useColorMode } from "@/components/color-mode";

// Context-menu + inline-rename state, module level so the recursive TreeRow
// doesn't need prop drilling.
const [ctxMenu, setCtxMenu] = createSignal<{
  x: number;
  y: number;
  path: string;
  isDir: boolean;
} | null>(null);
const [renaming, setRenaming] = createSignal<string | null>(null);

const markdownFileIcons: Record<string, Component<{ class?: string }>> = {
  "readme.md": BookOpenText,
  "contributing.md": Handshake,
  "todo.md": ListTodo,
  "claude.md": Bot,
  "agents.md": Bot,
  "log.md": ScrollText,
  "index.md": ListTree,
};

const MarkdownFileIcon: Component<{ name: string; active?: boolean }> = (props) => {
  return (
    <Dynamic
      component={markdownFileIcons[props.name.toLowerCase()] ?? FileText}
      class={cn(
        "size-4 shrink-0",
        props.active ? "text-sidebar-accent-foreground" : "text-muted-foreground",
      )}
    />
  );
};

interface FileExplorerProps {
  onOpenFile?: (path: string) => void;
}

const FileExplorer: Component<FileExplorerProps> = (props) => {
  const { colorMode, setColorMode } = useColorMode();

  const handleFile = (path: string) => {
    void openFile(path);
    showEditor();
    props.onOpenFile?.(path);
  };

  const toggleGraph = () => {
    if (vault.view() === "graph") showEditor();
    else showGraph();
  };

  return (
    <div class="flex h-full flex-col text-sidebar-foreground">
      <div class="flex items-center gap-1.5 px-3 pb-2 pt-2">
        <Show when={vault.vaultRoot()}>
          <BookOpen class="size-3.5 shrink-0 text-muted-foreground" />
          <Tooltip>
            <TooltipTrigger as="span" class="truncate text-sm font-medium">
              {vaultRootName()}
            </TooltipTrigger>
            <TooltipContent>{vault.vaultRoot()}</TooltipContent>
          </Tooltip>
        </Show>
      </div>

      <div class="flex items-center gap-1.5 px-2 pb-2">
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="outline"
            size="sm"
            class="h-7 flex-1 text-xs"
            onClick={() => void openFolder()}
          >
            <FolderPlus />
            Open folder
          </TooltipTrigger>
          <TooltipContent>Open a folder containing markdown files</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant={vault.view() === "graph" ? "default" : "outline"}
            size="sm"
            class="h-7 w-7 shrink-0 px-0"
            aria-label="Graph view"
            disabled={!vault.vaultRoot()}
            onClick={toggleGraph}
          >
            <Share2 class="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Toggle the link graph</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              as={DropdownMenuTrigger}
              class={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-7 w-7 shrink-0 px-0",
              )}
              aria-label="Toggle theme"
            >
              {colorMode() === "dark" ? (
                <Moon class="size-3.5" />
              ) : colorMode() === "system" ? (
                <Monitor class="size-3.5" />
              ) : colorMode() === "light" ? (
                <Sun class="size-3.5" />
              ) : (
                <Palette class="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipContent>Toggle theme</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setColorMode("light")}>
              <Sun class="mr-2 size-3.5" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorMode("dark")}>
              <Moon class="mr-2 size-3.5" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorMode("system")}>
              <Monitor class="mr-2 size-3.5" />
              System
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorMode("dracula")}>
              <Palette class="mr-2 size-3.5" />
              Dracula
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorMode("nord")}>
              <Palette class="mr-2 size-3.5" />
              Nord
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorMode("solarized-light")}>
              <Palette class="mr-2 size-3.5" />
              Solarized Light
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorMode("solarized-dark")}>
              <Palette class="mr-2 size-3.5" />
              Solarized Dark
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea class="flex-1">
        <Show when={vault.vaultRoot()} fallback={<EmptyState />}>
          <Show when={vault.error()}>
            <div class="px-3 py-2 text-xs text-destructive">{vault.error()}</div>
          </Show>
          <ul class="px-1.5 pb-4">
            <For each={vault.tree()}>
              {(node) => <TreeRow node={node} depth={0} onOpenFile={handleFile} />}
            </For>
          </ul>
        </Show>
      </ScrollArea>

      <FileContextMenu />
    </div>
  );
};

/** Right-click menu for file rows. Rendered in a portal (fixed positioning
 * would otherwise be trapped by the sidebar's transformed/overflow parents);
 * the full-screen overlay closes it on any outside click. */
const FileContextMenu: Component = () => {
  createEffect(() => {
    if (!ctxMenu()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={ctxMenu()}>
      {(menu) => (
        <Portal>
          <div
            class="fixed inset-0 z-50"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          >
            <div
              class="absolute min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              style={{
                left: `${Math.min(menu().x, window.innerWidth - 176)}px`,
                top: `${Math.min(menu().y, window.innerHeight - 88)}px`,
              }}
            >
              <ContextItem icon={Pencil} label="Rename" onClick={() => setRenaming(menu().path)} />
              <Show when={!menu().isDir}>
                <ContextItem
                  icon={Copy}
                  label="Copy file"
                  onClick={() => void copyFileToClipboard(menu().path)}
                />
              </Show>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
};

const ContextItem: Component<{
  icon: Component<{ class?: string }>;
  label: string;
  onClick: () => void;
}> = (props) => {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={() => {
        // Run the action before closing the menu: closing unmounts the <Show>
        // whose menu() accessor the action's closure reads.
        props.onClick();
        setCtxMenu(null);
      }}
    >
      <Dynamic component={props.icon} class="size-3.5 text-muted-foreground" />
      {props.label}
    </button>
  );
};

const TreeRow: Component<{
  node: TreeNode;
  depth: number;
  onOpenFile: (path: string) => void;
}> = (props) => {
  const node = untrack(() => props.node);
  const [open, setOpen] = createSignal(true);
  const isActive = () => vault.currentPath() === node.path;

  return (
    <>
      {node.isDir ? (
        <li>
          <Collapsible open={open()} onOpenChange={setOpen} class="group/folder">
            <Show
              when={renaming() !== node.path}
              fallback={<RenameInput node={node} depth={props.depth} indent={6} isDir />}
            >
              <CollapsibleTrigger
                class="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-sm transition-colors hover:bg-sidebar-accent/60"
                style={{ "padding-left": `${props.depth * 12 + 6}px` }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, path: node.path, isDir: true });
                }}
              >
                <ChevronRight
                  class={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                    open() && "rotate-90",
                  )}
                />
                <Show
                  when={open()}
                  fallback={<Folder class="size-4 shrink-0 text-muted-foreground" />}
                >
                  <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
                </Show>
                <span class="truncate">{node.name}</span>
              </CollapsibleTrigger>
            </Show>
            <CollapsibleContent>
              <ul>
                <For each={node.children}>
                  {(child) => (
                    <TreeRow node={child} depth={props.depth + 1} onOpenFile={props.onOpenFile} />
                  )}
                </For>
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ) : (
        <li>
          <Show
            when={renaming() === node.path}
            fallback={
              <button
                type="button"
                class={cn(
                  "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm transition-colors hover:bg-sidebar-accent/60",
                  isActive() && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
                style={{ "padding-left": `${props.depth * 12 + 24}px` }}
                onClick={() => props.onOpenFile(node.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, path: node.path, isDir: false });
                }}
              >
                <MarkdownFileIcon name={node.name} active={isActive()} />
                <span class="truncate">{node.name}</span>
              </button>
            }
          >
            <RenameInput node={node} depth={props.depth} indent={24} />
          </Show>
        </li>
      )}
    </>
  );
};

/** Inline rename field replacing a file or folder row while renaming. Enter
 * commits, Escape cancels, clicking away commits (file-manager conventions).
 * `indent` is the per-row left offset (files sit deeper than folder chevrons). */
const RenameInput: Component<{
  node: TreeNode;
  depth: number;
  indent: number;
  isDir?: boolean;
}> = (props) => {
  let input!: HTMLInputElement;
  let done = false;

  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const value = input.value;
    setRenaming(null);
    if (commit && value.trim() && value !== props.node.name) {
      void renameEntry(props.node.path, value, props.isDir);
    }
  };

  onMount(() => {
    input.focus();
    // Preselect the name without its extension (folders have none).
    const dot = props.isDir ? -1 : props.node.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : props.node.name.length);
  });

  return (
    <div
      class="flex items-center gap-1.5 py-0.5 pr-2"
      style={{ "padding-left": `${props.depth * 12 + props.indent}px` }}
    >
      <Show when={props.isDir} fallback={<MarkdownFileIcon name={props.node.name} />}>
        <Folder class="size-4 shrink-0 text-muted-foreground" />
      </Show>
      <input
        ref={input}
        class="w-full min-w-0 rounded-sm border border-input bg-background px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={props.node.name}
        spellcheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
};

const EmptyState: Component = () => (
  <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
    <div class="rounded-xl bg-sidebar-accent p-3 text-sidebar-accent-foreground">
      <FolderPlus class="size-6" />
    </div>
    <div class="space-y-1">
      <p class="text-sm font-medium">Open a vault</p>
      <p class="text-xs text-muted-foreground">
        Pick a folder or a single markdown file to get started.
      </p>
    </div>
  </div>
);

function vaultRootName(): string {
  const root = vault.vaultRoot();
  if (!root) return "";
  const norm = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export default FileExplorer;
