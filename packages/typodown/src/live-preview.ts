// Live-preview decorations: the "Typora magic".
//
// A ViewPlugin walks the Lezer syntax tree over the visible viewport on every
// doc/selection change and produces a DecorationSet that:
//   - styles constructs (heading sizes, bold/italic, code, links, quotes),
//   - hides the raw markdown syntax marks (`**`, `#`, backticks, `[...](...)`)
//     unless the selection is on that construct, then it reveals them, so the
//     source is editable exactly where the caret is,
//   - replaces block constructs (checkboxes, images, rules, tables, raw HTML)
//     with real rendered widgets while idle.
//
// The document text stays the single source of truth; nothing here mutates it.

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { LANGUAGE_SUGGESTIONS, tokenize } from "./highlight.ts";

export interface LivePreviewConfig {
  /** Render raw HTML blocks/tags as live widgets while idle. */
  html: boolean;
}

export const ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
type AlertKind = (typeof ALERT_KINDS)[number];
const ALERT_LABEL: Record<AlertKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/** A selection is "on" a construct when any of its ranges overlaps [from, to].
 That is what reveals the raw syntax for the construct under the caret. */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** The document offset of the end of the always-hidden marker prefix on `line`
 * (indent + bullet/checkbox marker, or indent + `>` quote prefix), or null when
 * the line isn't a bullet/checkbox/quote marker line (ordered-list numbers stay
 * visible, and `- ` / `> ` inside a code block or table is left alone). Used to
 * build atomic ranges and to clamp the caret so it can never sit before or
 * inside the hidden marker. */
export function markerEndOnLine(
  state: EditorState,
  line: { from: number; text: string },
): number | null {
  const node = syntaxTree(state).resolveInner(line.from, 1);
  for (let a: typeof node | null = node; a; a = a.parent) {
    if (/FencedCode|CodeBlock|Table|HTMLBlock/.test(a.name)) return null;
  }
  const text = line.text;
  const bullet = /^(\s*)([-+*])( +)((?:\[[ xX]\] +)?)/.exec(text);
  if (bullet) return line.from + bullet[0].length;
  const quote = /^(\s*)((?:> ?)+)/.exec(text);
  if (quote) return line.from + quote[0].length;
  return null;
}

function sanitizeUrl(url: string): string {
  return /^\s*javascript:/i.test(url) ? "#" : url;
}

// ---- widgets --------------------------------------------------------------

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-td-task-box";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const ch = view.state.doc.sliceString(this.pos, this.pos + 1);
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: ch === " " ? "x" : " " },
      });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/** The bullet shape cycles with nesting depth, GitHub-style: disc, circle,
 square. The shapes are drawn in CSS (see `.cm-td-bullet-*`) so all three are a
 consistent size, rather than relying on wildly-sized Unicode glyphs.
 */
