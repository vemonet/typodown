// A minimal CommonMark-compatible HTML renderer built directly on top of the
// same @lezer/markdown parser (base CommonMark + the GFM extension bundle)
// that the editor's live-preview decorations walk (see ../src/markdown-lang.ts).
//
// Typodown itself never renders HTML, it is a live-preview overlay on plain
// markdown text, so this file exists purely to measure how closely the
// parser we depend on tracks the CommonMark spec's reference HTML output (see
// commonmark-spec.test.ts). It is not shipped in the published package.
import { GFM, parser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

const mdParser = parser.configure(GFM);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Percent-encode a URL destination the way cmark's reference renderer does:
// leave already-valid `%XX` escapes and RFC 3986 reserved/unreserved
// characters alone, percent-encode everything else (in particular non-ASCII
// bytes), then still run the result through the normal entity escaper.
function normalizeUri(uri: string): string {
  const encoded = uri.replace(/%[0-9a-fA-F]{2}|[\s\S]/gu, (ch) => {
    if (/^%[0-9a-fA-F]{2}$/.test(ch)) return ch;
    if (/[A-Za-z0-9\-_.~!*'()#;/?:@&=+$,[\]]/.test(ch)) return ch;
    return Array.from(
      new TextEncoder().encode(ch),
      (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    ).join("");
  });
  return escapeText(encoded);
}

const NAMED_ENTITIES: Record<string, string> = {
  AElig: "Æ",
  ClockwiseContourIntegral: "∲",
  Dcaron: "Ď",
  DifferentialD: "ⅆ",
  HilbertSpace: "ℋ",
  amp: "&",
  auml: "ä",
  copy: "©",
  frac34: "¾",
  nbsp: " ",
  ngE: "≧̸",
  ouml: "ö",
  quot: '"',
};

/** Decode a `&name;` / `&#123;` / `&#xAB;` entity per the CommonMark grammar
 * (named entities limited to the HTML5 table, numeric refs limited to 1-7
 * decimal or 1-6 hex digits), or null if it is not a valid reference, in
 * which case the raw text is left as literal, escaped text. */
function decodeEntity(raw: string): string | null {
  let m = /^&#[xX]([0-9a-fA-F]{1,6});$/.exec(raw);
  if (m) return codePointToChar(Number.parseInt(m[1]!, 16));
  m = /^&#([0-9]{1,7});$/.exec(raw);
  if (m) return codePointToChar(Number.parseInt(m[1]!, 10));
  m = /^&([A-Za-z][A-Za-z0-9]*);$/.exec(raw);
  if (m && Object.hasOwn(NAMED_ENTITIES, m[1]!)) return NAMED_ENTITIES[m[1]!]!;
  return null;
}

function codePointToChar(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
  return String.fromCodePoint(cp);
}

function child(node: SyntaxNode, name: string): SyntaxNode | null {
  return node.getChild(name);
}

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let n = node.firstChild; n; n = n.nextSibling) out.push(n);
  return out;
}

const ASCII_PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

/** Resolve backslash escapes and entities in raw source text (used for link
 * destinations/titles and fence info strings, which the parser leaves as
 * untouched slices rather than nesting Escape/Entity child nodes). */
function unescapeAndDecode(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length && ASCII_PUNCT.test(raw[i + 1]!)) {
      out += raw[i + 1];
      i++;
      continue;
    }
    const m = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);/.exec(raw.slice(i));
    if (m) {
      const decoded = decodeEntity(m[0]);
      out += decoded ?? m[0];
      i += m[0].length - 1;
      continue;
    }
    out += raw[i];
  }
  return out;
}

// A paragraph/heading's source range spans multiple lines verbatim, carrying
// each continuation line's container-owned indentation (list content column,
// blockquote marker width, or lazy-continuation spaces at the top level --
// the first line's own indentation is already excluded from the node's
// range). Inline content is reflowed, so *any* amount of leading/trailing
// whitespace around an internal line break is insignificant and stripped
// unconditionally, there's no dedent-by-a-shared-width step needed.
function stripLineWhitespace(text: string): string {
  return text.replace(/ +\n/g, "\n").replace(/\n {1,}/g, "\n");
}

