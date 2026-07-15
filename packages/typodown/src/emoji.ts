// Emoji shortcode data for the `:shortcode:` picker.
//
// The bulk of the data comes from `gemoji` (GitHub's own emoji dataset: the
// same `:tada:` / `:+1:` aliases and search tags the GitHub UI uses), so the
// list stays complete and current with a plain `npm update gemoji` instead of
// being hand-maintained here. It is pulled in through a dynamic import so the
// ~64 kB dataset stays out of the initial bundle and is only fetched the first
// time someone actually types `:` (see `loadEmojiIndex`).
//
// `EXTRA_EMOJI` is the small escape hatch for shortcodes gemoji does not carry
// (typographic marks and the like); add a line to define your own.

export const EXTRA_EMOJI: Record<string, string> = {
  median_dot: "·",
  middle_dot: "·",
};

export interface EmojiEntry {
  /** Shortcode typed between the colons, e.g. `tada`. */
  name: string;
  /** The emoji (or character) inserted when picked. */
  emoji: string;
  /** Lowercase haystack (name + tags + description) matched during search. */
  terms: string;
}

// Built once, then cached: the resolved promise is reused on every later
// keystroke so search is synchronous after the initial dataset load.
let indexPromise: Promise<EmojiEntry[]> | null = null;

/** Lazily load the gemoji dataset and flatten it into a search index, merged
 * with `EXTRA_EMOJI`. The dynamic import keeps the dataset in its own chunk. */
export function loadEmojiIndex(): Promise<EmojiEntry[]> {
  if (!indexPromise) {
    indexPromise = import("gemoji").then(({ gemoji }) => {
      const entries: EmojiEntry[] = [];
      for (const name in EXTRA_EMOJI) {
        entries.push({ name, emoji: EXTRA_EMOJI[name]!, terms: name });
      }
      for (const g of gemoji) {
        const terms = `${g.names.join(" ")} ${g.tags.join(" ")} ${g.description}`.toLowerCase();
        // One entry per alias so any of an emoji's names can match; results are
        // de-duplicated by emoji at search time.
        for (const name of g.names) entries.push({ name, emoji: g.emoji, terms });
      }
      return entries;
    });
  }
  return indexPromise;
}

/** Ranked search over the emoji `index` for a lowercase `query`.
 *
 * A name prefix ranks above a name substring, which ranks above a match found
 * only in the tags / description; ties break by shortest name then
 * alphabetically. Results are de-duplicated by emoji (aliases collapse to their
 * best-ranked name) and capped at `limit`, returned as `[name, emoji]` pairs. */
export function searchEmoji(index: EmojiEntry[], query: string, limit = 15): [string, string][] {
  const q = query.toLowerCase();
  const hits: { name: string; emoji: string; rank: number }[] = [];
  for (const e of index) {
    const nameIdx = e.name.indexOf(q);
    let rank: number;
    if (nameIdx === 0) rank = 0;
    else if (nameIdx > 0) rank = 1;
    else if (e.terms.includes(q)) rank = 2;
    else continue;
    hits.push({ name: e.name, emoji: e.emoji, rank });
  }
  hits.sort(
    (a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name),
  );
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (seen.has(h.emoji)) continue;
    seen.add(h.emoji);
    out.push([h.name, h.emoji]);
    if (out.length >= limit) break;
  }
  return out;
}
