import { createSignal, untrack } from "solid-js";
import { toast } from "solid-sonner";
import { readFileContent, type TreeNode } from "./tauri";
import { vault, replaceFileContent } from "./vault";

/** One occurrence of the query, one row in the sidebar. */
export interface SearchHit {
  path: string;
  /** File name, shown next to the snippet. */
  name: string;
  /** 1-indexed line number. */
  line: number;
  /** Column of the match within the line, 0-indexed. */
  column: number;
  /** The full line the match sits on, for the snippet. */
  text: string;
}

/** Vault-wide search runs over every markdown file, so it is bounded on both
 * ends: a debounce keeps a fast typist from starting a scan per keystroke, and
 * a hit cap keeps a one-letter query from building tens of thousands of rows. */
const DEBOUNCE_MS = 250;
const MAX_HITS = 500;
/** Reads are IPC round trips; a few in flight keep the bridge busy without
 * starving whatever else the user is doing. */
const READ_CONCURRENCY = 8;

/** Whether the sidebar is showing search instead of the file tree. The query
 * and its results survive a switch back to the tree, so the button toggles
 * between the two views without losing where you were. */
const [open, setOpen] = createSignal(false);
const [query, setQuerySignal] = createSignal("");
const [replacement, setReplacement] = createSignal("");
const [matchCase, setMatchCaseSignal] = createSignal(false);
const [showReplace, setShowReplace] = createSignal(false);
const [hits, setHits] = createSignal<SearchHit[]>([]);
const [selected, setSelected] = createSignal(0);
const [running, setRunning] = createSignal(false);
const [truncated, setTruncated] = createSignal(false);

export const search = {
  open,
  query,
  replacement,
  matchCase,
  showReplace,
  hits,
  selected,
  running,
  truncated,
  /** Whether there is a query to run at all. */
  active: () => query().length > 0,
};

export function toggleSearch(): void {
  setSearchOpen(!open());
}

export function closeSearch(): void {
  setSearchOpen(false);
}

function setSearchOpen(next: boolean): void {
  setOpen(next);
  // Hiding the panel drops any scan still in flight; reopening re-runs it
  // against a fresh read of the tree anyway.
  if (!next) cancelPending();
}

// File contents are cached for the duration of a search session: refining a
// query re-scans the same files, and on a cloud vault re-reading them all per
// keystroke would be unusable. Any change to the tree (or a replace) drops the
// stale entries.
const contentCache = new Map<string, string>();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let runToken = 0;

export function setQuery(value: string): void {
  setQuerySignal(value);
  setSelected(0);
  schedule();
}

export function setMatchCase(value: boolean): void {
  setMatchCaseSignal(value);
  setSelected(0);
  schedule();
}

export function setReplacementText(value: string): void {
  setReplacement(value);
}

/** Which hit the single-shot Replace acts on; clicking a row moves it. */
export function setSelectedHit(index: number): void {
  setSelected(index);
}

export function toggleReplace(): void {
  setShowReplace((v) => !v);
}

/** Abandon a scan in flight: the token bump makes any in-progress `run` drop
 * its results when it lands. */
function cancelPending(): void {
  runToken++;
  setRunning(false);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Drop cached file contents and re-run the current query. Called when the
 * vault tree changes, since files may have been added, removed or edited
 * outside the app. */
export function refreshSearch(): void {
  contentCache.clear();
  if (search.active()) schedule();
}

function schedule(): void {
  runToken++;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!search.active()) {
    setHits([]);
    setRunning(false);
    setTruncated(false);
    return;
  }
  setRunning(true);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void run();
  }, DEBOUNCE_MS);
}

async function run(): Promise<void> {
  const token = ++runToken;
  const needle = untrack(query);
  const caseSensitive = untrack(matchCase);
  const files = markdownFiles(untrack(vault.tree));
  const found: SearchHit[] = [];
  let capped = false;

  await mapLimit(files, READ_CONCURRENCY, async (node) => {
    if (token !== runToken || capped) return;
    let content: string;
    try {
      content = await contentOf(node.path);
    } catch {
      // Unreadable file (permissions, a cloud placeholder that failed to
      // download): skip it rather than failing the whole search.
      return;
    }
    if (token !== runToken) return;
    for (const hit of matchesIn(content, needle, caseSensitive)) {
      if (found.length >= MAX_HITS) {
        capped = true;
        return;
      }
      found.push({ ...hit, path: node.path, name: node.name });
    }
  });

  if (token !== runToken) return;
  found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
  setHits(found);
  setTruncated(capped);
  setRunning(false);
  setSelected((i) => (i < found.length ? i : 0));
}