// A gap of plain text between two inline nodes (or a block's own start/end).
// `from`/`to` are absolute doc offsets so a chunk that itself contains no "\n"
// but immediately follows one (e.g. right after a HardBreak's own "  \n", or
// a QuoteMark) still gets its leading run of spaces stripped.
function gapText(doc: string, from: number, to: number): string {
  let text = stripLineWhitespace(doc.slice(from, to));
  if (doc[from - 1] === "\n") text = text.replace(/^ +/, "");
  return text;
}

// ---- link reference definitions --------------------------------------------

interface RefDef {
  url: string;
  title: string | null;
}

function normalizeLabel(label: string): string {
  return unescapeAndDecode(label).trim().replace(/\s+/g, " ").toLowerCase();
}

function stripAngleBrackets(url: string): string {
  return url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
}

function collectReferences(root: SyntaxNode, doc: string): Map<string, RefDef> {
  const refs = new Map<string, RefDef>();
  root.cursor().iterate((node) => {
    if (node.name !== "LinkReference") return;
    const label = node.node.getChild("LinkLabel");
    const url = node.node.getChild("URL");
    const title = node.node.getChild("LinkTitle");
    if (!label || !url) return;
    const key = normalizeLabel(doc.slice(label.from + 1, label.to - 1));
    if (!refs.has(key)) {
      refs.set(key, {
        url: stripAngleBrackets(doc.slice(url.from, url.to)),
        title: title ? doc.slice(title.from + 1, title.to - 1) : null,
      });
    }
  });
  return refs;
}

/** The label of a Link/Image node's reference form: the explicit `[label]`
 * for full/collapsed references, falling back to the bracketed display text
 * itself for shortcut references (`[foo]`) and collapsed ones (`[foo][]`). */
function referenceLabel(node: SyntaxNode, doc: string): string {
  const label = node.getChild("LinkLabel");
  if (label) {
    const raw = doc.slice(label.from + 1, label.to - 1);
    if (raw.length > 0) return raw;
  }
  const marks = node.getChildren("LinkMark");
  return doc.slice(marks[0]!.to, marks[1]!.from);
}

// A list is "loose" (CommonMark's term) if any two of its items are
// separated by a blank line, or if an item directly contains two blocks
// with a blank line between them, either way it renders each block in a
// wrapping <p>, rather than inlining a single paragraph's content.
function isLoose(list: SyntaxNode, doc: string): boolean {
  const items = children(list).filter((n) => n.name === "ListItem");
  for (let i = 0; i < items.length; i++) {
    const blocks = children(items[i]!).filter(
      (n) => n.name !== "ListMark" && n.name !== "TaskMarker",
    );
    for (let j = 1; j < blocks.length; j++) {
      if (doc.slice(blocks[j - 1]!.to, blocks[j]!.from).includes("\n\n")) return true;
    }
    if (i > 0 && doc.slice(items[i - 1]!.to, items[i]!.from).includes("\n\n")) return true;
  }
  return false;
}

