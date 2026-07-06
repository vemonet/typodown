/**
 * @vemonet/typodown
 * A Typora-inspired WYSIWYG markdown editor for the web.
 *
 * @example
 * ```typescript
 * // Import the stylesheet once in your app:
 * import "@vemonet/typodown/style.css";
 *
 * // Then mount an editor:
 * import { createTypodown } from "@vemonet/typodown";
 * const editor = createTypodown(document.getElementById("app")!, {
 *   value: "# Hello\n\nType **markdown** here.",
 *   theme: "auto",
 * });
 * ```
 */

export { Typodown, createTypodown } from "./editor.ts";
export type { Theme, TypodownOptions } from "./editor.ts";
export { LANGUAGES, matchLanguages } from "./highlight.ts";