class BulletWidget extends WidgetType {
  constructor(readonly level: number) {
    super();
  }
  eq(other: BulletWidget): boolean {
    return other.level === this.level;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-td-bullet cm-td-bullet-${this.level % 3}`;
    return span;
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const hr = document.createElement("span");
    hr.className = "cm-td-hr";
    return hr;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = sanitizeUrl(this.src);
    img.alt = this.alt;
    img.className = "cm-td-image";
    return img;
  }
}

class HtmlWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly block: boolean,
  ) {
    super();
  }
  eq(other: HtmlWidget): boolean {
    return other.html === this.html && other.block === this.block;
  }
  toDOM(): HTMLElement {
    const host = document.createElement(this.block ? "div" : "span");
    host.className = "cm-td-html";
    const tpl = document.createElement("template");
    tpl.innerHTML = this.html;
    for (const a of tpl.content.querySelectorAll("a[href]")) {
      a.setAttribute("href", sanitizeUrl(a.getAttribute("href") ?? ""));
    }
    host.appendChild(tpl.content);
    return host;
  }
  // Let a click on <summary> toggle its <details> natively instead of moving
  // the caret into the block (which would replace the widget with raw source
  // before the browser gets to expand it).
  ignoreEvent(event: Event): boolean {
    return !!(event.target as HTMLElement | null)?.closest("summary");
  }
}

// KaTeX CSS is loaded once, from a CDN whose version matches the bundled katex
// module. The stylesheet is needed for the math fonts to render; without it the
// KaTeX HTML structure still shows but with wrong glyphs. A CDN link keeps the
// library bundle small and works in every embedding context (web, VS Code
// webview) without shipping ~1 MB of font files.
let katexCssLoaded = false;
function ensureKatexCss(version: string): void {
  if (katexCssLoaded) return;
  katexCssLoaded = true;
  if (document.querySelector("link[data-td-katex]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://cdn.jsdelivr.net/npm/katex@${version}/dist/katex.min.css`;
  link.dataset.tdKatex = "";
  document.head.appendChild(link);
}

// Renders lazily: `katex` is only imported the first time a math construct is
// actually idle (not being edited), matching the mermaid pattern.
class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display;
  }
  toDOM(): HTMLElement {
    const host = document.createElement(this.display ? "div" : "span");
    host.className = this.display ? "cm-td-math cm-td-math-block" : "cm-td-math";
    void import("katex")
      .then(({ default: katex, version }) => {
        ensureKatexCss(version);
        host.innerHTML = katex.renderToString(this.source, {
          displayMode: this.display,
          throwOnError: false,
        });
      })
      .catch((error: unknown) => {
        host.classList.add("cm-td-math-error");
        host.textContent = error instanceof Error ? error.message : String(error);
      });
    return host;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

let mermaidSeq = 0;

// Renders lazily: `mermaid` is a large dependency, so it is only imported the
// first time a mermaid code block is actually idle (not being edited).
class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }
  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-td-mermaid";
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const { svg } = await mermaid.render(`cm-td-mermaid-${mermaidSeq++}`, this.source);
        host.innerHTML = svg;
      })
      .catch((error: unknown) => {
        host.classList.add("cm-td-mermaid-error");
        host.textContent = error instanceof Error ? error.message : String(error);
      });
    return host;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }
  toDOM(): HTMLElement {
    return renderTable(this.source);
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const LANG_DATALIST_ID = "cm-td-langs";

// The language selector for an active code block. It is absolutely positioned
// so it floats just outside the block's corner without changing the block's
// size, and edits the opening fence's info string (on the hidden opening line)
// so the source stays canonical. The <datalist> suggests known languages while
// still allowing any free-text value.
class LanguageWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly infoFrom: number,
    readonly infoTo: number,
  ) {
    super();
  }
  eq(other: LanguageWidget): boolean {
    return (
      other.lang === this.lang && other.infoFrom === this.infoFrom && other.infoTo === this.infoTo
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-td-lang";
    wrap.contentEditable = "false";

    const input = document.createElement("input");
    input.className = "cm-td-lang-input";
    input.value = this.lang;
    input.placeholder = "language";
    input.spellcheck = false;
    input.setAttribute("list", LANG_DATALIST_ID);
    input.setAttribute("aria-label", "Code block language");
    const commit = (): void => {
      const value = input.value.trim();
      if (value !== this.lang) {
        view.dispatch({ changes: { from: this.infoFrom, to: this.infoTo, insert: value } });
      }
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        view.focus();
      }
    });
    wrap.appendChild(input);

    if (!document.getElementById(LANG_DATALIST_ID)) {
      const list = document.createElement("datalist");
      list.id = LANG_DATALIST_ID;
      for (const name of LANGUAGE_SUGGESTIONS) {
        const option = document.createElement("option");
        option.value = name;
        list.appendChild(option);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class AlertLabelWidget extends WidgetType {
  constructor(readonly kind: AlertKind) {
    super();
  }
  eq(other: AlertLabelWidget): boolean {
    return other.kind === this.kind;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-td-alert-title cm-td-alert-${this.kind}`;
    span.dataset.label = ALERT_LABEL[this.kind];
    return span;
  }
}

// Parser for the inline markdown inside table cells (code spans, emphasis,
// links). The editor's own parser runs through CodeMirror; this standalone
// instance is only used to turn a cell's raw text into DOM while idle.
const inlineParser = parser.configure(GFM);

// Syntax markers (`**`, backticks, `]`...) are children of the constructs they
// wrap. They carry no rendered content, so the inline walker skips them and
// relies on the text gaps between them for the visible text.
const MARK_NAMES = new Set([
  "CodeMark",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "ImageMark",
  "HeaderMark",
  "QuoteMark",
]);

/** Split a markdown table row into cells. A `|` inside a backtick code span or
 * after a backslash is content, not a delimiter (per the GFM spec). Leading
 * and trailing pipes are stripped. */
export function splitCells(line: string): string[] {
  const s = line.replace(/^[ \t]*\|/, "").replace(/\|[ \t]*$/, "");
  const cells: string[] = [];
  let buf = "";
  let i = 0;
  while (i < s.length) {
    const ch = s.charCodeAt(i);
    if (ch === 92 /* \ */) {
      buf += s[i]! + (s[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === 96 /* ` */) {
      // Opening backtick run; the code span closes at the next run of equal
      // or greater length. Pipes between are literal.
      let n = 0;
      while (s.charCodeAt(i + n) === 96) n++;
      const open = i;
      i += n;
      let closed = false;
      while (i < s.length) {
        if (s.charCodeAt(i) === 96) {
          let m = 0;
          while (s.charCodeAt(i + m) === 96) m++;
          if (m >= n) {
            buf += s.slice(open, i + m);
            i += m;
            closed = true;
            break;
          }
          i += m;
        } else {
          i++;
        }
      }
      if (!closed) {
        buf += s.slice(open, open + n);
        i = open + n;
      }
      continue;
    }
    if (ch === 124 /* | */) {
      cells.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += s[i]!;
    i++;
  }
  cells.push(buf);
  return cells.map((c) => c.trim());
}

/** A GFM table delimiter row: every cell is dashes with optional leading /
 * trailing alignment colons. */
export function isDelimRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

// A code span's content: the source between its first and last CodeMark, with
// newlines folded to spaces and a single surrounding space stripped when the
// content has both (mirrors the CommonMark code-span rule).
function codeSpanText(node: SyntaxNode, src: string): string {
  const marks = node.getChildren("CodeMark");
  if (marks.length < 2) return src.slice(node.from, node.to);
  let text = src.slice(marks[0]!.to, marks[marks.length - 1]!.from).replace(/\n/g, " ");
  if (text.length > 0 && text.startsWith(" ") && text.endsWith(" ") && text.trim().length > 0) {
    text = text.slice(1, -1);
  }
  return text;
}

function emitChildren(node: SyntaxNode, parent: Node, src: string): void {
  let pos = node.from;
  for (const child of children(node)) {
    if (child.from > pos) parent.appendChild(document.createTextNode(src.slice(pos, child.from)));
    emitNode(child, parent, src);
    pos = child.to;
  }
  if (pos < node.to) parent.appendChild(document.createTextNode(src.slice(pos, node.to)));
}

// Emit only the inline content of `node` that falls between `from` and `to`
// (used for a link's bracketed text, which excludes the `(url)` destination).
function emitRange(node: SyntaxNode, parent: Node, src: string, from: number, to: number): void {
  let pos = from;
  for (const child of children(node)) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos) parent.appendChild(document.createTextNode(src.slice(pos, child.from)));
    emitNode(child, parent, src);
    pos = child.to;
  }
  if (pos < to) parent.appendChild(document.createTextNode(src.slice(pos, to)));
}

