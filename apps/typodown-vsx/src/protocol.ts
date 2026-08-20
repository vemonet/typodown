// Messages exchanged between the extension host and the webview.

/** Theme setting from `typodown.theme`. */
export type ThemeSetting =
  | "editor"
  | "light"
  | "dark"
  | "dracula"
  | "nord"
  | "solarized-light"
  | "solarized-dark";

/** Host -> webview. */
export type HostMessage =
  | {
      type: "init";
      text: string;
      theme: ThemeSetting;
      imageBaseUri: string;
      joinSoftBreaks: boolean;
      tabSize: number;
    }
  | { type: "update"; text: string }
  | { type: "theme"; theme: ThemeSetting }
  | { type: "joinSoftBreaks"; join: boolean }
  | { type: "tabSize"; size: number }
  | { type: "clipboard"; text: string };

/** Webview -> host. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "edit"; text: string }
  | { type: "clipboard" }
  | { type: "openLink"; url: string };
