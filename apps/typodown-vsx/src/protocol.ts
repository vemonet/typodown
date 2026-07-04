// Messages exchanged between the extension host and the webview.

/** Theme setting from `typodown.theme`. */
export type ThemeSetting = "editor" | "light" | "dark";

/** Host -> webview. */
export type HostMessage =
  | { type: "init"; text: string; theme: ThemeSetting }
  | { type: "update"; text: string }
  | { type: "theme"; theme: ThemeSetting }
  | { type: "clipboard"; text: string };

/** Webview -> host. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "edit"; text: string }
  | { type: "clipboard" };
