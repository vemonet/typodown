// Block-level markdown parser (GitHub Flavored Markdown subset).
//
// Produces a list of blocks whose source ranges tile the whole document with
// no gaps: block[i].to === block[i + 1].from, and the first/last blocks touch
// 0 and value.length. Each block includes the trailing newline of its last
// line, and blank lines become their own `blank` blocks. This total coverage
// is required by the caret mapping in the editor.

import type { AlertKind, Block, ColumnAlign, InlineLine, ListItem } from "./ast.ts";
import { parseInline } from "./inline.ts";

const HEADING = /^(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FENCE = /^([ \t]*)(```+|~~~+)(.*)$/;
const BLOCKQUOTE = /^ {0,3}>/;
const ALERT = /^ {0,3}>[ \t]?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;
const UL_ITEM = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const OL_ITEM = /^([ \t]*)(\d{1,9}[.)])[ \t]+(.*)$/;
// Delimiter row: one or more `:?-+:?` cells separated/bounded by pipes. The
// leading lookahead requires at least one pipe so a bare "---" (a thematic
// break) is never mistaken for a single-column delimiter.
const TABLE_DELIM = /^(?=[^\n]*\|)[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const TASK = /^\[([ xX])\][ \t]+/;

const HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

// A complete, well-formed open or close tag (CommonMark's grammar), used for
// HTML block type 7 and inline HTML. Attribute values must be quoted or
// unquoted-but-clean, which is what keeps an autolink like `<https://x.dev>`
// from being mistaken for a tag.
const ATTR = `[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\\s*=\\s*(?:[^\\s"'=<>\`]+|'[^']*'|"[^"]*"))?`;
const OPEN_TAG = `<[a-zA-Z][a-zA-Z0-9-]*(?:\\s+${ATTR})*\\s*/?>`;
const CLOSE_TAG = `</[a-zA-Z][a-zA-Z0-9-]*\\s*>`;
const HTML_BLOCK_7 = new RegExp(`^(?:${OPEN_TAG}|${CLOSE_TAG})[ \\t]*$`);

// Classify a line as a CommonMark HTML block start (types 1-7) or 0.
function htmlBlockType(text: string): number {
  const t = text.replace(/^ {0,3}/, "");
  if (!t.startsWith("<")) return 0;
  if (/^<(script|pre|style|textarea)(\s|>|$)/i.test(t)) return 1;
  if (t.startsWith("<!--")) return 2;
  if (t.startsWith("<?")) return 3;
  if (/^<!DOCTYPE/i.test(t) || /^<![A-Z]/.test(t)) return 4;
  if (t.startsWith("<![CDATA[")) return 5;
  // Type 6: a known block-level tag whose name is properly delimited.
  const tag = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s|\/?>|$)/.exec(t);
  if (tag && HTML_BLOCK_TAGS.has(tag[1]!.toLowerCase())) return 6;
  // Type 7: any complete open/close tag occupying the whole line.
  if (HTML_BLOCK_7.test(t)) return 7;
  return 0;
}

// End condition for closed HTML block types (1-5).
function htmlBlockEnd(type: number, line: string): boolean {
  switch (type) {
    case 1:
      return /<\/(?:script|pre|style|textarea)\s*>/i.test(line);
    case 2:
      return line.includes("-->");
    case 3:
      return line.includes("?>");
    case 4:
      return line.includes(">");
    case 5:
      return line.includes("]]>");
    default:
      return false;
  }
}

interface Line {
  text: string;
  start: number; // absolute offset of the line's first char
}

export function parse(value: string, html = true): Block[] {
  const segments = value.split("\n");
  const lines: Line[] = [];
  let offset = 0;
  for (const text of segments) {
    lines.push({ text, start: offset });
    offset += text.length + 1; // + newline
  }
  const n = lines.length;
  const len = value.length;
  // Start offset of a block that begins at line index `a`, ending before line `b`.
  const rangeTo = (b: number): number => (b < n ? lines[b]!.start : len);

  const blocks: Block[] = [];
  let k = 0;
  while (k < n) {
    const line = lines[k]!;
    const from = line.start;

    if (line.text.trim() === "") {
      blocks.push({ type: "blank", from, to: rangeTo(k + 1) });
      k++;
      continue;
    }

    const fence = FENCE.exec(line.text);
    if (fence) {
      const marker = fence[2]!;
      const fenceChar = marker[0]!;
      let j = k + 1;
      while (j < n) {
        const t = lines[j]!.text;
        const close = new RegExp(
          `^[ \\t]*${fenceChar === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`,
        );
        if (close.test(t)) break;
        j++;
      }
      const closed = j < n;
      const to = rangeTo(closed ? j + 1 : j);
      const openTo = rangeTo(k + 1);
      const infoFrom = from + fence[1]!.length + marker.length;
      blocks.push({
        type: "code",
        from,
        to,
        lang: fence[3]!.trim(),
        openFence: { from, to: openTo },
        closeFence: closed ? { from: lines[j]!.start, to } : null,
        content: { from: openTo, to: closed ? lines[j]!.start : to },
        info: { from: infoFrom, to: from + line.text.length },
      });
      k = closed ? j + 1 : j;
      continue;
    }

    const heading = HEADING.exec(line.text);
    if (heading) {
      const level = heading[1]!.length;
      const headingText = heading[2] ?? "";
      // Everything before the heading text (e.g. "## ") is the mark.
      const markEnd = from + line.text.length - headingText.length;
      blocks.push({
        type: "heading",
        from,
        to: rangeTo(k + 1),
        level,
        inline: [
          { type: "mark", from, to: markEnd, text: value.slice(from, markEnd) },
          ...parseInline(value, markEnd, from + line.text.length, html),
        ],
      });
      k++;
      continue;
    }

    if (HR.test(line.text)) {
      blocks.push({ type: "hr", from, to: rangeTo(k + 1), raw: line.text });
      k++;
      continue;
    }

    if (BLOCKQUOTE.test(line.text)) {
      let j = k;
      while (j < n && BLOCKQUOTE.test(lines[j]!.text)) j++;
      const to = rangeTo(j);
      const alertMatch = ALERT.exec(line.text);
      const alert = (alertMatch ? alertMatch[1]!.toLowerCase() : null) as AlertKind | null;
      const bqLines: InlineLine[] = [];
      for (let li = k; li < j; li++) {
        bqLines.push(makeQuoteLine(value, lines[li]!, html));
      }
      blocks.push({ type: "blockquote", from, to, alert, lines: bqLines });
      k = j;
      continue;
    }

    if (UL_ITEM.test(line.text) || OL_ITEM.test(line.text)) {
      let j = k;
      const items: ListItem[] = [];
      // Gather consecutive list-item lines of either type (nesting is rebuilt
      // from each item's indent at render time).
      while (j < n) {
        const um = UL_ITEM.exec(lines[j]!.text);
        const om = um ? null : OL_ITEM.exec(lines[j]!.text);
        const m = um ?? om;
        if (!m) break;
        const startLine = j;
        j++;
        // Absorb soft-wrapped continuation lines (indented or lazy) into the
        // current item, exactly like a paragraph gathers its lines.
        while (j < n && isParagraphContinuation(lines, j, html)) j++;
        const contentTo = lines[j - 1]!.start + lines[j - 1]!.text.length;
        const itemTo = rangeTo(j);
        items.push(makeListItem(value, lines[startLine]!, contentTo, itemTo, m, !!om, html));
      }
      blocks.push({
        type: "list",
        from,
        to: rangeTo(j),
        ordered: items[0]?.ordered ?? false,
        items,
      });
      k = j;
      continue;
    }

    if (line.text.includes("|") && k + 1 < n && TABLE_DELIM.test(lines[k + 1]!.text)) {
      let j = k + 2;
      while (j < n && lines[j]!.text.trim() !== "" && lines[j]!.text.includes("|")) j++;
      const to = rangeTo(j);
      blocks.push(makeTable(value, from, to, lines.slice(k, j)));
      k = j;
      continue;
    }

    if (html) {
      const ht = htmlBlockType(line.text);
      if (ht > 0) {
        let j = k;
        if (ht <= 5) {
          let found = false;
          while (j < n && !found) {
            if (htmlBlockEnd(ht, lines[j]!.text)) found = true;
            j++;
          }
        } else {
          while (j < n && lines[j]!.text.trim() !== "") j++;
        }
        const to = rangeTo(j);
        blocks.push({ type: "html", from, to, raw: value.slice(from, to) });
        k = j;
        continue;
      }
    }

    // Paragraph: gather following plain lines.
    let j = k + 1;
    while (j < n && isParagraphContinuation(lines, j, html)) j++;
    const to = rangeTo(j);
    // Inline content spans up to the last non-newline character of the run.
    const contentTo = lines[j - 1]!.start + lines[j - 1]!.text.length;
    blocks.push({
      type: "paragraph",
      from,
      to,
      inline: parseInline(value, from, contentTo, html),
    });
    k = j;
  }

  if (blocks.length === 0) blocks.push({ type: "blank", from: 0, to: 0 });
  return blocks;
}

function isParagraphContinuation(lines: Line[], j: number, html: boolean): boolean {
  const t = lines[j]!.text;
  if (t.trim() === "") return false;
  if (HEADING.test(t) || HR.test(t) || FENCE.test(t) || BLOCKQUOTE.test(t)) return false;
  if (UL_ITEM.test(t) || OL_ITEM.test(t)) return false;
  if (html && htmlBlockType(t) > 0) return false;
  if (t.includes("|") && j + 1 < lines.length && TABLE_DELIM.test(lines[j + 1]!.text)) return false;
  return true;
}

function makeQuoteLine(value: string, line: Line, html: boolean): InlineLine {
  const m = /^ {0,3}>[ \t]?/.exec(line.text)!;
  const markLen = m[0].length;
  const contentFrom = line.start + markLen;
  const contentTo = line.start + line.text.length;
  return {
    from: line.start,
    to: contentTo,
    markLen,
    inline: parseInline(value, contentFrom, contentTo, html),
  };
}

// `contentTo` is the end of the item's last (possibly continuation) line; the
// inline content spans from just after the marker to there, so soft-wrapped
// continuation lines collapse into the item like a multi-line paragraph.
function makeListItem(
  value: string,
  line: Line,
  contentTo: number,
  itemTo: number,
  m: RegExpExecArray,
  ordered: boolean,
  html: boolean,
): ListItem {
  const indent = m[1]!;
  const marker = m[2]!;
  const rest = m[3]!;
  const markLen = line.text.length - rest.length;
  const contentFrom = line.start + markLen;
  const task = TASK.exec(rest);
  let checked: boolean | null = null;
  let inlineFrom = contentFrom;
  if (task) {
    checked = task[1]!.toLowerCase() === "x";
    inlineFrom = contentFrom + task[0].length;
  }
  return {
    from: line.start,
    to: itemTo,
    markLen: task ? markLen + task[0].length : markLen,
    marker: indent + marker,
    ordered,
    indent: indent.replace(/\t/g, "  ").length,
    checked,
    inline: parseInline(value, inlineFrom, contentTo, html),
  };
}

function makeTable(value: string, from: number, to: number, rows: Line[]): Block {
  const parseCells = (t: string): string[] =>
    t
      .replace(/^[ \t]*\|/, "")
      .replace(/\|[ \t]*$/, "")
      .split("|")
      .map((c) => c.trim());
  const header = parseCells(rows[0]!.text);
  const align: ColumnAlign[] = parseCells(rows[1]!.text).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "none";
  });
  const body = rows.slice(2).map((r) => parseCells(r.text));
  return { type: "table", from, to, align, header, rows: body, raw: value.slice(from, to) };
}
