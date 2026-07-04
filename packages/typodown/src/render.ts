// Renders the AST into DOM.
//
// Alongside the DOM it collects two things:
//   - `pieces`: a map from every rendered Text node back to the source offset of
//     its first character, used by the editor to translate a caret offset into a
//     DOM position and back.
//   - `regions`: one entry per markdown construct that owns syntax (a heading, a
//     bold span, a list item, a blockquote line, ...), with its source range.
//
// Syntax characters are always rendered, wrapped in `.td-mark` spans that CSS
// hides by default. The editor adds `.td-on` to the region(s) the caret is
// actually inside, revealing only that construct's markers, the Typora
// behaviour, at the granularity of the individual construct rather than the
// whole block.

import type { Block, Inline, ListItem } from "./ast.ts";
import { tokenize } from "./highlight.ts";

export interface Piece {
  node: Text;
  from: number;
}

export interface Region {
  el: HTMLElement;
  from: number;
  to: number;
}

export interface BlockRender {
  el: HTMLElement;
  from: number;
  to: number;
  pieces: Piece[];
  regions: Region[];
}

interface Ctx {
  pieces: Piece[];
  regions: Region[];
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function sanitizeUrl(url: string): string {
  return /^\s*javascript:/i.test(url) ? "#" : url;
}

// HTML elements that never have a closing tag, so an inline tag like `<br>` or
// `<img>` stands on its own rather than opening a region.
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

type HtmlTagKind = "open" | "close" | "void" | "other";

// Classify a raw inline-HTML token: an opening tag that expects a matching
// close, a closing tag, a self-closing / void tag, or "other" (comment, CDATA,
// processing instruction, declaration) which never pairs.
function classifyHtmlTag(raw: string): { kind: HtmlTagKind; tag: string } {
  if (raw.startsWith("<!") || raw.startsWith("<?")) return { kind: "other", tag: "" };
  const close = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw);
  if (close) return { kind: "close", tag: close[1]!.toLowerCase() };
  const open = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw);
  if (!open) return { kind: "other", tag: "" };
  const tag = open[1]!.toLowerCase();
  if (VOID_TAGS.has(tag) || /\/>\s*$/.test(raw)) return { kind: "void", tag };
  return { kind: "open", tag };
}

// Build a live (empty) element from a raw opening tag, letting the browser parse
// attributes. Returns null when the tag does not yield an element (e.g. the HTML
// parser drops it in this context).
function liveElement(raw: string): HTMLElement | null {
  const template = document.createElement("template");
  template.innerHTML = raw;
  const first = template.content.firstElementChild;
  if (!(first instanceof HTMLElement)) return null;
  first.textContent = "";
  return first;
}

// Render a standalone inline-HTML token (void tag, comment, etc.). The rendered
// effect (`.td-html-view`) shows while idle; the raw source (`.td-mark`) reveals
// when the caret is on it.
function renderStandaloneHtml(
  node: Extract<Inline, { type: "html" }>,
  parent: Node,
  ctx: Ctx,
): void {
  const wrap = el("span", "td-html-inline");
  markSpan(wrap, node.raw, node.from, ctx, "td-html-raw");
  const view = el("span", "td-html-view");
  view.innerHTML = node.raw;
  wrap.appendChild(view);
  parent.appendChild(wrap);
  region(ctx, wrap, node.from, node.to);
}

function pushText(parent: Node, value: string, from: number, ctx: Ctx): void {
  const node = document.createTextNode(value);
  parent.appendChild(node);
  ctx.pieces.push({ node, from });
}

function markSpan(parent: Node, text: string, from: number, ctx: Ctx, extra?: string): HTMLElement {
  const span = el("span", extra ? `td-mark ${extra}` : "td-mark");
  pushText(span, text, from, ctx);
  parent.appendChild(span);
  return span;
}

function region(ctx: Ctx, el: HTMLElement, from: number, to: number): void {
  ctx.regions.push({ el, from, to });
}

// End of a single-line block's content, excluding the trailing newline so the
// reveal region does not bleed onto the following line (heading / hr).
function lineEnd(value: string, to: number): number {
  return to > 0 && value[to - 1] === "\n" ? to - 1 : to;
}