// All direct children of a node, in source order. (@lezer/common's getChildren
// needs a node-type filter, so iterate the sibling chain for the unfiltered set.)
function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let n = node.firstChild; n; n = n.nextSibling) out.push(n);
  return out;
}

function emitNode(node: SyntaxNode, parent: Node, src: string): void {
  if (MARK_NAMES.has(node.name)) return;
  switch (node.name) {
    case "Escape":
      parent.appendChild(document.createTextNode(src.slice(node.from + 1, node.to)));
      return;
    case "HardBreak":
      parent.appendChild(document.createElement("br"));
      return;
    case "SoftBreak":
      parent.appendChild(document.createTextNode(" "));
      return;
    case "Emphasis": {
      const el = document.createElement("em");
      emitChildren(node, el, src);
      parent.appendChild(el);
      return;
    }
    case "StrongEmphasis": {
      const el = document.createElement("strong");
      emitChildren(node, el, src);
      parent.appendChild(el);
      return;
    }
    case "Strikethrough": {
      const el = document.createElement("s");
      emitChildren(node, el, src);
      parent.appendChild(el);
      return;
    }
    case "InlineCode": {
      const code = document.createElement("code");
      code.textContent = codeSpanText(node, src);
      parent.appendChild(code);
      return;
    }
    case "Autolink": {
      const urlNode = node.getChild("URL");
      const url = urlNode ? src.slice(urlNode.from, urlNode.to) : "";
      const href = url.includes("@") && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? `mailto:${url}` : url;
      const a = document.createElement("a");
      a.href = sanitizeUrl(href);
      a.textContent = url;
      parent.appendChild(a);
      return;
    }
    case "Link": {
      const marks = node.getChildren("LinkMark");
      const a = document.createElement("a");
      // An inline destination `[t](url)` has 4 marks; reference forms are left
      // un-resolved (a cell has no document-level reference definitions).
      if (marks.length >= 3) {
        const urlNode = node.getChild("URL");
        if (urlNode) {
          let url = src.slice(urlNode.from, urlNode.to);
          if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
          a.href = sanitizeUrl(url);
        }
      }
      if (marks.length >= 2) {
        emitRange(node, a, src, marks[0]!.to, marks[1]!.from);
      } else {
        emitChildren(node, a, src);
      }
      parent.appendChild(a);
      return;
    }
    case "Image": {
      const marks = node.getChildren("ImageMark");
      const img = document.createElement("img");
      if (marks.length >= 3) {
        const urlNode = node.getChild("URL");
        if (urlNode) {
          let url = src.slice(urlNode.from, urlNode.to);
          if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
          img.src = sanitizeUrl(url);
        }
      }
      if (marks.length >= 2) img.alt = src.slice(marks[0]!.to, marks[1]!.from).trim();
      parent.appendChild(img);
      return;
    }
    case "URL": {
      // Bare GFM autolink URL not wrapped in a Link/Autolink.
      const url = src.slice(node.from, node.to);
      const a = document.createElement("a");
      a.href = sanitizeUrl(url);
      a.textContent = url;
      parent.appendChild(a);
      return;
    }
    case "HTMLTag":
      parent.appendChild(document.createTextNode(src.slice(node.from, node.to)));
      return;
    default:
      emitChildren(node, parent, src);
  }
}

/** Render a table cell's inline markdown to a DOM fragment. Falls back to
 * plain text if parsing fails for any reason. */
export function renderInline(text: string): Node {
  const frag = document.createDocumentFragment();
  if (text === "") return frag;
  try {
    emitChildren(inlineParser.parse(text).topNode, frag, text);
    if (frag.childNodes.length === 0) frag.textContent = text;
    return frag;
  } catch {
    frag.textContent = text;
    return frag;
  }
}

