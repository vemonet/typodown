import { createSignal, For, Show, type Component } from "solid-js";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  BookOpen,
  Sun,
  Moon,
  Monitor,
} from "lucide-solid";
import { Button } from "@/components/ui/button";
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
import { vault, openFolder, openFile } from "@/lib/vault";
import { useColorMode } from "@/components/color-mode";

interface FileExplorerProps {
  onOpenFile?: (path: string) => void;
}

const FileExplorer: Component<FileExplorerProps> = (props) => {
  const { colorMode, setColorMode } = useColorMode();

  const handleFile = (path: string) => {
    void openFile(path);
    props.onOpenFile?.(path);
  };

  return (
    <div class="flex h-full flex-col text-sidebar-foreground">
      <div class="flex items-center gap-1.5 px-3 pb-2 pt-2">
        <Show
          when={vault.vaultRoot()}
          // fallback={
          //   <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          //     Vault
          //   </span>
          // }
        >
          <BookOpen class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate text-sm font-medium" title={vault.vaultRoot() ?? ""}>
            {vaultRootName()}
          </span>
        </Show>
      </div>

      <div class="flex items-center gap-1.5 px-2 pb-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 flex-1 text-xs"
          onClick={() => void openFolder()}
        >
          <FolderPlus />
          Open folder
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            as={Button}
            variant="outline"
            size="sm"
            class="h-7 w-7 shrink-0 px-0"
            aria-label="Toggle theme"
          >
            {colorMode() === "dark" ? (
              <Moon class="size-3.5" />
            ) : colorMode() === "system" ? (
              <Monitor class="size-3.5" />
            ) : (
              <Sun class="size-3.5" />
            )}
          </DropdownMenuTrigger>
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
    </div>
  );
};

const TreeRow: Component<{
  node: TreeNode;
  depth: number;
  onOpenFile: (path: string) => void;
}> = (props) => {
  const [open, setOpen] = createSignal(true);
  const isActive = () => vault.currentPath() === props.node.path;

  if (props.node.isDir) {
    return (
      <li>
        <Collapsible open={open()} onOpenChange={setOpen} class="group/folder">
          <CollapsibleTrigger
            class="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-sm transition-colors hover:bg-sidebar-accent/60"
            style={{ "padding-left": `${props.depth * 12 + 6}px` }}
          >
            <ChevronRight
              class={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                open() && "rotate-90",
              )}
            />
            <Show when={open()} fallback={<Folder class="size-4 shrink-0 text-muted-foreground" />}>
              <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
            </Show>
            <span class="truncate">{props.node.name}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul>
              <For each={props.node.children}>
                {(child) => (
                  <TreeRow node={child} depth={props.depth + 1} onOpenFile={props.onOpenFile} />
                )}
              </For>
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        class={cn(
          "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm transition-colors hover:bg-sidebar-accent/60",
          isActive() && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )}
        style={{ "padding-left": `${props.depth * 12 + 24}px` }}
        onClick={() => props.onOpenFile(props.node.path)}
        title={props.node.path}
      >
        <FileText
          class={cn(
            "size-4 shrink-0",
            isActive() ? "text-sidebar-accent-foreground" : "text-muted-foreground",
          )}
        />
        <span class="truncate">{props.node.name}</span>
      </button>
    </li>
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
