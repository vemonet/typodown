// Markdown -> standalone HTML export.
//
// The editor renders by decorating live text (see live-preview.ts), which is
// great for editing and useless for producing a file: the DOM only ever holds
// the visible viewport, and the markup is CodeMirror's. So export walks the
// *same* Lezer tree the editor decorates and emits ordinary semantic HTML
// instead of decorations.
//
// Parsing goes through the same parser configuration the editor uses (CommonMark
// + GFM + the math extension), so anything the editor recognises is recognised
// here too and the two can't drift on what counts as a table or a fence.
// Inline content is emitted by live-preview.ts's own inline walker for the same
// reason.
//
// Deliberately NOT rendered (they fall back to a plain, visible block rather
// than silently vanishing):
//   - math: `$$...$$` / `$...$` render as monospace source, not KaTeX.
//   - mermaid: rendered as a normal highlighted code block.
//   - `:::note` directives: the Lezer grammar has no node for them (the editor
//     finds them with its own line scan), so they export as literal text.
//
// The output is a single self-contained file: no external stylesheet, no script,
// no font download. Image `src` values are left exactly as authored, so relative
// paths keep working when the .html is saved next to the .md it came from.

import type { SyntaxNode } from "@lezer/common";
import { GFM, parser as baseParser } from "@lezer/markdown";
import { tokenize } from "./highlight.ts";
import {
  ALERT_KINDS,
  children,
  emitChildrenHTML,
  emitRangeHTML,
  esc,
  escAttr,
  isDelimRow,
  parseFootnoteDefinition,
  splitCells,
} from "./live-preview.ts";
import { Math as MathExtension } from "./math.ts";
import { sanitizeHtml } from "./sanitize.ts";

/** Same configuration as the editor's `typodownMarkdown()`, minus CodeMirror. */
const exportParser = baseParser.configure([GFM, MathExtension]);

export interface ExportOptions {
  /** Document title: used for `<title>` and, when `heading` is unset, nothing
   * else. Defaults to "Untitled". */
  title?: string;
  /** Rewrite image destinations before emitting them. Left unset for a saved
   * .html file (relative paths are more useful there); the PDF path passes a
   * resolver so local images actually load in the print webview. */
  resolveImageSrc?: (src: string) => string;
}

/** Render markdown as a complete, self-contained HTML document. */
export function markdownToHtmlDocument(markdown: string, options: ExportOptions = {}): string {
  const title = options.title?.trim() || "Untitled";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${EXPORT_CSS}</style>`,
    "</head>",
    "<body>",
    `<article class="td-export">${markdownToHtml(markdown, options)}</article>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/** Render markdown as an HTML fragment (no `<html>` wrapper, no stylesheet). */
export function markdownToHtml(markdown: string, options: ExportOptions = {}): string {
  // Front matter is metadata, not content: the editor shows it as a source
  // block, an exported document should not carry it at all.
  const stripped = stripFrontMatter(markdown);
  const footnotes = collectFootnotes(stripped);
  // Footnote references have to be taken out of the source before it is parsed:
  // `[^a]` is a valid shortcut reference link, so the inline walker would
  // otherwise turn it into an empty <a> and there would be nothing left to
  // recognise. markFootnoteRefs swaps each one for a sentinel that survives
  // parsing and escaping untouched.
  const { src, refs } = markFootnoteRefs(stripped, footnotes);

  const ctx: Ctx = { src, footnotes };
  let body = emitBlocks(exportParser.parse(src).topNode, ctx);
  body = fillFootnoteRefs(body, refs);
  body += emitFootnoteSection(ctx, refs);

  // One sanitize pass over the whole document: the safety boundary for the raw
  // HTML the markdown was allowed to embed.
  const safe = sanitizeHtml(body);
  return options.resolveImageSrc ? rewriteImages(safe, options.resolveImageSrc) : safe;
}

/** Apply the host's image resolver to `<img src>`.
 *
 * Deliberately after sanitizing rather than through `sanitizeHtml`'s own
 * resolver hook: hosts hand back custom-scheme URLs (Tauri's `asset://`) that
 * DOMPurify's URI allow-list drops, and widening that allow-list would weaken
 * the editor's sanitizer for every other caller. The values written here come
 * from trusted host code, not from the document. */
function rewriteImages(html: string, resolveImageSrc: (src: string) => string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src");
    if (src === null) continue;
    try {
      image.setAttribute("src", resolveImageSrc(src));
    } catch {
      // A failing host resolver must not make the whole export fail.
    }
  }
  return template.innerHTML;
}