function renderTable(source: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cm-td-table-wrap";
  const rows = source.split("\n").filter((l) => l.trim() !== "" && l.includes("|"));
  if (rows.length < 2) {
    wrap.textContent = source;
    return wrap;
  }
  const align = splitCells(rows[1]!).map((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
  const table = document.createElement("table");
  table.className = "cm-td-table";
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  splitCells(rows[0]!).forEach((c, i) => {
    const th = document.createElement("th");
    th.appendChild(renderInline(c));
    if (align[i]) th.style.textAlign = align[i]!;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const line of rows.slice(2)) {
    const tr = document.createElement("tr");
    const cs = splitCells(line);
    splitCells(rows[0]!).forEach((_, i) => {
      const td = document.createElement("td");
      td.appendChild(renderInline(cs[i] ?? ""));
      if (align[i]) td.style.textAlign = align[i]!;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ---- reusable decorations -------------------------------------------------

const hide = Decoration.replace({});
const markFaint = Decoration.mark({ class: "cm-td-mark" });

// ---- the builder ----------------------------------------------------------

class DecoBuilder {
  readonly out: Range<Decoration>[] = [];
  constructor(
    readonly state: EditorState,
    readonly config: LivePreviewConfig,
  ) {}

  private on(from: number, to: number): boolean {
    return touches(this.state, from, to);
  }

  private line(pos: number, cls: string): void {
    this.out.push(Decoration.line({ class: cls }).range(this.state.doc.lineAt(pos).from));
  }

  private mark(from: number, to: number, cls: string): void {
    if (to > from) this.out.push(Decoration.mark({ class: cls }).range(from, to));
  }

  // Hide a syntax mark when idle; when the construct is active show it faint.
  private syntax(from: number, to: number, active: boolean): void {
    if (to <= from) return;
    this.out.push((active ? markFaint : hide).range(from, to));
  }

  private replaceWith(from: number, to: number, widget: WidgetType, block = false): void {
    this.out.push(Decoration.replace({ widget, block }).range(from, to));
  }

  build(from: number, to: number): void {
    const tree = syntaxTree(this.state);
    tree.iterate({
      from,
      to,
      enter: (node) => this.enter(node),
    });
    this.collapseBlankSeparators(from, to, tree);
  }

  // A run of one or more blank lines between two content lines is the Markdown
  // paragraph separator, however many raw blank lines it happens to contain
  // (Enter always adds a full "\n\n", so splitting between two already-blank-
  // line-separated paragraphs produces a 3-line run, not just 2). Rather than
  // show the run as a stack of empty lines, every line in it collapses
  // (`display:none`) except one: the line the caret is on, if any, which stays
  // open so it can be edited, or otherwise the whole run collapses and the
  // paragraph gap becomes padding on the next content line. Blank lines inside
  // a fenced code block are left alone entirely.
  private collapseBlankSeparators(
    from: number,
    to: number,
    tree: ReturnType<typeof syntaxTree>,
  ): void {
    const doc = this.state.doc;
    let n = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    while (n <= last) {
      const line = doc.line(n);
      if (line.length !== 0) {
        n++;
        continue;
      }
      let runEnd = n;
      while (runEnd < doc.lines && doc.line(runEnd + 1).length === 0) runEnd++;
      if (n === 1) {
        n = runEnd + 1; // leading blank run: leave it alone entirely
        continue;
      }

      const node = tree.resolveInner(line.from, 1);
      let inBlock = false;
      for (let a: typeof node | null = node; a; a = a.parent) {
        if (/FencedCode|CodeBlock|Table|HTMLBlock/.test(a.name)) {
          inBlock = true;
          break;
        }
      }
      if (inBlock) {
        n = runEnd + 1;
        continue;
      }

      let openLine: ReturnType<typeof doc.line> | null = null;
      for (let m = n; m <= runEnd; m++) {
        const candidate = doc.line(m);
        if (this.on(candidate.from, candidate.from)) {
          openLine = candidate;
          break;
        }
      }

      const afterRun = runEnd < doc.lines ? doc.line(runEnd + 1) : null;
      const enters = (target: ReturnType<typeof doc.line> | null, name: string): boolean => {
        if (!target) return false;
        for (let a: typeof node | null = tree.resolveInner(target.from, 1); a; a = a.parent) {
          if (
            (name === "heading" ? /^ATXHeading[1-6]$/.test(a.name) : a.name === name) &&
            doc.lineAt(a.from).number === target.number
          ) {
            return true;
          }
        }
        return false;
      };

      if (openLine) {
        // Only the blank line(s) immediately touching the caret collapse --
        // they exist purely to keep the caret's line separated from whatever
        // precedes and follows it. Anything beyond that in the run is an
        // intentional extra blank line (e.g. pressing Enter again while
        // already on a blank line to add more space) and stays visible, or
        // that action would have no visible effect.
        if (openLine.number - 1 >= n) {
          this.out.push(
            Decoration.line({ class: "cm-td-blank-sep" }).range(doc.line(openLine.number - 1).from),
          );
        }
        if (openLine.number + 1 <= runEnd) {
          this.out.push(
            Decoration.line({ class: "cm-td-blank-sep" }).range(doc.line(openLine.number + 1).from),
          );
        }
        // Gaps go exactly where they would if the caret's line had text, so
        // typing the first character into the empty line never shifts the
        // layout: a top gap on the caret's line when a single collapsed
        // blank separates it from the content above (a single-blank run
        // would put the gap there once typed), and a top gap on the
        // following content line when a single collapsed blank separates it
        // from the caret's line -- unless that's a heading or fenced code
        // block, which carry their own constant top gap (theme.css). With
        // no blank on a given side, the typed line would join the adjacent
        // paragraph, so that side gets no gap either.
        if (openLine.number - 1 === n) {
          this.out.push(Decoration.line({ class: "cm-td-para-gap" }).range(openLine.from));
        }
        if (
          openLine.number + 1 === runEnd &&
          afterRun &&
          !enters(afterRun, "heading") &&
          !enters(afterRun, "FencedCode")
        ) {
          this.out.push(Decoration.line({ class: "cm-td-para-gap" }).range(afterRun.from));
        }
      } else {
        // No caret in the run: only its first line collapses (the one
        // structurally needed to connect to whatever precedes it). Any
        // further blank lines stay visible -- same "intentional extra blank
        // line" rule as the caret case, so they don't flicker in and out of
        // view depending on whether the caret currently happens to be
        // sitting in this exact run (e.g. typing into one of several blank
        // lines shouldn't make the others disappear, and deleting back out
        // shouldn't make them "reappear" -- they were there the whole time).
        this.out.push(Decoration.line({ class: "cm-td-blank-sep" }).range(line.from));
      }
      // Headings and fenced code blocks carry their own constant top gap
      // (theme.css), so no paragraph gap is added before them -- their
      // spacing stays the same whether or not a blank line precedes them.
      if (
        !openLine &&
        n === runEnd &&
        afterRun &&
        !enters(afterRun, "heading") &&
        !enters(afterRun, "FencedCode")
      ) {
        this.out.push(Decoration.line({ class: "cm-td-para-gap" }).range(afterRun.from));
      }

      n = runEnd + 1;
    }
  }

  private enter(node: SyntaxNodeRef): void {
    const name = node.name;

    if (/^ATXHeading[1-6]$/.test(name)) {
      this.heading(node, Number(name.slice(-1)));
      return;
    }
    switch (name) {
      case "Emphasis":
        this.emphasis(node, "cm-td-em");
        return;
      case "StrongEmphasis":
        this.emphasis(node, "cm-td-strong");
        return;
      case "Strikethrough":
        this.emphasis(node, "cm-td-strike");
        return;
      case "InlineCode":
        this.inlineCode(node);
        return;
      case "FencedCode":
        this.fenced(node);
        return;
      case "Link":
        this.link(node);
        return;
      case "Autolink":
        this.autolink(node);
        return;
      case "URL":
        // A bare GFM autolink (not wrapped in a Link/Autolink) is just styled.
        if (!node.node.parent || !/Link/.test(node.node.parent.name)) {
          this.mark(node.from, node.to, "cm-td-link");
        }
        return;
      case "Image":
        this.image(node);
        return;
      case "Blockquote":
        this.blockquote(node);
        return;
      case "ListItem":
        this.listItem(node);
        return;
      case "HorizontalRule":
        this.horizontalRule(node);
        return;
      case "HTMLTag":
        this.htmlInline(node);
        return;
      case "MathInline":
        this.mathInline(node);
        return;
      default:
        return;
    }
  }

  private children(node: SyntaxNodeRef): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (let c = node.node.firstChild; c; c = c.nextSibling) out.push(c);
    return out;
  }

  private heading(node: SyntaxNodeRef, level: number): void {
    const line = this.state.doc.lineAt(node.from);
    this.line(node.from, `cm-td-heading cm-td-h${level}`);
    const marks = this.children(node).filter((c) => c.name === "HeaderMark");
    const opening = marks[0];
    if (!opening) return;
    // Reveal the "## " only when the caret is at the start of the line.
    let markEnd = opening.to;
    while (this.state.doc.sliceString(markEnd, markEnd + 1) === " ") markEnd++;
    const active = this.on(line.from, markEnd);
    this.syntax(opening.from, markEnd, active);
    // Closing "###" of a "### foo ###" heading.
    const closing = marks[1];
    if (closing) this.syntax(closing.from, closing.to, active);
  }

  private emphasis(node: SyntaxNodeRef, cls: string): void {
    const active = this.on(node.from, node.to);
    this.mark(node.from, node.to, cls);
    for (const c of this.children(node)) {
      if (c.name === "EmphasisMark" || c.name === "StrikethroughMark") {
        this.syntax(c.from, c.to, active);
      }
    }
  }

  private inlineCode(node: SyntaxNodeRef): void {
    const active = this.on(node.from, node.to);
    const marks = this.children(node).filter((c) => c.name === "CodeMark");
    // Style only the inner content so the backticks sit outside the highlight.
    if (marks.length >= 2) {
      this.mark(marks[0]!.to, marks[1]!.from, "cm-td-inline-code");
    } else {
      this.mark(node.from, node.to, "cm-td-inline-code");
    }
    for (const c of marks) this.syntax(c.from, c.to, active);
  }

  private fenced(node: SyntaxNodeRef): void {
    const doc = this.state.doc;
    const marks = node.node.getChildren("CodeMark");
    const info = node.node.getChild("CodeInfo");
    const codeText = node.node.getChild("CodeText");
    const openLine = doc.lineAt(node.from);
    const closeLine = marks.length >= 2 ? doc.lineAt(marks[marks.length - 1]!.from) : null;
    const active = this.on(node.from, node.to);
    const lang = info ? doc.sliceString(info.from, info.to).trim() : "";
    // While idle, a mermaid block renders as a diagram widget at the block
    // level (see `buildBlocks`) instead of as styled/highlighted code lines.
    if (lang.toLowerCase() === "mermaid" && !active) return;

    // The backticks are never shown: both fence lines are dropped from layout,
    // so the block is exactly its content lines and never changes size.
    this.out.push(Decoration.line({ class: "cm-td-fence-hidden" }).range(openLine.from));
    if (closeLine) {
      this.out.push(Decoration.line({ class: "cm-td-fence-hidden" }).range(closeLine.from));
    }

    // Content lines: the styled code area (background + rounded corners).
    const blockEnd = doc.lineAt(node.to > node.from ? node.to - 1 : node.to).number;
    const firstContent = openLine.number + 1;
    const lastContent = (closeLine ? closeLine.number : blockEnd + 1) - 1;
    for (let n = firstContent; n <= lastContent && n <= doc.lines; n++) {
      const line = doc.line(n);
      const cls = ["cm-td-code"];
      if (n === firstContent) cls.push("cm-td-code-top");
      if (n === lastContent) cls.push("cm-td-code-bottom");
      this.out.push(Decoration.line({ class: cls.join(" ") }).range(line.from));
    }

    // The language selector floats just outside the block's corner while active
    // (a point widget on the last content line, absolutely positioned), so it
    // never adds a row to the block.
    if (active && lastContent >= firstContent && lastContent <= doc.lines) {
      const infoFrom = info ? info.from : marks[0]!.to;
      const infoTo = info ? info.to : openLine.to;
      this.out.push(
        Decoration.widget({
          widget: new LanguageWidget(lang, infoFrom, infoTo),
          side: 1,
        }).range(doc.line(lastContent).to),
      );
    }

    // Syntax highlighting of the code content.
    if (codeText) {
      const text = doc.sliceString(codeText.from, codeText.to);
      for (const tok of tokenize(text, lang)) {
        this.mark(codeText.from + tok.from, codeText.from + tok.to, `cm-td-tok-${tok.type}`);
      }
    }
  }

  private link(node: SyntaxNodeRef): void {
    // A GFM alert marker like `[!NOTE]` is parsed as a shortcut link; leave it to
    // the blockquote handler (which renders the alert label) so the two don't
    // fight over the same range.
    if (
      /^\[!(note|tip|important|warning|caution)\]$/i.test(
        this.state.doc.sliceString(node.from, node.to),
      )
    ) {
      return;
    }
    const active = this.on(node.from, node.to);
    this.mark(node.from, node.to, "cm-td-link");
    for (const c of this.children(node)) {
      if (c.name === "LinkMark" || c.name === "URL" || c.name === "LinkTitle") {
        this.syntax(c.from, c.to, active);
      }
    }
  }

  private autolink(node: SyntaxNodeRef): void {
    const active = this.on(node.from, node.to);
    this.mark(node.from, node.to, "cm-td-link");
    // Hide the surrounding < > delimiters unless the caret is on the autolink.
    this.syntax(node.from, node.from + 1, active);
    this.syntax(node.to - 1, node.to, active);
  }

  private image(node: SyntaxNodeRef): void {
    const doc = this.state.doc;
    const raw = doc.sliceString(node.from, node.to);
    const m = /^!\[([^\]]*)\]\(([^)\s]*)/.exec(raw);
    if (!m) return;
    if (this.on(node.from, node.to)) {
      // Editing: show the raw markdown, and keep a preview of the image to the
      // right of it so it stays visible while you edit the source.
      this.mark(node.from, node.to, "cm-td-mark");
      this.out.push(
        Decoration.widget({
          widget: new ImageWidget(m[2] ?? "", m[1] ?? ""),
          side: 1,
        }).range(node.to),
      );
      return;
    }
    this.replaceWith(node.from, node.to, new ImageWidget(m[2] ?? "", m[1] ?? ""));
  }

  private blockquote(node: SyntaxNodeRef): void {
    const doc = this.state.doc;
    const startLine = doc.lineAt(node.from).number;
    const endLine = doc.lineAt(node.to > node.from ? node.to - 1 : node.to).number;
    const firstText = doc.sliceString(node.from, doc.line(startLine).to);
    const alertMatch = /^\s*>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(firstText);
    const kind = alertMatch ? (alertMatch[1]!.toLowerCase() as AlertKind) : null;
    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      const cls = ["cm-td-quote"];
      if (kind) cls.push("cm-td-alert", `cm-td-alert-${kind}`);
      // An empty `>` line is a paragraph separator inside the blockquote.
      // Collapse it (unless the caret is on it) so it doesn't take up a line,
      // the same way blank paragraph separators are collapsed.
      if (/^>\s*$/.test(line.text) && !this.on(line.from, line.to)) {
        cls.push("cm-td-quote-empty");
      }
      this.out.push(Decoration.line({ class: cls.join(" ") }).range(line.from));
    }
    // Always hide the "> " marker on each line; the raw marker is never shown
    // (Typora-style), even when the caret is on the line.
    for (const qm of this.collect(node, "QuoteMark")) {
      let end = qm.to;
      if (doc.sliceString(end, end + 1) === " ") end++;
      this.syntax(qm.from, end, false);
    }
    // Replace the "[!NOTE]" marker with a styled label while idle.
    if (kind && alertMatch) {
      const line = doc.line(startLine);
      const markerStart = node.from + alertMatch[0].indexOf("[!");
      const markerEnd = node.from + alertMatch[0].length;
      if (this.on(line.from, markerEnd)) {
        this.mark(markerStart, markerEnd, "cm-td-mark");
      } else {
        this.replaceWith(markerStart, markerEnd, new AlertLabelWidget(kind));
      }
    }
  }

  // Descendant nodes of `node` with a given name (marks can be nested in cells).
  private collect(node: SyntaxNodeRef, wanted: string): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    const cursor = node.node.cursor();
    if (!cursor.firstChild()) return out;
    do {
      if (cursor.name === wanted) out.push(cursor.node);
      // descend
      if (cursor.firstChild()) {
        do {
          if (cursor.name === wanted) out.push(cursor.node);
        } while (cursor.nextSibling());
        cursor.parent();
      }
    } while (cursor.nextSibling());
    return out;
  }

  private listItem(node: SyntaxNodeRef): void {
    const doc = this.state.doc;
    const children = this.children(node);
    const listMark = children.find((c) => c.name === "ListMark");
    const task = children.find((c) => c.name === "Task");
    if (!listMark) return;
    const ordered = /\d/.test(doc.sliceString(listMark.from, listMark.to));

    if (task) {
      const marker = task.node.getChild("TaskMarker");
      // Always hide "- " and replace "[ ]"/"[x]" with a checkbox, even when the
      // caret is on the line: the raw marker is never shown (Typora-style).
      this.syntax(listMark.from, this.afterSpace(listMark.to), false);
      if (marker) {
        const checked = doc.sliceString(marker.from, marker.to).toLowerCase().includes("x");
        const boxPos =
          doc.sliceString(marker.from, marker.from + 1) === "[" ? marker.from + 1 : marker.from;
        let end = marker.to;
        if (doc.sliceString(end, end + 1) === " ") end++;
        this.replaceWith(marker.from, end, new CheckboxWidget(checked, boxPos));
      }
      return;
    }

    const markEnd = this.afterSpace(listMark.to);
    if (ordered) {
      // Keep the ordered number visible; just style it faint.
      this.mark(listMark.from, listMark.to, "cm-td-list-mark");
    } else {
      // Replace "- " with a rendered bullet whose style cycles with nesting.
      // The raw marker is never shown, even when the caret is on the line.
      this.replaceWith(listMark.from, markEnd, new BulletWidget(this.listLevel(node)));
    }
  }

  private afterSpace(pos: number): number {
    return this.state.doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos;
  }

  // 0-based nesting depth of a list item, from its BulletList ancestors.
  private listLevel(node: SyntaxNodeRef): number {
    let depth = 0;
    for (let a = node.node.parent; a; a = a.parent) {
      if (a.name === "BulletList") depth++;
    }
    return Math.max(0, depth - 1);
  }

  private horizontalRule(node: SyntaxNodeRef): void {
    const line = this.state.doc.lineAt(node.from);
    if (this.on(line.from, line.to)) {
      this.mark(node.from, node.to, "cm-td-mark");
    } else {
      this.replaceWith(node.from, node.to, new HrWidget());
    }
  }

  private htmlInline(node: SyntaxNodeRef): void {
    if (!this.config.html) return;
    const doc = this.state.doc;
    const raw = doc.sliceString(node.from, node.to);
    // Self-contained tags (void, self-closing) and comments render on their own.
    const standalone =
      /^<!--[\s\S]*-->$/.test(raw) ||
      /\/>\s*$/.test(raw) ||
      /^<(br|hr|img|input|wbr|area|col|embed|source|track)\b/i.test(raw);
    if (standalone) {
      if (this.on(node.from, node.to)) this.mark(node.from, node.to, "cm-td-html-raw");
      else this.replaceWith(node.from, node.to, new HtmlWidget(raw, false));
      return;
    }
    // An opening tag of a pair (e.g. <kbd>...</kbd>, <sub>...</sub>): render the
    // whole element as live inline HTML, found by scanning for its close tag.
    const open = /^<([a-zA-Z][\w-]*)\b[^>]*>$/.exec(raw);
    if (open) {
      const tag = open[1]!.toLowerCase();
      const rest = doc.sliceString(node.to, Math.min(doc.length, node.to + 2000));
      const idx = rest.toLowerCase().indexOf(`</${tag}>`);
      if (idx >= 0) {
        const spanTo = node.to + idx + tag.length + 3;
        if (this.on(node.from, spanTo)) this.mark(node.from, node.to, "cm-td-html-raw");
        else
          this.replaceWith(
            node.from,
            spanTo,
            new HtmlWidget(doc.sliceString(node.from, spanTo), false),
          );
        return;
      }
    }
    // Closing / unpaired tag: show the raw source faint.
    this.mark(node.from, node.to, "cm-td-html-raw");
  }

  private mathInline(node: SyntaxNodeRef): void {
    const doc = this.state.doc;
    const active = this.on(node.from, node.to);
    const marks = node.node.getChildren("MathMark");
    if (active) {
      for (const m of marks) this.syntax(m.from, m.to, true);
      return;
    }
    // `$$...$$` (2-char marks) renders in display mode, `$...$` inline.
    const display = marks.length >= 1 && marks[0]!.to - marks[0]!.from >= 2;
    const source =
      marks.length >= 2
        ? doc.sliceString(marks[0]!.to, marks[1]!.from)
        : doc.sliceString(node.from, node.to);
    this.replaceWith(node.from, node.to, new MathWidget(source, display));
  }
}

// ---- inline / line decorations (ViewPlugin, viewport-only) ----------------

function inlinePlugin(
  config: LivePreviewConfig,
): ViewPlugin<PluginValue & { decorations: DecorationSet }> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      treeLen: number;
      constructor(view: EditorView) {
        this.treeLen = syntaxTree(view.state).length;
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate): void {
        const treeLen = syntaxTree(u.view.state).length;
        if (u.docChanged || u.selectionSet || u.viewportChanged || treeLen !== this.treeLen) {
          this.treeLen = treeLen;
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new DecoBuilder(view.state, config);
        for (const { from, to } of view.visibleRanges) builder.build(from, to);
        return RangeSet.of(builder.out, true);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- block decorations (StateField) ---------------------------------------
//
// Multi-line replacements (rendered tables, HTML blocks) affect block layout,
// which CodeMirror only accepts from a state field, not a view plugin. There
// are few of these per document, so scanning the whole tree is cheap.

function buildBlocks(state: EditorState, config: LivePreviewConfig): DecorationSet {
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  // Ranges already claimed by a Lezer block construct (a recognised table,
  // code block, HTML block or math block). The lenient table scan skips these
  // so it only picks up tables the GFM grammar rejected, and never fires
  // inside code/HTML.
  const occupied: Array<[number, number]> = [];
  const claim = (from: number, to: number): void => {
    occupied.push([from, to]);
  };
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table") {
        claim(node.from, node.to);
        if (touches(state, node.from, node.to)) return;
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to > node.from ? node.to - 1 : node.to);
        out.push(
          Decoration.replace({
            widget: new TableWidget(doc.sliceString(first.from, last.to)),
            block: true,
          }).range(first.from, last.to),
        );
      } else if (node.name === "HTMLBlock") {
        claim(node.from, node.to);
        if (!config.html) return;
        if (touches(state, node.from, node.to)) return;
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to > node.from ? node.to - 1 : node.to);
        out.push(
          Decoration.replace({
            widget: new HtmlWidget(doc.sliceString(first.from, last.to), true),
            block: true,
          }).range(first.from, last.to),
        );
      } else if (node.name === "FencedCode") {
        claim(node.from, node.to);
        const info = node.node.getChild("CodeInfo");
        const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : "";
        if (lang !== "mermaid") return;
        if (touches(state, node.from, node.to)) return;
        const codeText = node.node.getChild("CodeText");
        const source = codeText ? doc.sliceString(codeText.from, codeText.to) : "";
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to > node.from ? node.to - 1 : node.to);
        out.push(
          Decoration.replace({
            widget: new MermaidWidget(source),
            block: true,
          }).range(first.from, last.to),
        );
      } else if (node.name === "MathBlock") {
        claim(node.from, node.to);
        if (touches(state, node.from, node.to)) return;
        const marks = node.node.getChildren("MathMark");
        const source =
          marks.length >= 2
            ? doc.sliceString(marks[0]!.to, marks[1]!.from)
            : doc.sliceString(node.from + 2, node.to - 2);
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to > node.from ? node.to - 1 : node.to);
        out.push(
          Decoration.replace({
            widget: new MathWidget(source, true),
            block: true,
          }).range(first.from, last.to),
        );
      } else if (node.name === "CodeBlock") {
        claim(node.from, node.to);
      }
    },
  });
  findLenientTables(state, occupied, out);
  return RangeSet.of(out, true);
}

/** A second pass that catches tables the Lezer GFM grammar rejects -- e.g.
 * when the delimiter row has a different column count than the header, common
 * when a union type like `` `"light" | "dark" | "auto"` `` is written with its
 * pipes inside a code span that the grammar still counts as a column. Typora
 * renders these, so typodown does too. Skips any range Lezer already claimed. */
export function findLenientTables(
  state: EditorState,
  occupied: Array<[number, number]>,
  out: Range<Decoration>[],
): void {
  const doc = state.doc;
  const inOccupied = (from: number, to: number): boolean =>
    occupied.some(([a, b]) => from < b && to > a);
  const n = doc.lines;
  let i = 1;
  while (i <= n) {
    const header = doc.line(i);
    if (inOccupied(header.from, header.to)) {
      i++;
      continue;
    }
    if (i + 1 > n) break;
    const delim = doc.line(i + 1);
    if (inOccupied(delim.from, delim.to)) {
      i++;
      continue;
    }
    if (!header.text.includes("|") || !delim.text.includes("|")) {
      i++;
      continue;
    }
    if (!isDelimRow(splitCells(delim.text))) {
      i++;
      continue;
    }
    // Header + delimiter confirmed: consume contiguous body rows.
    let end = i + 1;
    while (end + 1 <= n) {
      const bl = doc.line(end + 1);
      if (inOccupied(bl.from, bl.to)) break;
      if (bl.text.trim() === "" || !bl.text.includes("|")) break;
      end++;
    }
    const first = header;
    const last = doc.line(end);
    if (!touches(state, first.from, last.to)) {
      out.push(
        Decoration.replace({
          widget: new TableWidget(doc.sliceString(first.from, last.to)),
          block: true,
        }).range(first.from, last.to),
      );
    }
    i = end + 1;
  }
}

function blockField(
  config: LivePreviewConfig,
): StateField<{ deco: DecorationSet; treeLen: number }> {
  return StateField.define<{ deco: DecorationSet; treeLen: number }>({
    create: (state) => ({
      deco: buildBlocks(state, config),
      // The Lezer tree parses lazily: on initial load it is often partial, so
      // HTML blocks are missed at create time. Track how far the tree has
      // parsed and rebuild when it advances (CodeMirror dispatches a
      // transaction as the parse worker progresses).
      treeLen: syntaxTree(state).length,
    }),
    update(value, tr) {
      const treeLen = syntaxTree(tr.state).length;
      if (tr.docChanged || tr.selection || treeLen !== value.treeLen) {
        return { deco: buildBlocks(tr.state, config), treeLen };
      }
      return { deco: value.deco.map(tr.changes), treeLen };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
}

// ---- public extension -----------------------------------------------------

export function livePreview(config: LivePreviewConfig): Extension {
  return [inlinePlugin(config), blockField(config)];
}