function renderInline(node: SyntaxNode, doc: string): string {
  switch (node.name) {
    case "Text":
    case "URL":
      return escapeText(doc.slice(node.from, node.to));
    case "Escape": {
      const text = doc.slice(node.from, node.to).slice(1);
      return escapeText(text);
    }
    case "Entity": {
      const raw = doc.slice(node.from, node.to);
      const decoded = decodeEntity(raw);
      return decoded === null ? escapeText(raw) : escapeText(decoded);
    }
    case "HardBreak":
      return "<br />\n";
    case "Emphasis":
      return `<em>${renderInlineChildren(node, doc)}</em>`;
    case "StrongEmphasis":
      return `<strong>${renderInlineChildren(node, doc)}</strong>`;
    case "Strikethrough":
      return `<del>${renderInlineChildren(node, doc)}</del>`;
    case "InlineCode":
      return `<code>${renderCodeSpan(node, doc)}</code>`;
    case "Autolink": {
      const url = doc.slice(child(node, "URL")!.from, child(node, "URL")!.to);
      const href = url.includes("@") && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? `mailto:${url}` : url;
      return `<a href="${normalizeUri(href)}">${escapeText(url)}</a>`;
    }
    case "Link": {
      const dest = linkDestination(node, doc);
      if (!dest) return escapeText(doc.slice(node.from, node.to));
      const attrs = `href="${normalizeUri(unescapeAndDecode(dest.url))}"${dest.title !== null ? ` title="${escapeText(unescapeAndDecode(dest.title))}"` : ""}`;
      return `<a ${attrs}>${renderLinkText(node, doc)}</a>`;
    }
    case "Image": {
      const dest = linkDestination(node, doc);
      if (!dest) return escapeText(doc.slice(node.from, node.to));
      const alt = renderLinkText(node, doc).replace(/<[^>]*>/g, "");
      const attrs = `src="${normalizeUri(unescapeAndDecode(dest.url))}" alt="${alt}"${dest.title !== null ? ` title="${escapeText(unescapeAndDecode(dest.title))}"` : ""}`;
      return `<img ${attrs} />`;
    }
    case "HTMLTag":
      return doc.slice(node.from, node.to);
    default:
      return renderInlineChildren(node, doc);
  }
}

let currentRefs: Map<string, RefDef> = new Map();

/** A Link/Image's destination: either its own inline `(url "title")`, a
 * Link/Image always has exactly 4 LinkMarks (`[`, `]`, `(`, `)`) when it has
 * one, vs. 2 for any reference form, or resolved from a `[label]:`
 * reference definition elsewhere in the document (null if the reference is
 * undefined, in which case CommonMark says the whole construct is literal
 * text, not a link). */
function linkDestination(node: SyntaxNode, doc: string): RefDef | null {
  const marks = node.getChildren("LinkMark");
  if (marks.length >= 3) {
    const url = child(node, "URL");
    const title = child(node, "LinkTitle");
    return {
      url: url ? stripAngleBrackets(doc.slice(url.from, url.to)) : "",
      title: title ? doc.slice(title.from + 1, title.to - 1) : null,
    };
  }
  return currentRefs.get(normalizeLabel(referenceLabel(node, doc))) ?? null;
}

// The bracketed display text of a Link/Image is the source between its first
// two LinkMarks (`[`/`![` and `]`), rendered on its own, ignoring the
// destination/title that may follow, so their internal whitespace/marks never
// leak into the link text.
function renderLinkText(node: SyntaxNode, doc: string): string {
  const marks = node.getChildren("LinkMark");
  const from = marks[0]!.to;
  const to = marks[1]!.from;
  let out = "";
  let pos = from;
  for (const c of children(node)) {
    if (c.to <= from || c.from >= to) continue;
    if (c.from > pos) out += escapeText(gapText(doc, pos, c.from));
    out += renderInline(c, doc);
    pos = c.to;
  }
  if (pos < to) out += escapeText(gapText(doc, pos, to));
  return out;
}

function renderInlineChildren(node: SyntaxNode, doc: string): string {
  let out = "";
  let pos = node.from;
  for (const c of children(node)) {
    // Flush the implicit plain-text gap before this child *first*, marks
    // are children too, and skipping them must not also skip the text that
    // came before them (e.g. "bold" between the two `**` EmphasisMarks).
    if (c.from > pos) out += escapeText(gapText(doc, pos, c.from));
    const isMark =
      c.name === "EmphasisMark" ||
      c.name === "StrikethroughMark" ||
      c.name === "CodeMark" ||
      c.name === "HeaderMark" ||
      c.name === "QuoteMark";
    if (!isMark) out += renderInline(c, doc);
    // A blockquote marker on a continuation line also consumes one following
    // space (like the block-level one on the quote's first line does).
    pos = c.name === "QuoteMark" && doc[c.to] === " " ? c.to + 1 : c.to;
  }
  if (pos < node.to) out += escapeText(gapText(doc, pos, node.to));
  // A ListItem's Paragraph starts right after its marker, so when the marker
  // line was itself empty (e.g. "-\n  foo") the node's range, and hence
  // this text, begins with the newline the marker left behind.
  return out.replace(/^\n+/, "");
}

