// Convert pasted HTML into Markdown, keeping only the constructs Markdown can
// express (headings, emphasis, code, links, images, lists, blockquotes, rules)
// and discarding everything else (colours, fonts, backgrounds, unknown
// wrappers) while preserving the text those wrappers contain. This is what lets
// a paste from a rich source keep its bold/links without dragging in styling
// that has no Markdown equivalent.

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const md = serializeChildren(doc.body);
  // Tidy the block spacing the recursive walk produces.
  return md
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** Tags whose content is a block: rendered on its own, separated by a blank line. */
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "figure",
  "figcaption",
]);

function serializeChildren(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) out += serialize(child);
  return out;
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse runs of whitespace the way HTML layout does; newlines in the
    // source markup are not hard breaks.
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "script":
    case "style":
    case "head":
    case "noscript":
      return "";
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "strong":
    case "b":
      return wrap(serializeChildren(el), "**");
    case "em":
    case "i":
      return wrap(serializeChildren(el), "*");
    case "del":
    case "s":
    case "strike":
      return wrap(serializeChildren(el), "~~");
    case "code":
      // A <code> inside <pre> is handled by the <pre> branch as a block.
      if (el.closest("pre")) return serializeChildren(el);
      return wrap(serializeChildren(el), "`");
    case "pre": {
      const text = (el.textContent ?? "").replace(/\n$/, "");
      return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = serializeChildren(el);
      return href ? `[${text}](${href})` : text;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") ?? "";
      return src ? `![${alt}](${src})` : "";
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `\n\n${"#".repeat(Number(tag[1]))} ${serializeChildren(el).trim()}\n\n`;
    case "blockquote": {
      const inner = serializeChildren(el).trim();
      if (!inner) return "";
      return `\n\n${inner
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n")}\n\n`;
    }
    case "ul":
    case "ol":
      return `\n\n${serializeList(el, tag === "ol")}\n\n`;
    case "li":
      // Loose <li> outside a recognised list: emit as a bullet.
      return `- ${serializeChildren(el).trim()}\n`;
    default: {
      const inner = serializeChildren(el);
      return BLOCK.has(tag) ? `\n\n${inner}\n\n` : inner;
    }
  }
}

/** Apply an emphasis marker, but only around non-empty content, and move any
 * surrounding spaces outside the markers (Markdown ignores `** text **`).
 */
function wrap(text: string, marker: string): string {
  const core = text.trim();
  if (!core) return text;
  const lead = text.startsWith(" ") ? " " : "";
  const trail = text.endsWith(" ") ? " " : "";
  return `${lead}${marker}${core}${marker}${trail}`;
}

function serializeList(list: HTMLElement, ordered: boolean): string {
  const lines: string[] = [];
  let index = 1;
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const marker = ordered ? `${index}. ` : "- ";
    // Indent wrapped lines / nested lists under the marker.
    const body = serializeChildren(li)
      .trim()
      .replace(/\n/g, `\n${" ".repeat(marker.length)}`);
    lines.push(marker + body);
    index++;
  }
  return lines.join("\n");
}