// Render an inline node list. Inline HTML tags are paired on a stack so a
// `<b>...</b>` run becomes a live `<b>` element wrapping its rendered children,
// with the raw `<b>` / `</b>` tags kept as hidden marks that reveal (dimmed)
// when the caret is on the construct, exactly like markdown emphasis.
function renderInline(nodes: Inline[], parent: Node, ctx: Ctx): void {
  interface Frame {
    el: HTMLElement;
    from: number;
    tag: string;
  }
  const stack: Frame[] = [];
  const host = (): Node => (stack.length ? stack[stack.length - 1]!.el : parent);
  let lastTo = -1;

  for (const node of nodes) {
    lastTo = Math.max(lastTo, node.to);
    if (node.type !== "html") {
      renderInlineNode(node, host(), ctx);
      continue;
    }
    const info = classifyHtmlTag(node.raw);
    if (info.kind === "open") {
      const live = liveElement(node.raw);
      if (!live) {
        renderStandaloneHtml(node, host(), ctx);
        continue;
      }
      markSpan(live, node.raw, node.from, ctx, "td-html-raw");
      host().appendChild(live);
      stack.push({ el: live, from: node.from, tag: info.tag });
    } else if (info.kind === "close") {
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === info.tag) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        renderStandaloneHtml(node, host(), ctx);
        continue;
      }
      const frame = stack[idx]!;
      markSpan(frame.el, node.raw, node.from, ctx, "td-html-raw");
      region(ctx, frame.el, frame.from, node.to);
      stack.length = idx;
    } else {
      renderStandaloneHtml(node, host(), ctx);
    }
  }

  // Tags left open (no matching close in this run) still reveal, up to the end
  // of the content they wrap.
  for (const frame of stack) region(ctx, frame.el, frame.from, lastTo);
}

function renderInlineNode(node: Inline, parent: Node, ctx: Ctx): void {
  switch (node.type) {
    case "text":
      pushText(parent, node.text, node.from, ctx);
      break;
    case "mark":
      markSpan(parent, node.text, node.from, ctx);
      break;
    case "emph": {
      let wrapper: HTMLElement;
      let host: HTMLElement;
      if (node.tag === "strongem") {
        wrapper = el("strong");
        host = el("em");
        wrapper.appendChild(host);
      } else {
        wrapper = el(node.tag === "strong" ? "strong" : node.tag === "em" ? "em" : "del");
        host = wrapper;
      }
      renderInline(node.children, host, ctx);
      parent.appendChild(wrapper);
      // Marks live directly inside `host`, so that is the reveal region.
      region(ctx, host, node.from, node.to);
      break;
    }
    case "code": {
      const code = el("code", "td-code-span");
      renderInline(node.children, code, ctx);
      parent.appendChild(code);
      region(ctx, code, node.from, node.to);
      break;
    }
    case "link":
    case "autolink": {
      const a = el("a") as HTMLAnchorElement;
      a.href = sanitizeUrl(node.href);
      a.setAttribute("rel", "noopener nofollow");
      renderInline(node.children, a, ctx);
      parent.appendChild(a);
      region(ctx, a, node.from, node.to);
      break;
    }
    case "image": {
      const wrap = el("span", "td-image");
      const img = document.createElement("img");
      img.src = sanitizeUrl(node.src);
      img.alt = node.alt;
      img.className = "td-image-view";
      wrap.appendChild(img);
      markSpan(wrap, node.raw, node.from, ctx, "td-image-raw");
      parent.appendChild(wrap);
      region(ctx, wrap, node.from, node.to);
      break;
    }
    case "html":
      // Inline HTML is handled by renderInline's pairing pass, not here.
      renderStandaloneHtml(node, parent, ctx);
      break;
  }
}

const ALERT_LABEL: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

