import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";
import { cn } from "@/lib/utils";

const ScrollArea: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("overflow-auto", local.class)} {...others} />;
};

export { ScrollArea };