// A code span's content: line endings become spaces, and one leading and
// trailing space is stripped if the content has both and isn't all spaces.
function renderCodeSpan(node: SyntaxNode, doc: string): string {
  const marks = node.getChildren("CodeMark");
  const from = marks[0]!.to;
  const to = marks[marks.length - 1]!.from;
  let text = doc.slice(from, to).replace(/\n/g, " ");
  if (text.length > 0 && text.startsWith(" ") && text.endsWith(" ") && text.trim().length > 0) {
    text = text.slice(1, -1);
  }
  return escapeText(text);
}

function renderBlockChildren(node: SyntaxNode, doc: string): string {
  return children(node)
    .map((c) => renderBlock(c, doc))
    .join("");
}

function renderTaskInline(task: SyntaxNode, doc: string): string {
  const marker = child(task, "TaskMarker");
  const checked = marker ? /x/i.test(doc.slice(marker.from, marker.to)) : false;
  return `<input type="checkbox" ${checked ? 'checked="" ' : ""}disabled="" /> ${renderInlineChildren(task, doc)}`;
}

// A tight list item's own paragraph (or GFM task) renders as bare inline
// content, no wrapping tag, while every other block (nested lists, code,
// blockquotes...) renders normally; a loose item always wraps in <p>. See
// https://spec.commonmark.org/current/#tight for the two-block-with-a-blank-
// line and consecutive-items-with-a-blank-line definitions `isLoose` checks.
function renderListItemContent(item: SyntaxNode, doc: string, loose: boolean): string {
  const blocks = children(item).filter((n) => n.name !== "ListMark");
  if (blocks.length === 0) return "";
  // In a tight list, *every* paragraph/task renders bare (no wrapping <p>,
  // no own trailing newline) wherever it falls among the item's blocks --
  // not just when it's the first block.
  const isBare = (b: SyntaxNode): boolean =>
    !loose && (b.name === "Paragraph" || b.name === "Task");
  const renderOne = (b: SyntaxNode): string =>
    isBare(b)
      ? b.name === "Task"
        ? renderTaskInline(b, doc)
        : renderInlineChildren(b, doc)
      : renderBlock(b, doc);
  let body = "";
  for (let i = 0; i < blocks.length; i++) {
    const piece = renderOne(blocks[i]!);
    body += piece;
    // A bare piece has no trailing newline of its own; add one to separate
    // it from whatever comes next (full blocks already end in "\n").
    if (i < blocks.length - 1 && !piece.endsWith("\n")) body += "\n";
  }
  if (body.length === 0) return "";
  // A leading "\n" opens the <li> unless the item starts with bare content,
  // which sits directly after the opening tag.
  return isBare(blocks[0]!) ? body : `\n${body}`;
}

function fenceInfoLang(info: string): string {
  return info.trim().split(/\s+/)[0] ?? "";
}

function renderBlock(node: SyntaxNode, doc: string): string {
  switch (node.name) {
    case "Document":
      return renderBlockChildren(node, doc);
    case "Paragraph":
      // A zero-width Paragraph shows up for a content-less blockquote line
      // (`>` alone) or list item marker (`-` alone); CommonMark renders
      // neither as an empty <p>.
      return node.from === node.to ? "" : `<p>${renderInlineChildren(node, doc)}</p>\n`;
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
    case "SetextHeading1":
    case "SetextHeading2": {
      const level = /Heading([1-6])/.exec(node.name)![1];
      return `<h${level}>${renderInlineChildren(node, doc).trim()}</h${level}>\n`;
    }
    case "CodeBlock": {
      const text = node
        .getChildren("CodeText")
        .map((c) => doc.slice(c.from, c.to))
        .join("");
      return `<pre><code>${escapeText(text)}${text.endsWith("\n") ? "" : "\n"}</code></pre>\n`;
    }
    case "FencedCode": {
      const info = child(node, "CodeInfo");
      const lang = info ? fenceInfoLang(unescapeAndDecode(doc.slice(info.from, info.to))) : "";
      let text = node
        .getChildren("CodeText")
        .map((c) => doc.slice(c.from, c.to))
        .join("");
      // Unlike indented code, the parser leaves the fence's own indentation
      // in the content verbatim; strip up to that many spaces from each line.
      const lineStart = doc.lastIndexOf("\n", node.from - 1) + 1;
      const fenceIndent = node.from - lineStart;
      if (fenceIndent > 0) {
        text = text
          .split("\n")
          .map((line) => {
            let i = 0;
            while (i < fenceIndent && line[i] === " ") i++;
            return line.slice(i);
          })
          .join("\n");
      }
      const cls = lang ? ` class="language-${escapeText(lang)}"` : "";
      return `<pre><code${cls}>${escapeText(text)}${text.endsWith("\n") || text === "" ? "" : "\n"}</code></pre>\n`;
    }
    case "Blockquote":
      return `<blockquote>\n${renderBlockChildren(node, doc)}</blockquote>\n`;
    case "BulletList":
    case "OrderedList": {
      const loose = isLoose(node, doc);
      const items = children(node).filter((n) => n.name === "ListItem");
      const tag = node.name === "BulletList" ? "ul" : "ol";
      const startMark = node.name === "OrderedList" ? child(items[0]!, "ListMark") : null;
      const start = startMark ? Number.parseInt(doc.slice(startMark.from, startMark.to), 10) : 1;
      const startAttr = tag === "ol" && start !== 1 ? ` start="${start}"` : "";
      const body = items
        .map((item) => `<li>${renderListItemContent(item, doc, loose)}</li>\n`)
        .join("");
      return `<${tag}${startAttr}>\n${body}</${tag}>\n`;
    }
    case "HorizontalRule":
      return "<hr />\n";
    case "HTMLBlock":
    case "CommentBlock":
    case "ProcessingInstructionBlock": {
      // The node's range starts at the first non-space character; HTML
      // blocks may carry up to 3 spaces of leading indentation on their
      // opening line, which CommonMark's output preserves.
      let start = node.from;
      while (start > 0 && doc[start - 1] === " ") start--;
      return `${doc.slice(start, node.to)}\n`;
    }
    case "LinkReference":
      return "";
    case "Table": {
      const rows = children(node);
      const header = rows.find((r) => r.name === "TableHeader");
      const delimRow = child(node, "TableDelimiter");
      const aligns = delimRow
        ? doc
            .slice(delimRow.from, delimRow.to)
            .split("|")
            .slice(1, -1)
            .map((c) => {
              const t = c.trim();
              if (t.startsWith(":") && t.endsWith(":")) return "center";
              if (t.endsWith(":")) return "right";
              if (t.startsWith(":")) return "left";
              return null;
            })
        : [];
      const alignAttr = (i: number): string => (aligns[i] ? ` align="${aligns[i]}"` : "");
      const renderRow = (row: SyntaxNode, cellTag: string): string => {
        const cells = children(row).filter((c) => c.name === "TableCell");
        return `<tr>\n${cells.map((c, i) => `<${cellTag}${alignAttr(i)}>${renderInlineChildren(c, doc)}</${cellTag}>\n`).join("")}</tr>\n`;
      };
      const bodyRows = rows.filter((r) => r.name === "TableRow");
      let out = "<table>\n";
      if (header) out += `<thead>\n${renderRow(header, "th")}</thead>\n`;
      out += `<tbody>\n${bodyRows.map((r) => renderRow(r, "td")).join("")}</tbody>\n`;
      out += "</table>\n";
      return out;
    }
    default:
      return renderBlockChildren(node, doc);
  }
}

/** Render `markdown` to HTML using @lezer/markdown (CommonMark + GFM), for
 * comparing against the canonical CommonMark spec fixtures. */
export function renderHtml(markdown: string): string {
  const doc = markdown;
  const tree = mdParser.parse(doc);
  currentRefs = collectReferences(tree.topNode, doc);
  return renderBlock(tree.topNode, doc);
}