interface Ctx {
  src: string;
  /** Footnote id -> definition text, in document order. */
  footnotes: Map<string, string>;
}

function stripFrontMatter(markdown: string): string {
  // The block may be empty (`---\n---`), so the body is optional.
  const match = /^(?:---|\+\+\+)\r?\n(?:[\s\S]*?\r?\n)?(?:---|\+\+\+|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(
    markdown,
  );
  return match ? markdown.slice(match[0].length) : markdown;
}

/** `[^id]: text` definition lines, keyed by id. The GFM grammar has no footnote
 * node, so these are found by line like the editor does. */
function collectFootnotes(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of src.split("\n")) {
    const def = parseFootnoteDefinition(line);
    if (def) out.set(def.label, line.slice(def.markerLength).trim());
  }
  return out;
}

// ---- blocks ---------------------------------------------------------------

function emitBlocks(parent: SyntaxNode, ctx: Ctx): string {
  let out = "";
  for (const node of children(parent)) out += emitBlock(node, ctx);
  return out;
}

function emitBlock(node: SyntaxNode, ctx: Ctx): string {
  const { src } = ctx;

  const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
  if (heading) {
    const level = heading[1]!;
    const text = inline(node, ctx).trim();
    return `<h${level} id="${escAttr(slug(plain(node, src)))}">${text}</h${level}>\n`;
  }

  switch (node.name) {
    case "Paragraph": {
      // A definition line is not body text; it is emitted in the footnote
      // section instead.
      if (parseFootnoteDefinition(src.slice(node.from, node.to))) return "";
      return `<p>${inline(node, ctx)}</p>\n`;
    }

    case "HorizontalRule":
      return "<hr>\n";

    case "FencedCode":
    case "CodeBlock":
      return emitCode(node, ctx);

    case "Blockquote":
      return emitBlockquote(node, ctx);

    case "BulletList":
      return `<ul>\n${emitBlocks(node, ctx)}</ul>\n`;

    case "OrderedList": {
      // Honour a list that does not start at 1, the way a renderer should.
      const first = node.getChild("ListItem");
      const start = first ? /^\s*(\d+)/.exec(src.slice(first.from, first.to))?.[1] : undefined;
      const attr = start && start !== "1" ? ` start="${escAttr(start)}"` : "";
      return `<ol${attr}>\n${emitBlocks(node, ctx)}</ol>\n`;
    }

    case "ListItem":
      return emitListItem(node, ctx);

    case "Table":
      return emitTable(node, ctx);

    case "MathBlock":
      // Not rendered (see the file header): show the source so nothing is lost.
      return `<pre class="td-math"><code>${esc(src.slice(node.from, node.to))}</code></pre>\n`;

    case "HTMLBlock":
      // Passed through verbatim; markdownToHtml sanitizes the whole document.
      return `${src.slice(node.from, node.to)}\n`;

    case "CommentBlock":
    case "LinkReference":
      // Metadata, not content.
      return "";

    default:
      // Unknown block containers still get walked so their children are not
      // dropped; a bare inline leaf at block level becomes a paragraph.
      return node.firstChild ? emitBlocks(node, ctx) : "";
  }
}

function emitCode(node: SyntaxNode, ctx: Ctx): string {
  const { src } = ctx;
  const info = node.getChild("CodeInfo");
  // CommonMark takes the first info-string token as the language.
  const lang = info ? src.slice(info.from, info.to).trim().split(/\s+/)[0] || "" : "";

  const parts = node.getChildren("CodeText");
  const code = parts.length
    ? parts.map((part) => src.slice(part.from, part.to)).join("")
    : // An indented code block has no CodeText child: strip the 4-space indent.
      src
        .slice(node.from, node.to)
        .split("\n")
        .map((line) => line.replace(/^ {1,4}/, ""))
        .join("\n");

  const attr = lang ? ` class="language-${escAttr(lang)}"` : "";
  return `<pre><code${attr}>${highlight(code, lang)}</code></pre>\n`;
}

/** Wrap a code string in `<span class="td-tok-*">` runs, reusing the editor's
 * tokenizer so exported code is coloured by the same grammars. Untagged gaps
 * are emitted plain. */
