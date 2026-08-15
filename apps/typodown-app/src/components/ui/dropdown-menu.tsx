import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { ComponentProps, ValidComponent } from "solid-js";
import { mergeProps, splitProps } from "solid-js";
import { cn } from "@/lib/utils";

const DropdownMenu = (props: DropdownMenuPrimitive.DropdownMenuRootProps) => {
  const merged = mergeProps({ gutter: 4 }, props);
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...merged} />;
};

type TriggerProps<T extends ValidComponent = "button"> = PolymorphicProps<
  T,
  DropdownMenuPrimitive.DropdownMenuTriggerProps<T>
> &
  Pick<ComponentProps<T>, "class">;

const DropdownMenuTrigger = <T extends ValidComponent = "button">(props: TriggerProps<T>) => (
  <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
);

type ContentProps<T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  DropdownMenuPrimitive.DropdownMenuContentProps<T>
> &
  Pick<ComponentProps<T>, "class">;

const DropdownMenuContent = <T extends ValidComponent = "div">(props: ContentProps<T>) => {
  const [local, others] = splitProps(props as ContentProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        class={cn(
          "z-50 z-dropdown-menu-content max-h-(--kb-popper-available-height) min-w-32 origin-(--kb-menu-content-transform-origin) overflow-y-auto overflow-x-hidden outline-none data-closed:overflow-hidden",
          local.class,
        )}
        {...others}
      />
    </DropdownMenuPrimitive.Portal>
  );
};

type ItemProps<T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  DropdownMenuPrimitive.DropdownMenuItemProps<T>
> &
  Pick<ComponentProps<T>, "class">;

const DropdownMenuItem = <T extends ValidComponent = "div">(props: ItemProps<T>) => {
  const [local, others] = splitProps(props as ItemProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      class={cn(
        "z-dropdown-menu-item flex cursor-default select-none items-center outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        local.class,
      )}
      {...others}
    />
  );
};

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger };
