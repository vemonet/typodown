/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { ColorModeProvider, getClientColorMode } from "@/components/color-mode";
import "./App.css";

// Pin the resolved colour-mode class on <html> before the provider mounts so
// the first paint matches the saved/OS preference. The provider takes over as
// the single source of truth once it mounts (applying + reacting to changes),
// so unlike the old syncDark listener there is nothing here that fights it.
(() => {
  const mode = getClientColorMode();
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  html.classList.add(resolved);
})();

render(
  () => (
    <ColorModeProvider initialColorMode={getClientColorMode()}>
      <App />
    </ColorModeProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