function highlight(code: string, lang: string): string {
  const tokens = lang ? tokenize(code, lang) : [];
  if (!tokens.length) return esc(code);
  let out = "";
  let pos = 0;
  for (const token of tokens) {
    if (token.from < pos) continue; // defensive: tokenizers should not overlap
    if (token.from > pos) out += esc(code.slice(pos, token.from));
    out += `<span class="td-tok-${escAttr(token.type)}">${esc(
      code.slice(token.from, token.to),
    )}</span>`;
    pos = token.to;
  }
  if (pos < code.length) out += esc(code.slice(pos));
  return out;
}

/** A blockquote, or a GitHub alert when its first line is `[!NOTE]` and friends. */
function emitBlockquote(node: SyntaxNode, ctx: Ctx): string {
  const first =
    node.firstChild?.name === "QuoteMark" ? node.firstChild.nextSibling : node.firstChild;
  const alert = first
    ? /^\[!(\w+)\]\s*$/m.exec(ctx.src.slice(first.from, first.to).split("\n")[0] ?? "")
    : null;
  const kind = alert?.[1]?.toLowerCase();

  if (kind && (ALERT_KINDS as readonly string[]).includes(kind)) {
    // Drop the marker line; the label replaces it.
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    const rest = children(node)
      .filter((child) => !isSameNode(child, first))
      .map((child) => emitBlock(child, ctx))
      .join("");
    // The marker shares its Paragraph with the first line of body text, so what
    // follows the marker inside that paragraph has to be kept.
    const tail = first ? ctx.src.slice(first.from, first.to).split("\n").slice(1).join("\n") : "";
    const tailHtml = tail.trim() ? markdownToHtmlUnsanitized(tail, ctx) : "";
    return (
      `<div class="td-alert td-alert-${escAttr(kind)}">` +
      `<p class="td-alert-title">${esc(label)}</p>\n${tailHtml}${rest}</div>\n`
    );
  }
  return `<blockquote>\n${emitBlocks(node, ctx)}</blockquote>\n`;
}

/** Render a nested markdown snippet without a second sanitize pass (the caller
 * is already inside markdownToHtml, which sanitizes the whole document once). */
function markdownToHtmlUnsanitized(markdown: string, outer: Ctx): string {
  const ctx: Ctx = { src: markdown, footnotes: outer.footnotes };
  return emitBlocks(exportParser.parse(markdown).topNode, ctx);
}

function emitListItem(node: SyntaxNode, ctx: Ctx): string {
  const { src } = ctx;
  const task = node.getChild("Task");
  if (task) {
    // The GFM grammar gives Task a single TaskMarker child and leaves the item's
    // text as plain source after it, so the text has to be emitted as an inline
    // range rather than by walking Task's children.
    const marker = task.getChild("TaskMarker");
    const checked = marker ? /x/i.test(src.slice(marker.from, marker.to)) : false;
    const text = emitRangeHTML(task, src, marker ? marker.to : task.from, task.to).trim();
    // `disabled` because an exported document is not interactive.
    return (
      `<li class="td-task"><input type="checkbox" disabled${checked ? " checked" : ""}> ` +
      `${text}${emitSiblingBlocks(node, ctx, task)}</li>\n`
    );
  }
  return `<li>${unwrapSingleParagraph(emitBlocks(node, ctx))}</li>\n`;
}

/** Blocks of a list item that sit after its Task node (a nested list, a second
 * paragraph). */
function emitSiblingBlocks(node: SyntaxNode, ctx: Ctx, skip: SyntaxNode): string {
  return children(node)
    .filter((child) => !isSameNode(child, skip) && child.name !== "ListMark")
    .map((child) => emitBlock(child, ctx))
    .join("");
}

/** Whether two node wrappers refer to the same tree node.
 *
 * `@lezer/common` returns a fresh `SyntaxNode` object from every `firstChild` /
 * `nextSibling` access, so two wrappers for the same node are never `===`.
 * Comparing position and name is the identity test that actually holds. */
function isSameNode(a: SyntaxNode, b: SyntaxNode | null): boolean {
  return b !== null && a.from === b.from && a.to === b.to && a.name === b.name;
}

/** A single-paragraph list item reads better without the `<p>`, matching how
 * every markdown renderer treats a "tight" list. */
function unwrapSingleParagraph(html: string): string {
  const match = /^<p>([\s\S]*)<\/p>\n$/.exec(html);
  return match ? match[1]! : html;
}

