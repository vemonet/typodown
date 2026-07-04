// @vemonet/typodown
// A Typora-inspired WYSIWYG markdown editor for the web.
//
// Import the stylesheet once in your app:
//   import "@vemonet/typodown/style.css";
//
// Then mount an editor:
//   import { createTypodown } from "@vemonet/typodown";
//   const editor = createTypodown(document.getElementById("app")!, {
//     value: "# Hello\n\nType **markdown** here.",
//     theme: "auto",
//   });

export { Typodown, createTypodown } from "./editor.ts";
export type { Theme, TypodownOptions } from "./editor.ts";
export { parse } from "./parse.ts";
export { parseInline } from "./inline.ts";
export type * from "./ast.ts";
