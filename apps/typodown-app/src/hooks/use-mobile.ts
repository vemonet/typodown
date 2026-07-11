import { createSignal, onCleanup, onMount } from "solid-js";

export function useIsMobile(breakpoint = 768): () => boolean {
  const [isMobile, setIsMobile] = createSignal(false);
  onMount(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    onCleanup(() => mql.removeEventListener("change", update));
  });
  return isMobile;
}