function emitTable(node: SyntaxNode, ctx: Ctx): string {
  const { src } = ctx;
  const lines = src.slice(node.from, node.to).split("\n");
  const rows = lines.map((line) => splitCells(line));
  // Alignment comes from the delimiter row's colons.
  const delimIndex = rows.findIndex((cells) => cells.length > 0 && isDelimRow(cells));
  const align = delimIndex >= 0 ? rows[delimIndex]!.map(cellAlign) : [];

  const header = delimIndex > 0 ? rows.slice(0, delimIndex) : [];
  const body = delimIndex >= 0 ? rows.slice(delimIndex + 1) : rows;

  const cell = (text: string, tag: "th" | "td", index: number): string => {
    const style = align[index] ? ` style="text-align:${align[index]}"` : "";
    return `<${tag}${style}>${inlineText(text)}</${tag}>`;
  };
  const row = (cells: string[], tag: "th" | "td"): string =>
    `<tr>${cells.map((text, index) => cell(text, tag, index)).join("")}</tr>\n`;

  let out = "<table>\n";
  if (header.length)
    out += `<thead>\n${header.map((cells) => row(cells, "th")).join("")}</thead>\n`;
  const rendered = body.filter((cells) => cells.length > 0);
  if (rendered.length)
    out += `<tbody>\n${rendered.map((cells) => row(cells, "td")).join("")}</tbody>\n`;
  return `${out}</table>\n`;
}

function cellAlign(text: string): "" | "left" | "center" | "right" {
  const value = text.trim();
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

// ---- inline ---------------------------------------------------------------

/** Inline content of a block node, with footnote references linked up. */
function inline(node: SyntaxNode, ctx: Ctx): string {
  return emitChildrenHTML(node, ctx.src);
}

/** Inline content of a standalone string (a table cell, a footnote definition),
 * parsed on its own. */
function inlineText(text: string): string {
  const trimmed = text.trim();
  const tree = exportParser.parse(trimmed);
  // The parse wraps a bare line in a Paragraph; emit from that when present.
  const paragraph = tree.topNode.getChild("Paragraph") ?? tree.topNode;
  return emitChildrenHTML(paragraph, trimmed);
}

// ---- footnotes ------------------------------------------------------------
//
// Private-use codepoints bracket each reference placeholder. The markdown parser
// treats them as ordinary text, `esc` leaves them alone, and DOMPurify passes
// them through, so a sentinel survives the whole pipeline intact. Real documents
// do not contain these.
const FN_OPEN = "\uE000";
const FN_CLOSE = "\uE001";

/** Replace each `[^id]` reference with a sentinel, in first-reference order.
 *
 * References inside code are left as literal text, so the code regions are
 * located with a throwaway parse first. Two parses is a non-issue here: export
 * is a one-shot user action, not an edit-loop path. */
function markFootnoteRefs(
  src: string,
  footnotes: Map<string, string>,
): { src: string; refs: string[] } {
  const refs: string[] = [];
  if (!footnotes.size || !src.includes("[^")) return { src, refs };

  const code: Array<[number, number]> = [];
  exportParser.parse(src).iterate({
    enter(node) {
      if (/FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag/.test(node.name)) {
        code.push([node.from, node.to]);
      }
    },
  });
  const inCode = (at: number): boolean => code.some(([from, to]) => at >= from && at < to);

  const out = src.replace(/\[\^([^\]\s]+)\]/g, (whole, label: string, at: number) => {
    // A definition line (`[^a]: ...`) is not a reference to itself.
    if (src.startsWith(":", at + whole.length)) return whole;
    if (!footnotes.has(label) || inCode(at)) return whole;
    let index = refs.indexOf(label);
    if (index < 0) index = refs.push(label) - 1;
    return `${FN_OPEN}${index}${FN_CLOSE}`;
  });
  return { src: out, refs };
}

/** Swap the sentinels for numbered superscript links. */
function fillFootnoteRefs(html: string, refs: string[]): string {
  if (!refs.length) return html;
  return html.replace(new RegExp(`${FN_OPEN}(\\d+)${FN_CLOSE}`, "g"), (_whole, digits: string) => {
    const label = refs[Number(digits)];
    if (label === undefined) return "";
    const ref = escAttr(slug(label));
    const number = Number(digits) + 1;
    return `<sup class="td-fnref" id="fnref-${ref}"><a href="#fn-${ref}">${number}</a></sup>`;
  });
}

/** The footnote list, in reference order. Definitions nothing refers to are left
 * out rather than dangling at the end of the document. */
function emitFootnoteSection(ctx: Ctx, refs: string[]): string {
  if (!refs.length) return "";
  const items = refs
    .map((label) => {
      const ref = escAttr(slug(label));
      const text = inlineText(ctx.footnotes.get(label) ?? "");
      return `<li id="fn-${ref}">${text} <a href="#fnref-${ref}" class="td-fnback">&#8617;</a></li>\n`;
    })
    .join("");
  return `<hr class="td-fn-sep">\n<ol class="td-footnotes">\n${items}</ol>\n`;
}