export function renderBlock(value: string, block: Block): BlockRender {
  const ctx: Ctx = { pieces: [], regions: [] };
  let element: HTMLElement;

  switch (block.type) {
    case "paragraph": {
      element = el("p", "td-block");
      renderInline(block.inline, element, ctx);
      break;
    }
    case "heading": {
      element = el(`h${block.level}`, "td-block");
      renderInline(block.inline, element, ctx);
      // Reveal the "## " marker only when the caret is on it (start of the
      // line), like a list marker, rather than anywhere on the heading. The
      // marker is the leading `mark` inline node; its end bounds the region.
      const mark = block.inline[0];
      const markTo = mark && mark.type === "mark" ? mark.to : block.from;
      region(ctx, element, block.from, markTo);
      break;
    }
    case "hr": {
      element = el("div", "td-block td-hr-block");
      // The raw "---" is always present as selectable text so the caret can
      // always navigate onto the line (it is transparent when idle). The
      // rendered rule is an overlay that hides while the construct is active.
      const raw = el("span", "td-hr-raw");
      pushText(raw, block.raw, block.from, ctx);
      element.appendChild(raw);
      element.appendChild(el("span", "td-hr-view"));
      region(ctx, element, block.from, lineEnd(value, block.to));
      break;
    }
    case "code": {
      element = el("pre", "td-block td-code-block");
      const code = el("code");
      if (block.lang) code.className = `language-${block.lang}`;
      markSpan(
        code,
        value.slice(block.openFence.from, block.openFence.to),
        block.openFence.from,
        ctx,
        "td-fence",
      );
      renderCode(
        value.slice(block.content.from, block.content.to),
        block.lang,
        block.content.from,
        code,
        ctx,
      );
      if (block.closeFence) {
        markSpan(
          code,
          value.slice(block.closeFence.from, block.closeFence.to),
          block.closeFence.from,
          ctx,
          "td-fence",
        );
      }
      element.appendChild(code);
      region(ctx, code, block.from, block.to);
      break;
    }
    case "blockquote": {
      element = el("blockquote", "td-block");
      if (block.alert) {
        element.classList.add("td-alert", `td-alert-${block.alert}`);
      }
      block.lines.forEach((line, i) => {
        const row = el("div", "td-quote-line");
        if (block.alert && i === 0) {
          const title = el("span", "td-alert-title");
          title.dataset.label = ALERT_LABEL[block.alert] ?? block.alert;
          row.appendChild(title);
          // The raw "> [!NOTE]" is always present as selectable text (transparent
          // when idle) so the caret can land on the line; revealed when active.
          const raw = el("span", "td-alert-raw");
          pushText(raw, value.slice(line.from, line.to), line.from, ctx);
          row.appendChild(raw);
        } else {
          markSpan(
            row,
            value.slice(line.from, line.from + line.markLen),
            line.from,
            ctx,
            "td-quote-mark",
          );
          renderInline(line.inline, row, ctx);
        }
        element.appendChild(row);
        // Reveal the "> " only when the caret is at the start of the line (its
        // marker range), like list markers. The alert title line is entirely
        // syntax, so it stays revealable across the whole line.
        const revealTo = block.alert && i === 0 ? line.to : line.from + line.markLen;
        region(ctx, row, line.from, revealTo);
      });
      break;
    }
    case "list": {
      element = renderList(value, block, ctx);
      break;
    }
    case "table": {
      element = el("div", "td-block td-table-block");
      const raw = el("span", "td-table-raw");
      pushText(raw, block.raw, block.from, ctx);
      element.appendChild(raw);
      element.appendChild(renderTable(block));
      region(ctx, element, block.from, block.to);
      break;
    }
    case "blank": {
      element = el("p", "td-block td-blank");
      element.appendChild(el("br"));
      break;
    }
    case "html": {
      element = el("div", "td-block td-html");
      // The rendered HTML (`.td-html-view`) sits in flow and sizes the block;
      // the raw source (`.td-html-raw`) is a transparent overlay so the caret
      // can land on it. When active the raw comes into flow (dimmed) and the
      // view hides the same swap tables use.
      const raw = el("span", "td-html-raw");
      pushText(raw, block.raw, block.from, ctx);
      element.appendChild(raw);
      const view = el("div", "td-html-view");
      const template = document.createElement("template");
      template.innerHTML = block.raw;
      view.appendChild(template.content);
      element.appendChild(view);
      region(ctx, element, block.from, block.to);
      break;
    }
  }

  element.dataset.from = String(block.from);
  element.dataset.to = String(block.to);
  return { el: element, from: block.from, to: block.to, pieces: ctx.pieces, regions: ctx.regions };
}

