import { onMount, onCleanup, Show, type JSX, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { PanelLeftClose, PanelLeftOpen } from "lucide-solid";
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
import FileSwitcher from "@/components/FileSwitcher";
import { useColorMode } from "@/components/color-mode";
import { initOpenWith, openFolder, save, showEditor, showGraph, vault } from "@/lib/vault";
import { IS_TAURI } from "@/lib/tauri";

/** On mobile there is no window to drag, so the titlebar drag strip (which
 * costs a whole row) is dropped; on desktop it stays as the drag region for
 * the overlay titlebar. */
const IS_MOBILE_OS = /android|iphone|ipad/i.test(navigator.userAgent);

const IS_SMALL_SCREEN = window.matchMedia("(max-width: 767px)").matches;

const App: Component = () => {
  const { colorMode, resolvedColorMode } = useColorMode();

  onMount(() => {
    void initOpenWith();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        void openFolder();
      } else if (key === "s") {
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
        {/* Left: floating file explorer on desktop and an off-canvas drawer on
         * small screens. */}
        <SidebarProvider
          defaultOpen={!IS_SMALL_SCREEN}
          style={{ "--sidebar-width": "17rem" } as JSX.CSSProperties}
        >
          <MobileSidebarBackdrop />
          <Sidebar variant="floating" collapsible="offcanvas" class="pt-6">
            <SidebarContent>
              <FileExplorer />
            </SidebarContent>
          </Sidebar>
          <SidebarInset class="relative flex flex-col overflow-hidden">
            {/* The file-explorer toggle floats in the editor margin instead of
             * taking a full row. */}
            <LeftToggle />
            <div class="z-sidebar-inset flex-1 overflow-hidden">
              <Show
                when={vault.view() === "graph"}
                fallback={
                  <Editor
                    theme={colorMode() === "system" ? "auto" : colorMode()}
                    save={{ run: save, isDirty: vault.dirty }}
                  />
                }
              >
                <GraphView theme={resolvedColorMode()} />
              </Show>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>

      <FileSwitcher />
      <Toaster />
    </div>
  );
};

const LeftToggle: Component = () => {
  const { state, toggleSidebar } = useSidebar();
  const expanded = () => state() === "expanded";
  const label = () => (expanded() ? "Close file explorer" : "Open file explorer");
  return (
    <div
      class="file-explorer-toggle absolute left-1.5 top-1.5 z-50 rounded-md bg-background/60 backdrop-blur-sm"
      data-expanded={expanded()}
    >
      <Tooltip>
        <TooltipTrigger
          as={Button}
          variant="ghost"
          size="icon-sm"
          onClick={toggleSidebar}
          aria-label={label()}
        >
          <Show when={expanded()} fallback={<PanelLeftOpen class="size-4" />}>
            <PanelLeftClose class="size-4" />
          </Show>
        </TooltipTrigger>
        <TooltipContent>{label()}</TooltipContent>
      </Tooltip>
    </div>
  );
};

const MobileSidebarBackdrop: Component = () => {
  const { state, toggleSidebar } = useSidebar();
  return (
    <Show when={state() === "expanded"}>
      <button
        type="button"
        class="fixed inset-0 z-30 hidden bg-black/20 max-md:block"
        aria-label="Close file explorer"
        onClick={toggleSidebar}
      />
    </Show>
  );
};

export default App;
