// Abstract syntax tree for the markdown document.
//
// Every node carries absolute source offsets (`from`/`to`). The invariant the
// parser guarantees is: the source ranges of all nodes tile the input string
// with no gaps and no overlaps, so a caret position expressed as a source
// offset can always be mapped back onto the rendered DOM (see render.ts).

export interface Span {
  from: number;
  to: number;
}

/** Inline-level node (lives inside a single block). */
export type Inline =
  | { type: "text"; from: number; to: number; text: string }
  // Syntax characters (e.g. the `**` of bold). Rendered but hidden with CSS
  // unless the containing block is active (cursor inside it).
  | { type: "mark"; from: number; to: number; text: string }
  | {
      type: "emph";
      tag: "strong" | "em" | "strongem" | "del";
      from: number;
      to: number;
      children: Inline[];
    }
  | { type: "code"; from: number; to: number; children: Inline[] }
  | { type: "link"; from: number; to: number; href: string; children: Inline[] }
  | { type: "autolink"; from: number; to: number; href: string; children: Inline[] }
  | { type: "image"; from: number; to: number; src: string; alt: string; raw: string }
  | { type: "html"; from: number; to: number; raw: string };

export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

export type ColumnAlign = "left" | "center" | "right" | "none";

/** A single logical line inside a multi-line block (blockquote, list). */
export interface InlineLine {
  from: number;
  to: number;
  markLen: number; // length of the leading syntax (`> `, `- `, `1. `, ...)
  inline: Inline[];
}

export type Block =
  | { type: "paragraph"; from: number; to: number; inline: Inline[] }
  | { type: "heading"; from: number; to: number; level: number; inline: Inline[] }
  | {
      type: "blockquote";
      from: number;
      to: number;
      alert: AlertKind | null;
      lines: InlineLine[];
    }
  | {
      type: "list";
      from: number;
      to: number;
      ordered: boolean;
      items: ListItem[];
    }
  | {
      type: "code";
      from: number;
      to: number;
      lang: string;
      openFence: Span;
      closeFence: Span | null;
      content: Span; // the raw code, newlines included
      info: Span; // range of the info string (language) on the opening fence line
    }
  | { type: "hr"; from: number; to: number; raw: string }
  | {
      type: "table";
      from: number;
      to: number;
      align: ColumnAlign[];
      header: string[];
      rows: string[][];
      raw: string;
    }
  | { type: "blank"; from: number; to: number }
  | { type: "html"; from: number; to: number; raw: string };

export interface ListItem {
  from: number;
  to: number;
  markLen: number;
  marker: string; // rendered bullet or number, e.g. "1." / "-"
  ordered: boolean; // this item uses an ordered marker (1. / 1))
  indent: number; // leading whitespace width, used to build nesting
  checked: boolean | null; // GFM task list state, null when not a task item
  inline: Inline[];
}