// ---- helpers --------------------------------------------------------------

/** The visible text of a node, syntax marks and all: only used for slugs. */
function plain(node: SyntaxNode, src: string): string {
  return src
    .slice(node.from, node.to)
    .replace(/^#{1,6}\s*/, "")
    .replace(/\s*#*\s*$/, "");
}

/** GitHub-style heading slug, so in-document `#anchor` links resolve. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

// ---- stylesheet -----------------------------------------------------------
//
// Written for plain HTML rather than reusing theme.css, which is almost entirely
// CodeMirror selectors (`.cm-*`) that no exported document has. The colour
// values are the light palette's, so an export looks like the editor's light
// theme, which is also the right choice for paper and PDF. Deliberately
// light-only: a dark-background PDF is nobody's friend.
const EXPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #ffffff;
  color: #1f2328;
  font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
}
.td-export { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
.td-export > :first-child { margin-top: 0; }

h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.25; font-weight: 600; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #59636e; }
p { margin: 0 0 1em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
strong { font-weight: 600; }
hr { height: 0; margin: 2em 0; border: 0; border-top: 1px solid #d1d9e0; }
img { max-width: 100%; height: auto; }

ul, ol { margin: 0 0 1em; padding-left: 2em; }
li { margin: 0.25em 0; }
li > ul, li > ol { margin: 0.25em 0 0; }
li.td-task { list-style: none; margin-left: -1.4em; }
li.td-task > input { margin-right: 0.4em; vertical-align: middle; }

blockquote {
  margin: 0 0 1em;
  padding: 0 1em;
  color: #59636e;
  border-left: 0.25em solid #d1d9e0;
}
blockquote > :last-child { margin-bottom: 0; }

code {
  padding: 0.2em 0.4em;
  border-radius: 6px;
  background: rgba(129, 139, 152, 0.12);
  color: #1f2328;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.875em;
}
pre {
  margin: 0 0 1em;
  padding: 1em;
  overflow-x: auto;
  border-radius: 6px;
  background: #f6f8fa;
  line-height: 1.45;
}
pre > code { padding: 0; background: none; font-size: 0.85em; }
pre.td-math > code { color: #59636e; }

table { margin: 0 0 1em; border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { padding: 0.4em 0.8em; border: 1px solid #d1d9e0; }
th { background: #e8ecf1; font-weight: 600; text-align: left; }
tbody tr:nth-child(2n) { background: #f6f8fa; }

.td-alert {
  margin: 0 0 1em;
  padding: 0.6em 1em;
  border-left: 0.25em solid #d1d9e0;
}
.td-alert > :last-child { margin-bottom: 0; }
.td-alert-title { font-weight: 600; margin-bottom: 0.3em; }
.td-alert-note { border-left-color: #0969da; }
.td-alert-note .td-alert-title { color: #0969da; }
.td-alert-tip { border-left-color: #1a7f37; }
.td-alert-tip .td-alert-title { color: #1a7f37; }
.td-alert-important { border-left-color: #8250df; }
.td-alert-important .td-alert-title { color: #8250df; }
.td-alert-warning { border-left-color: #9a6700; }
.td-alert-warning .td-alert-title { color: #9a6700; }
.td-alert-caution { border-left-color: #cf222e; }
.td-alert-caution .td-alert-title { color: #cf222e; }

.td-fnref { font-size: 0.75em; }
.td-fn-sep { margin-top: 3em; }
.td-footnotes { font-size: 0.875em; color: #59636e; }
.td-fnback { text-decoration: none; }

.td-tok-keyword { color: #cf222e; }
.td-tok-string { color: #0a3069; }
.td-tok-comment { color: #6e7781; font-style: italic; }
.td-tok-number { color: #0550ae; }
.td-tok-function { color: #8250df; }
.td-tok-variable { color: #953800; }
.td-tok-tag { color: #116329; }
.td-tok-attr { color: #0550ae; }
.td-tok-property { color: #0550ae; }
.td-tok-boolean { color: #0550ae; }
.td-tok-iri { color: #0a3069; }
.td-tok-prefixed { color: #8250df; }

@media print {
  /* The page margin is the printer's job; the on-screen inset would double it. */
  .td-export { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: underline; }
  pre, blockquote, table, .td-alert, img { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
}
`;
