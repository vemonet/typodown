import { onMount, onCleanup, Show, type JSX, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import FileExplorer from "@/components/FileExplorer";
import Editor from "@/components/Editor";
import GraphView from "@/components/GraphView";
import { useColorMode } from "@/components/color-mode";
import {
  initOpenWith,
  openFolder,
  save,
  setAutoSave,
  showEditor,
  showGraph,
  vault,
} from "@/lib/vault";
import { IS_TAURI } from "@/lib/tauri";

/** On mobile there is no window to drag, so the titlebar drag strip (which
 * costs a whole row) is dropped; on desktop it stays as the drag region for
 * the overlay titlebar. */
const IS_MOBILE_OS = /android|iphone|ipad/i.test(navigator.userAgent);

/** Android replaces the auto-save with an explicit Save button in the editor
 * toolbar (cloud SAF writes on every keystroke churn conflict copies on the
 * provider). */
const IS_ANDROID = /android/i.test(navigator.userAgent);

const App: Component = () => {
  const { colorMode, resolvedColorMode } = useColorMode();

  onMount(() => {
    void initOpenWith();
    if (IS_ANDROID) setAutoSave(false);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        void openFolder();
      } else if (key === "s" && !IS_TAURI) {
        e.preventDefault();
        save();
      } else if (key === "g") {
        e.preventDefault();
        if (vault.view() === "graph") showEditor();
        else showGraph();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="app-root flex h-dvh flex-col bg-background text-foreground">
      <Show when={IS_TAURI && !IS_MOBILE_OS}>
        {/* Blank drag strip for the macOS overlay titlebar. The built-in
         * data-tauri-drag-region handles double-click maximize; dragging goes
         * through our start_native_drag command because tauri's start_dragging
         * is a no-op on macOS 26 (it reuses a stale NSEvent that Tahoe
         * rejects). Must be a native `on:` listener: the injected drag script
         * stops propagation at the document, which silences Solid's delegated
         * handlers. */}
        <div
          class="titlebar-drag"
          data-tauri-drag-region
          on:mousedown={(e) => {
            if (e.button === 0 && e.detail === 1) void invoke("start_native_drag");
          }}
        />
      </Show>

      <div class="flex flex-1 overflow-hidden">
        {/* Left: floating file explorer. Hidden on mobile, where opening a
         * folder from the filesystem is not supported. The document outline
         * lives in the editor itself (the Typodown library renders its own
         * right-docked outline panel + toggle). */}
        <SidebarProvider style={{ "--sidebar-width": "17rem" } as JSX.CSSProperties}>
          <Show when={!IS_MOBILE_OS}>
            <Sidebar variant="floating" collapsible="offcanvas" class="pt-6">
              <SidebarContent>
                <FileExplorer />
              </SidebarContent>
            </Sidebar>
          </Show>
          <SidebarInset class="relative flex flex-col overflow-hidden">
            {/* The file-explorer toggle floats in the editor margin instead of
             * taking a full row. */}
            <Show when={!IS_MOBILE_OS}>
              <div class="absolute left-1.5 top-1.5 z-30 rounded-md bg-background/60 backdrop-blur-sm">
                <LeftToggle />
              </div>
            </Show>
            <div class="z-sidebar-inset flex-1 overflow-hidden">
              <Show
                when={vault.view() === "graph"}
                fallback={
                  <Editor
                    theme={colorMode() === "system" ? "auto" : colorMode()}
                    save={IS_ANDROID ? { run: save, isDirty: vault.dirty } : undefined}
                  />
                }
              >
                <GraphView theme={resolvedColorMode()} />
              </Show>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>

      <Toaster />
    </div>
  );
};

const LeftToggle: Component = () => {
  const { toggleSidebar } = useSidebar();
  return <SidebarToggleButton icon={FolderOpen} label="Toggle files" onClick={toggleSidebar} />;
};

interface SidebarToggleButtonProps {
  icon: Component<{ class?: string }>;
  label: string;
  onClick: () => void;
}

const SidebarToggleButton: Component<SidebarToggleButtonProps> = (props) => {
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        onClick={props.onClick}
        aria-label={props.label}
      >
        <Icon class="size-4" />
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
};

export default App;