/** Every match of `needle` in `text`, line by line. Plain text, not regex: the
 * query doubles as the replace source, where a literal match is what the user
 * means. */
function* matchesIn(
  text: string,
  needle: string,
  caseSensitive: boolean,
): Generator<Omit<SearchHit, "path" | "name">> {
  const lines = text.split("\n");
  const target = caseSensitive ? needle : needle.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = caseSensitive ? raw : raw.toLowerCase();
    let from = 0;
    for (;;) {
      const at = line.indexOf(target, from);
      if (at < 0) break;
      yield { line: i + 1, column: at, text: raw };
      from = at + target.length;
    }
  }
}

/** The file's text, preferring an unsaved buffer (the editor's, or one parked
 * when the user switched away from that file) over the disk copy, so a search
 * sees unsaved edits and a replace never writes them away. */
async function contentOf(path: string): Promise<string> {
  const pending = untrack(() => vault.unsavedContent(path));
  if (pending !== undefined) return pending;
  const cached = contentCache.get(path);
  if (cached !== undefined) return cached;
  const text = await readFileContent(path);
  contentCache.set(path, text);
  return text;
}

/** Replace a single occurrence, then re-scan so the remaining rows shift. */
export async function replaceHit(hit: SearchHit): Promise<void> {
  const needle = query();
  if (!needle) return;
  try {
    const content = await contentOf(hit.path);
    const lines = content.split("\n");
    const line = lines[hit.line - 1];
    if (line === undefined || !matchesAt(line, hit.column, needle, matchCase())) {
      // The file moved under us (edited elsewhere, or an earlier replace
      // shifted it); a fresh scan is more useful than a wrong write.
      refreshSearch();
      return;
    }
    lines[hit.line - 1] =
      line.slice(0, hit.column) + replacement() + line.slice(hit.column + needle.length);
    await write(hit.path, lines.join("\n"));
    void run();
  } catch (err) {
    toast.error("Failed to replace", { description: String(err) });
  }
}

/** Replace every occurrence in every file that has one. */
export async function replaceAll(): Promise<void> {
  const needle = query();
  if (!needle) return;
  const paths = [...new Set(hits().map((h) => h.path))];
  if (paths.length === 0) return;
  let count = 0;
  try {
    for (const path of paths) {
      const content = await contentOf(path);
      const [next, replaced] = replaceEvery(content, needle, replacement(), matchCase());
      if (replaced === 0) continue;
      await write(path, next);
      count += replaced;
    }
    toast.success(`Replaced ${count} ${count === 1 ? "occurrence" : "occurrences"}`, {
      description: `${paths.length} ${paths.length === 1 ? "file" : "files"}`,
    });
    void run();
  } catch (err) {
    toast.error("Failed to replace", { description: String(err) });
  }
}

function replaceEvery(
  text: string,
  needle: string,
  value: string,
  caseSensitive: boolean,
): [string, number] {
  const haystack = caseSensitive ? text : text.toLowerCase();
  const target = caseSensitive ? needle : needle.toLowerCase();
  let out = "";
  let from = 0;
  let count = 0;
  for (;;) {
    const at = haystack.indexOf(target, from);
    if (at < 0) break;
    out += text.slice(from, at) + value;
    from = at + target.length;
    count++;
  }
  return [out + text.slice(from), count];
}

function matchesAt(line: string, column: number, needle: string, caseSensitive: boolean): boolean {
  const slice = line.slice(column, column + needle.length);
  return caseSensitive ? slice === needle : slice.toLowerCase() === needle.toLowerCase();
}

async function write(path: string, content: string): Promise<void> {
  await replaceFileContent(path, content);
  contentCache.set(path, content);
}

function markdownFiles(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const node of nodes) {
    if (node.isDir) markdownFiles(node.children, out);
    else out.push(node);
  }
  return out;
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await fn(items[index]!);
    }
  });
  await Promise.all(workers);
}
