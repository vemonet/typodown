import { createContext, onMount, Show, useContext, type JSX, type Component } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen, List } from "lucide-solid";
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
import Outline from "@/components/Outline";
import Editor from "@/components/Editor";
import type { Typodown } from "@vemonet/typodown";
import { useColorMode } from "@/components/color-mode";
import { initOpenWith } from "@/lib/vault";

/** Context to expose the left sidebar's toggle to deeply nested children.
 * The right sidebar's provider would shadow the left one's useSidebar()
 * context, so we capture the left toggle before entering the right provider
 * and pass it down via this context. */
const LeftSidebarCtx = createContext<{ toggle: () => void }>({ toggle: () => {} });

/** On mobile there is no window to drag, so the titlebar drag strip (which
 * costs a whole row) is dropped; on desktop it stays as the drag region for
 * the overlay titlebar. */
const IS_MOBILE_OS = /android|iphone|ipad/i.test(navigator.userAgent);

const App: Component = () => {
  let editorRef: Typodown | undefined;
  const { resolvedColorMode } = useColorMode();

  onMount(() => void initOpenWith());

  const handleEditorReady = (editor: Typodown) => {
    editorRef = editor;
  };

  const jumpToLine = (line: number) => {
    editorRef?.scrollToLine(line);
  };

  return (
    <div class="flex h-dvh flex-col bg-background text-foreground">
      <Show when={!IS_MOBILE_OS}>
        {/* Blank drag strip for the macOS overlay titlebar. Tauri's injected
         * drag handler claims the mousedown when it matches (and then stops
         * propagation); this onMouseDown is a fallback that starts the drag
         * explicitly when it didn't. */}
        <div
          class="titlebar-drag"
          data-tauri-drag-region
          onMouseDown={(e) => {
            if (e.button === 0 && e.detail === 1) void getCurrentWindow().startDragging();
          }}
        />
      </Show>

      <div class="flex flex-1 overflow-hidden pt-1">
        {/* Left: floating file explorer */}
        <SidebarProvider style={{ "--sidebar-width": "17rem" } as JSX.CSSProperties}>
          <Sidebar variant="floating" collapsible="offcanvas" class="pt-6">
            <SidebarContent>
              <FileExplorer />
            </SidebarContent>
          </Sidebar>
          <SidebarInset class="flex flex-col overflow-hidden">
            {/* Capture the left sidebar's toggle before the right provider
             * shadows its context */}
            <LeftSidebarBridge>
              {/* Right: floating outline */}
              <SidebarProvider style={{ "--sidebar-width": "16rem" } as JSX.CSSProperties}>
                <SidebarInset class="relative flex flex-col overflow-hidden">
                  {/* Sidebar toggles float in the editor margin instead of
                   * taking a full row. */}
                  <div class="absolute left-1.5 top-1.5 z-30 rounded-md bg-background/60 backdrop-blur-sm">
                    <LeftToggle />
                  </div>
                  <div class="absolute right-1.5 top-1.5 z-30 rounded-md bg-background/60 backdrop-blur-sm">
                    <RightToggle />
                  </div>
                  <div class="z-sidebar-inset flex-1 overflow-hidden">
                    <Editor theme={resolvedColorMode()} onReady={handleEditorReady} />
                  </div>
                </SidebarInset>
                <Sidebar variant="floating" collapsible="offcanvas" side="right" class="pt-6">
                  <SidebarContent>
                    <Outline onJumpToLine={jumpToLine} />
                  </SidebarContent>
                </Sidebar>
              </SidebarProvider>
            </LeftSidebarBridge>
          </SidebarInset>
        </SidebarProvider>
      </div>

      <Toaster />
    </div>
  );
};

/** Captures the left SidebarProvider's toggle and exposes it via context so
 * the LeftToggle button (nested inside the right provider) can still call it. */
const LeftSidebarBridge: Component<{ children: JSX.Element }> = (props) => {
  const { toggleSidebar } = useSidebar();
  return (
    <LeftSidebarCtx.Provider value={{ toggle: toggleSidebar }}>
      {props.children}
    </LeftSidebarCtx.Provider>
  );
};

const LeftToggle: Component = () => {
  const ctx = useContext(LeftSidebarCtx);
  return <SidebarToggleButton icon={FolderOpen} label="Toggle files" onClick={ctx.toggle} />;
};

const RightToggle: Component = () => {
  const { toggleSidebar } = useSidebar();
  return <SidebarToggleButton icon={List} label="Toggle outline" onClick={toggleSidebar} />;
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
