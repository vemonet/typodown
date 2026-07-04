// Inline markdown parser.
//
// `parseInline` scans a source range and returns inline nodes whose source
// ranges tile [from, to) exactly. Every character is accounted for, either as
// visible `text` or as a hidden `mark` (syntax). This total coverage is what
// lets the editor map a caret offset onto the DOM and back.

import type { Inline } from "./ast.ts";

const ASCII_PUNCT = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""));

function text(src: string, from: number, to: number): Inline {
  return { type: "text", from, to, text: src.slice(from, to) };
}

function mark(src: string, from: number, to: number): Inline {
  return { type: "mark", from, to, text: src.slice(from, to) };
}

function isSpaceOrPunct(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch) || ASCII_PUNCT.has(ch);
}

interface Match {
  node: Inline;
  end: number;
}

/** Parse the inline content of `src` between [from, to). */
export function parseInline(src: string, from: number, to: number, html = true): Inline[] {
  const out: Inline[] = [];
  let i = from;
  let textStart = from;

  const flush = (end: number): void => {
    if (end > textStart) out.push(text(src, textStart, end));
  };

  while (i < to) {
    const c = src[i];
    let m: Match | null = null;

    if (c === "\\" && i + 1 < to && ASCII_PUNCT.has(src[i + 1]!)) {
      flush(i);
      out.push(mark(src, i, i + 1), text(src, i + 1, i + 2));
      i += 2;
      textStart = i;
      continue;
    }
    if (c === "`") m = matchCode(src, i, to);
    else if (c === "!" && src[i + 1] === "[") m = matchImage(src, i, to);
    else if (c === "[") m = matchLink(src, i, to);
    else if (c === "<") {
      m = matchAutolink(src, i, to);
      if (!m && html) m = matchInlineHtml(src, i, to);
    } else if (c === "*" || c === "_" || c === "~") m = matchEmphasis(src, i, to);

    if (m) {
      flush(i);
      out.push(m.node);
      i = m.end;
      textStart = i;
      continue;
    }
    i++;
  }
  flush(to);
  return out;
}

function matchCode(src: string, i: number, to: number): Match | null {
  let n = 0;
  while (i + n < to && src[i + n] === "`") n++;
  // Find a closing run of exactly `n` backticks.
  let j = i + n;
  while (j < to) {
    if (src[j] === "`") {
      let m = 0;
      while (j + m < to && src[j + m] === "`") m++;
      if (m === n) {
        const children: Inline[] = [mark(src, i, i + n), text(src, i + n, j), mark(src, j, j + n)];
        return { node: { type: "code", from: i, to: j + n, children }, end: j + n };
      }
      j += m;
    } else j++;
  }
  return null;
}

