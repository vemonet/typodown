import type { Accessor, Component, ComponentProps, JSX } from "solid-js";
import {
  createContext,
  createEffect,
  createSignal,
  mergeProps,
  onCleanup,
  splitProps,
  useContext,
} from "solid-js";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

interface SidebarContextValue {
  state: Accessor<"expanded" | "collapsed">;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue>();

function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
}

type SidebarProviderProps = ComponentProps<"div"> & { defaultOpen?: boolean };

const SidebarProvider: Component<SidebarProviderProps> = (props) => {
  const merged = mergeProps({ defaultOpen: true }, props);
  const [local, others] = splitProps(merged, ["defaultOpen", "class", "style", "children"]);
  const [open, setOpen] = createSignal(local.defaultOpen);
  const toggleSidebar = () => setOpen((value) => !value);

  createEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <SidebarContext.Provider
      value={{ state: () => (open() ? "expanded" : "collapsed"), toggleSidebar }}
    >
      <div
        data-slot="sidebar-wrapper"
        style={{
          "--sidebar-width": SIDEBAR_WIDTH,
          "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
          ...(local.style as JSX.CSSProperties),
        }}
        class={cn("group/sidebar-wrapper flex min-h-svh w-full", local.class)}
        {...others}
      >
        {local.children}
      </div>
    </SidebarContext.Provider>
  );
};

type SidebarProps = ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "none";
};

const Sidebar: Component<SidebarProps> = (props) => {
  const merged = mergeProps(
    { side: "left" as const, variant: "sidebar" as const, collapsible: "offcanvas" as const },
    props,
  );
  const [local, others] = splitProps(merged, [
    "side",
    "variant",
    "collapsible",
    "class",
    "children",
  ]);
  const { state } = useSidebar();

  return (
    <div
      class="group peer hidden text-sidebar-foreground md:block"
      data-state={state()}
      data-collapsible={state() === "collapsed" ? local.collapsible : ""}
      data-variant={local.variant}
      data-side={local.side}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        class="relative z-sidebar-gap w-(--sidebar-width) bg-transparent group-data-[collapsible=offcanvas]:w-0 group-data-[side=right]:rotate-180"
      />
      <div
        data-slot="sidebar-container"
        class={cn(
          "fixed inset-y-0 top-2 z-10 hidden w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex",
          local.side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          local.variant === "floating" || local.variant === "inset"
            ? "p-2"
            : "group-data-[side=left]:border-r group-data-[side=right]:border-l",
          local.class,
        )}
        {...others}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          class="z-sidebar-inner flex size-full flex-col"
        >
          {local.children}
        </div>
      </div>
    </div>
  );
};

const SidebarInset: Component<ComponentProps<"main">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <main
      data-slot="sidebar-inset"
      class={cn("relative z-sidebar-inset flex w-full flex-1 flex-col", local.class)}
      {...others}
    />
  );
};

const SidebarContent: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      data-slot="sidebar-content"
      class={cn("z-sidebar-content flex min-h-0 flex-1 flex-col overflow-auto", local.class)}
      {...others}
    />
  );
};

export { Sidebar, SidebarContent, SidebarInset, SidebarProvider, useSidebar };
