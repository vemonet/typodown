// LaTeX math syntax extension for @lezer/markdown.
//
// Adds two constructs, matching Typora's behaviour:
//   - MathInline: `$...$` (inline math) and `$$...$$` when it appears inline
//     (not at the start of a line). Both stay on a single line.
//   - MathBlock: `$$...$$` starting at the beginning of a line. It can span
//     one line (`$$x^2$$`) or multiple lines (opening `$$`, content, closing
//     `$$`), like a fenced code block.
//
// Each construct produces a node whose source range is the full construct
// (including the `$` / `$$` delimiters), with `MathMark` children marking the
// delimiters. The live-preview layer replaces the range with a rendered KaTeX
// widget while idle, and reveals the raw source when the caret enters it.

import { tags } from "@lezer/highlight";
import type { Element, MarkdownExtension } from "@lezer/markdown";

const DOLLAR = 36; // '$'

export const Math: MarkdownExtension = {
  defineNodes: [
    { name: "MathBlock", block: true },
    { name: "MathInline", style: tags.special(tags.content) },
    { name: "MathMark", style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: "MathBlock",
      before: "FencedCode",
      endLeaf(_cx, line) {
        // Allow a line starting with "$$" to interrupt a paragraph, so a
        // math block doesn't need a blank line above it (matching Typora).
        return line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR;
      },
      parse(cx, line) {
        if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return false;

        const from = cx.lineStart + line.pos;
        const text = line.text;

        // Single-line form: $$...$$  (closing $$ on the same line).
        const sameLineClose = text.indexOf("$$", line.pos + 2);
        if (sameLineClose >= 0) {
          const to = cx.lineStart + sameLineClose + 2;
          cx.addElement(
            cx.elt("MathBlock", from, to, [
              cx.elt("MathMark", from, from + 2),
              cx.elt("MathMark", cx.lineStart + sameLineClose, to),
            ]),
          );
          cx.nextLine();
          return true;
        }

        // Multi-line form: opening $$ on this line, closing $$ on a later line.
        // `line.depth` and `cx.stack` exist at runtime (the built-in FencedCode
        // parser uses them) but are missing from @lezer/markdown's public types.
        const marks: Element[] = [cx.elt("MathMark", from, from + 2)];
        let to = cx.prevLineEnd();
        while (
          cx.nextLine() &&
          (line as unknown as { depth: number }).depth >=
            (cx as unknown as { stack: unknown[] }).stack.length
        ) {
          const close = line.text.indexOf("$$", line.pos);
          if (close >= 0) {
            const closeFrom = cx.lineStart + close;
            marks.push(cx.elt("MathMark", closeFrom, closeFrom + 2));
            to = closeFrom + 2;
            cx.nextLine();
            break;
          }
          to = cx.prevLineEnd();
        }
        cx.addElement(cx.elt("MathBlock", from, to, marks));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "MathInline",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        // $$ at the start of a line is handled by the block parser. In any
        // other position, $$...$$ is display-mode inline math.
        if (cx.char(pos + 1) === DOLLAR) {
          for (let i = pos + 2; i < cx.end; i++) {
            if (cx.char(i) === DOLLAR && cx.char(i + 1) === DOLLAR) {
              return cx.addElement(
                cx.elt("MathInline", pos, i + 2, [
                  cx.elt("MathMark", pos, pos + 2),
                  cx.elt("MathMark", i, i + 2),
                ]),
              );
            }
            if (cx.char(i) === 10 /* \n */) break;
          }
          return -1;
        }
        // Inline math $...$. Must not be preceded by a $ (that would be $$).
        if (pos > cx.offset && cx.char(pos - 1) === DOLLAR) return -1;
        for (let i = pos + 1; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === DOLLAR) {
            return cx.addElement(
              cx.elt("MathInline", pos, i + 1, [
                cx.elt("MathMark", pos, pos + 1),
                cx.elt("MathMark", i, i + 1),
              ]),
            );
          }
          if (ch === 10 /* \n */) break;
        }
        return -1;
      },
    },
  ],
};