// Parse the `(url "title")` destination starting at `open` (the "("). Returns
// the index just past the closing ")", or -1.
function scanDestination(
  src: string,
  open: number,
  to: number,
): { end: number; url: string } | null {
  if (src[open] !== "(") return null;
  let j = open + 1;
  let depth = 1;
  while (j < to) {
    const ch = src[j];
    if (ch === "\\" && j + 1 < to) {
      j += 2;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    j++;
  }
  if (j >= to || src[j] !== ")") return null;
  const inner = src.slice(open + 1, j).trim();
  // Strip an optional title: url "title" or url 'title'.
  const url = inner.replace(/\s+["'(].*$/s, "").trim();
  return { end: j + 1, url };
}

// Find the matching "]" for a "[" at `open`, honouring nested brackets.
function matchBracket(src: string, open: number, to: number): number {
  let depth = 1;
  let j = open + 1;
  while (j < to) {
    const ch = src[j];
    if (ch === "\\" && j + 1 < to) {
      j += 2;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

function matchLink(src: string, i: number, to: number): Match | null {
  const close = matchBracket(src, i, to);
  if (close < 0) return null;
  const dest = scanDestination(src, close + 1, to);
  if (!dest) return null;
  const children: Inline[] = [
    mark(src, i, i + 1),
    ...parseInline(src, i + 1, close),
    mark(src, close, dest.end),
  ];
  return {
    node: { type: "link", from: i, to: dest.end, href: dest.url, children },
    end: dest.end,
  };
}

function matchImage(src: string, i: number, to: number): Match | null {
  const close = matchBracket(src, i + 1, to);
  if (close < 0) return null;
  const dest = scanDestination(src, close + 1, to);
  if (!dest) return null;
  const alt = src.slice(i + 2, close);
  return {
    node: {
      type: "image",
      from: i,
      to: dest.end,
      src: dest.url,
      alt,
      raw: src.slice(i, dest.end),
    },
    end: dest.end,
  };
}

const AUTOLINK = /^<((?:[a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]+)|(?:[^\s@<>]+@[^\s@<>.]+\.[^\s@<>]+))>/;

function matchAutolink(src: string, i: number, to: number): Match | null {
  const m = AUTOLINK.exec(src.slice(i, to));
  if (!m) return null;
  const raw = m[1]!;
  const end = i + m[0].length;
  const href = raw.includes("@") && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? `mailto:${raw}` : raw;
  const children: Inline[] = [
    mark(src, i, i + 1),
    text(src, i + 1, end - 1),
    mark(src, end - 1, end),
  ];
  return { node: { type: "autolink", from: i, to: end, href, children }, end };
}

// A complete open or close tag (CommonMark grammar). Well-formed attributes are
// required so an autolink like `<https://x.dev>` is not read as a tag (that path
// is tried first in the caller anyway, but this keeps the matcher honest).
const HTML_ATTR = `[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\\s*=\\s*(?:[^\\s"'=<>\`]+|'[^']*'|"[^"]*"))?`;
const HTML_TAG = new RegExp(
  `^(?:<[a-zA-Z][a-zA-Z0-9-]*(?:\\s+${HTML_ATTR})*\\s*/?>|</[a-zA-Z][a-zA-Z0-9-]*\\s*>)`,
);

// Match inline HTML: comments, CDATA, processing instructions, declarations,
// and open/close tags.
function matchInlineHtml(src: string, i: number, to: number): Match | null {
  const slice = src.slice(i, to);
  let m: RegExpMatchArray | null = null;
  if (!m) m = /^<!--[\s\S]*?-->/.exec(slice);
  if (!m) m = /^<!\[CDATA\[[\s\S]*?\]\]>/.exec(slice);
  if (!m) m = /^<\?[\s\S]*?\?>/.exec(slice);
  if (!m) m = /^<![A-Za-z][^>]*>/.exec(slice);
  if (!m) m = HTML_TAG.exec(slice);
  if (!m) return null;
  const end = i + m[0].length;
  return { node: { type: "html", from: i, to: end, raw: m[0] }, end };
}

function matchEmphasis(src: string, i: number, to: number): Match | null {
  const c = src[i]!;
  let n = 0;
  while (i + n < to && src[i + n] === c) n++;
  const use = c === "~" ? 2 : Math.min(n, 3);
  if (c === "~" && n < 2) return null;

  // Underscores must not open inside a word (foo_bar stays literal).
  if (c === "_" && !isSpaceOrPunct(src[i - 1])) return null;

  const openTo = i + use;
  let j = openTo;
  while (j < to) {
    if (src[j] === c) {
      let m = 0;
      while (j + m < to && src[j + m] === c) m++;
      if (m >= use && j > openTo) {
        if (c === "_" && !isSpaceOrPunct(src[j + use])) {
          j += m;
          continue;
        }
        const tag = c === "~" ? "del" : use === 3 ? "strongem" : use === 2 ? "strong" : "em";
        const children: Inline[] = [
          mark(src, i, openTo),
          ...parseInline(src, openTo, j),
          mark(src, j, j + use),
        ];
        return {
          node: { type: "emph", tag, from: i, to: j + use, children },
          end: j + use,
        };
      }
      j += m;
    } else j++;
  }
  return null;
}
