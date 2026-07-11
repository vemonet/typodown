export interface OutlineHeading {
  level: number;
  text: string;
  /** 1-indexed line in the document where the heading sits. */
  line: number;
  /** Stable id for keyed list rendering. */
  id: string;
}

/** Parse markdown text into a list of headings.
 *
 * Recognises ATX (`# Heading`) and setext (`Heading\n===`) headings. Code
 * fences are skipped so a `#` inside a fenced block isn't mistaken for one.
 * Front matter (a leading `---\n...\n---` block) is also skipped. */
export function parseOutline(markdown: string): OutlineHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: OutlineHeading[] = [];
  let inFence = false;
  let fenceMarker = "";
  let inFrontMatter = false;
  let frontMatterSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Front matter: a `---` at the very start of the document opens a block,
    // the next `---` (or `...`) on its own line closes it.
    if (i === 0 && trimmed === "---" && !frontMatterSeen) {
      inFrontMatter = true;
      frontMatterSeen = true;
      continue;
    }
    if (inFrontMatter) {
      if (trimmed === "---" || trimmed === "...") inFrontMatter = false;
      continue;
    }

    // Fenced code blocks toggle on a line starting with ``` or ~~~.
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1][0];
      } else if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const atx = /^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(trimmed);
    if (atx) {
      const level = atx[1].length;
      const text = atx[2].trim();
      if (text) {
        headings.push({
          level,
          text,
          line: i + 1,
          id: `h-${i + 1}-${slugify(text)}`,
        });
      }
      continue;
    }

    // Setext heading: a line of `=` or `-` under a non-blank text line.
    const setext = /^([=-])\1*\s*$/.exec(trimmed);
    if (setext && i > 0) {
      const prev = lines[i - 1].trim();
      if (prev && !/^(#{1,6}\s|>|---|\*\*\*|\+\+\+)/.test(prev)) {
        // Only treat as setext if it's not already captured as the previous line.
        const already = headings[headings.length - 1];
        if (!already || already.line !== i) {
          headings.push({
            level: setext[1] === "=" ? 1 : 2,
            text: prev,
            line: i,
            id: `h-${i}-${slugify(prev)}`,
          });
        }
      }
    }
  }
  return headings;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}