// Render fenced-code content with syntax highlighting. Highlighted tokens are
// wrapped in `.td-tok-*` spans; the gaps between tokens are plain text. Every
// text node (token or gap) is registered as a piece so caret mapping still
// covers the whole code range.
function renderCode(code: string, lang: string, baseFrom: number, parent: Node, ctx: Ctx): void {
  const tokens = tokenize(code, lang);
  let cursor = 0;
  const plain = (from: number, to: number): void => {
    if (to > from) pushText(parent, code.slice(from, to), baseFrom + from, ctx);
  };
  for (const tok of tokens) {
    plain(cursor, tok.from);
    const span = el("span", `td-tok-${tok.type}`);
    pushText(span, code.slice(tok.from, tok.to), baseFrom + tok.from, ctx);
    parent.appendChild(span);
    cursor = tok.to;
  }
  plain(cursor, code.length);
}

// Build a (possibly nested) list. Nesting is derived from each item's leading
// indent using a stack: a deeper indent opens a sub-list inside the previous
// item, a shallower indent closes back out. Per-level bullet styles are handled
// in CSS via descendant selectors on the nested <ul>/<ol>.
function renderList(value: string, block: Extract<Block, { type: "list" }>, ctx: Ctx): HTMLElement {
  const items = block.items;
  // Create a list element, honouring an ordered list's starting number.
  const makeList = (item: ListItem | undefined, cls: string): HTMLElement => {
    const ordered = item ? item.ordered : block.ordered;
    const el2 = el(ordered ? "ol" : "ul", cls);
    if (ordered && item) {
      const start = parseInt(item.marker, 10);
      if (Number.isFinite(start) && start !== 1) (el2 as HTMLOListElement).start = start;
    }
    return el2;
  };
  const root = makeList(items[0], "td-block td-list");
  interface Frame {
    indent: number;
    listEl: HTMLElement;
    lastLi: HTMLElement | null;
  }
  const stack: Frame[] = [{ indent: items[0]?.indent ?? 0, listEl: root, lastLi: null }];

  for (const item of items) {
    while (stack.length > 1 && item.indent < stack[stack.length - 1]!.indent) stack.pop();
    let top = stack[stack.length - 1]!;
    if (item.indent > top.indent && top.lastLi) {
      const sub = makeList(item, "td-list");
      top.lastLi.appendChild(sub);
      stack.push({ indent: item.indent, listEl: sub, lastLi: null });
      top = stack[stack.length - 1]!;
    }
    const li = renderListItem(value, item, ctx);
    top.listEl.appendChild(li);
    top.lastLi = li;
  }
  return root;
}

function renderListItem(value: string, item: ListItem, ctx: Ctx): HTMLElement {
  const li = el("li", "td-list-item");
  const contentFrom = item.from + item.markLen;
  // Where the caret should land when it falls on this item's element rather than
  // a text node (an empty item, or a click in the marker gutter). See the editor
  // for how this is consulted.
  li.dataset.contentFrom = String(contentFrom);
  const prefix = value.slice(item.from, item.from + item.markLen);
  if (item.checked !== null) {
    li.classList.add("td-task");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "td-task-box";
    box.checked = item.checked;
    box.tabIndex = -1;
    const lb = prefix.indexOf("[");
    if (lb !== -1) box.dataset.tdToggle = String(item.from + lb + 1);
    li.appendChild(box);
  }
  markSpan(li, prefix, item.from, ctx, "td-list-mark");
  renderInline(item.inline, li, ctx);
  // An empty item has no text node, so it would have no line box (arrow keys
  // skip it) and no caret anchor. Give it a <br> for the line box; it is hidden
  // once the item is active and its raw marker provides one instead.
  if (item.inline.length === 0) {
    li.classList.add("td-list-empty");
    li.appendChild(el("br", "td-li-br"));
  }
  // The reveal region covers only the marker range, so the raw "- " / "1. " /
  // "[x] " shows the moment the caret sits at the start of the line content
  // (or within the marker) and hides once the caret moves into the text.
  region(ctx, li, item.from, item.from + item.markLen);
  return li;
}

function renderTable(block: Extract<Block, { type: "table" }>): HTMLElement {
  const table = el("table", "td-table-view");
  const thead = el("thead");
  const htr = el("tr");
  block.header.forEach((cell, i) => {
    const th = el("th");
    applyAlign(th, block.align[i]);
    th.textContent = cell;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of block.rows) {
    const tr = el("tr");
    block.header.forEach((_, i) => {
      const td = el("td");
      applyAlign(td, block.align[i]);
      td.textContent = row[i] ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function applyAlign(cell: HTMLElement, align: string | undefined): void {
  if (align && align !== "none") cell.style.textAlign = align;
}
