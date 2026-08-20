// Editor preferences that are neither vault state nor theme, remembered across
// restarts in localStorage the same way the auto-save flag is.

import { createSignal } from "solid-js";

/** Render a paragraph hard-wrapped in the source as one flowing paragraph
 * (a single newline is a soft line break in Markdown, i.e. a space). On by
 * default, matching every Markdown renderer; turning it off keeps each source
 * line on its own visual line. */
const JOIN_SOFT_BREAKS_KEY = "typodown:join-soft-breaks";
const [joinSoftBreaks, setJoinSoftBreaksSignal] = createSignal<boolean>(loadJoinSoftBreaks());

function loadJoinSoftBreaks(): boolean {
  try {
    // Anything but an explicit "off" (including no stored value) means on.
    return localStorage.getItem(JOIN_SOFT_BREAKS_KEY) !== "off";
  } catch {
    // Storage can be unavailable (private mode, strict WebView); default on.
    return true;
  }
}

export function setJoinSoftBreaks(enabled: boolean): void {
  setJoinSoftBreaksSignal(enabled);
  try {
    localStorage.setItem(JOIN_SOFT_BREAKS_KEY, enabled ? "on" : "off");
  } catch {
    // Not persisting the choice is not worth failing the toggle over.
  }
}

export function toggleJoinSoftBreaks(): void {
  setJoinSoftBreaks(!joinSoftBreaks());
}

export const settings = {
  joinSoftBreaks,
};
