import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  untrack,
  useContext,
} from "solid-js";

export const ZAIDAN_COLOR_MODE_COOKIE_KEY = "zaidan-color-mode";

export type ColorMode =
  | "light"
  | "dark"
  | "system"
  | "dracula"
  | "nord"
  | "solarized-light"
  | "solarized-dark";
export type ResolvedColorMode = "light" | "dark";

export type ColorModeContextValue = {
  /** The user's chosen preference ("light" | "dark" | "system"). */
  colorMode: Accessor<ColorMode>;
  /** The concrete mode applied to the DOM ("light" | "dark"). */
  resolvedColorMode: Accessor<ResolvedColorMode>;
  toggleColorMode: () => void;
  setColorMode: (mode: ColorMode) => void;
};

export const ColorModeContext = createContext<ColorModeContextValue>();

export function ColorModeProvider(
  props: ParentProps<{
    initialColorMode: ColorMode;
  }>,
) {
  const [colorMode, setColorModeSignal] = createSignal<ColorMode>(props.initialColorMode);

  // Track the OS colour-scheme reactively so "system" mode updates live, with
  // no separate listener that can fight the user's explicit choice.
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const [osDark, setOsDark] = createSignal(mql.matches);
  const onOsChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
  mql.addEventListener("change", onOsChange);
  onCleanup(() => mql.removeEventListener("change", onOsChange));

  /** The concrete mode to apply: the user preference, resolved to
   * "light"/"dark" when set to "system". */
  const resolvedColorMode = createMemo<ResolvedColorMode>(() => {
    const mode = colorMode();
    if (mode === "system") return osDark() ? "dark" : "light";
    return mode === "light" || mode === "solarized-light" ? "light" : "dark";
  });

  // Apply the resolved mode to <html>. Runs on mount (so a saved preference
  // is honoured from the first app paint, not only after a manual toggle) and
  // on every change. This is the single place that touches the class list.
  createEffect(() => {
    const resolved = resolvedColorMode();
    const html = document.documentElement;
    html.classList.remove("light", "dark");
    html.classList.add(resolved);
  });

  const setColorMode = (mode: ColorMode) => {
    setColorModeSignal(mode);
    // biome-ignore lint/suspicious/noDocumentCookie: <will find a better way to do this>
    document.cookie = `${ZAIDAN_COLOR_MODE_COOKIE_KEY}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
  };

  const toggleColorMode = () => {
    setColorMode(untrack(resolvedColorMode) === "dark" ? "light" : "dark");
  };

  return (
    <ColorModeContext.Provider
      value={{ colorMode, resolvedColorMode, toggleColorMode, setColorMode }}
    >
      {props.children}
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorModeContextValue {
  const context = useContext(ColorModeContext);
  if (context === undefined) {
    throw new Error("useColorMode must be used within a ColorModeProvider");
  }
  return context;
}

/** Read the persisted colour-mode preference (or "system" when none is saved).
 * Used both for the provider's initial value and the pre-render FOUC pin. */
export const getClientColorMode = (): ColorMode => {
  const stored = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${ZAIDAN_COLOR_MODE_COOKIE_KEY}=`))
    ?.split("=")[1];
  if (
    stored === "light" ||
    stored === "dark" ||
    stored === "system" ||
    stored === "dracula" ||
    stored === "nord" ||
    stored === "solarized-light" ||
    stored === "solarized-dark"
  )
    return stored;
  return "system";
};
