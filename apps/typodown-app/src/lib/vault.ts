import { createSignal, untrack } from "solid-js";
import { toast } from "solid-sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { markdownToHtmlDocument } from "@vemonet/typodown";
import {
  type TreeNode,
  MARKDOWN_EXT,
  downloadFile,
  pickExportPath,
  pickFolder,
  printHtmlDocument,
  readMarkdownTree,
  readFileContent,
  renamePath,
  resolveLocalImageSrc,
  writeFileContent,
  watchVault,
  type UnwatchFn,
  IS_TAURI,
} from "./tauri";

/** Which surface the main pane shows: the editor or the link graph. */
export type ViewMode = "editor" | "graph";

const [vaultRoot, setVaultRoot] = createSignal<string | null>(null);
const [view, setView] = createSignal<ViewMode>("editor");
const [tree, setTree] = createSignal<TreeNode[]>([]);
const [currentPath, setCurrentPath] = createSignal<string | null>(null);
const [currentContent, setCurrentContent] = createSignal<string>("");
const [dirty, setDirty] = createSignal<boolean>(false);
const [error, setError] = createSignal<string | null>(null);
/** Paths of the files the user has opened, most recently used first. There is
 * a single editor buffer (no tabs): this only records what is "open" so the
 * explorer can hint at it and Ctrl+Tab can cycle in MRU order. */
const [openPaths, setOpenPaths] = createSignal<string[]>([]);
/** Files with edits that are not on disk and are not in the editor right now.
 *
 * There is a single editor buffer, so switching file used to have to write the
 * outgoing one. With auto-save off that is exactly what the user asked us not
 * to do, so the buffer is parked here instead: it comes back untouched on
 * re-open, and only leaves when it is saved, when the file disappears, or when
 * the app goes away (see the flush-on-hide handler). */
const parked = new Map<string, string>();
/** Reactive mirror of `parked`'s keys, so the explorer's unsaved marker can
 * track files that are not the open one. */
const [parkedPaths, setParkedPaths] = createSignal<string[]>([]);

/** Path currently being read from disk, if any. Reads are instant on a local
 * disk but can stall on a cloud folder (a Dropbox placeholder has to download
 * first), where a blank editor with no explanation just looks stuck. */
const [opening, setOpening] = createSignal<string | null>(null);

let unwatch: UnwatchFn | null = null;
let saveTimer: Debouncer | null = null;
let maxSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Auto-save preference, off by default and remembered across restarts.
 *
 * While off, typing only updates the in-memory content and the dirty flag; no
 * write is scheduled and the user saves explicitly (the toolbar Save button or
 * Ctrl/Cmd+S). Switching file keeps the edits in memory rather than writing
 * them (see `parked`); the one place they are still flushed is leaving the
 * app, where the alternative is losing them with the session. */
const AUTO_SAVE_KEY = "typodown:auto-save";
const [autoSave, setAutoSaveSignal] = createSignal<boolean>(loadAutoSavePref());

function loadAutoSavePref(): boolean {
  try {
    return localStorage.getItem(AUTO_SAVE_KEY) === "on";
  } catch {
    // Storage can be unavailable (private mode, strict WebView); default off.
    return false;
  }
}

export function setAutoSave(enabled: boolean): void {
  setAutoSaveSignal(enabled);
  try {
    localStorage.setItem(AUTO_SAVE_KEY, enabled ? "on" : "off");
  } catch {
    // Not persisting the choice is not worth failing the toggle over.
  }
  // Turning it off writes what was already pending; turning it on picks up
  // every buffer held back while it was off, parked ones included.
  if (!enabled) flushSave();
  else flushAll();
}

export function toggleAutoSave(): void {
  setAutoSave(!autoSave());
}

interface Debouncer {
  run: () => void;
  cancel: () => void;
}

/** SAF documents (content:// URIs — any cloud provider exposing a writable
 * documents provider: Dropbox, Google Drive, OneDrive, Nextcloud, ...) sync
 * to the cloud on every write; writing again while the previous upload is
 * still in flight makes the provider fork a "conflicted copy". Conflicts are
 * driven by write *frequency*, not by how soon the first write happens, so
 * the debounce is short (a pause saves quickly) and a minimum gap between
 * consecutive writes keeps the churn low while typing on. A periodic flush
 * bounds how long a long typing session can go unsaved, and leaving the app
 * flushes immediately (see the visibility listeners below). */
const LOCAL_DEBOUNCE_MS = 500;
const SAF_DEBOUNCE_MS = 1000;
const SAF_MIN_WRITE_GAP_MS = 10000;
const SAF_MAX_PENDING_MS = 30000;

function isContentUri(path: string): boolean {
  return path.startsWith("content://");
}

export const vault = {
  vaultRoot,
  view,
  tree,
  currentPath,
  currentContent,
  dirty,
  error,
  openPaths,
  opening,
  autoSave,
  /** Whether a path is in the open list (drives the explorer hint). */
  isOpen: (path: string) => openPaths().includes(path),
  /** Whether a path has edits not yet written to disk - the file in the editor,
   * or one whose buffer was parked when the user switched away from it. */
  isDirty: (path: string) => (dirty() && currentPath() === path) || parkedPaths().includes(path),
  /** The unsaved text of a file, for readers that must not see the stale disk
   * copy (vault-wide search and its replace). Undefined when the file has no
   * edits pending. */
  unsavedContent: (path: string): string | undefined =>
    currentPath() === path ? currentContent() : parked.get(path),
};

/** Leave the file in the editor: with auto-save on that means writing it, with
 * auto-save off it means parking the buffer so the edits survive the switch
 * without touching the disk. */
function switchAway(): void {
  if (autoSave()) {
    flushSave();
    return;
  }
  const path = untrack(currentPath);
  if (!path || !untrack(dirty)) return;
  cancelSaveTimers();
  parked.set(path, untrack(currentContent));
  setParkedPaths([...parked.keys()]);
}

/** Forget a parked buffer (it was saved, restored, or its file is gone). */
function unpark(path: string): void {
  if (!parked.delete(path)) return;
  setParkedPaths([...parked.keys()]);
}

/** Move a path to the front of the MRU list, adding it if it wasn't open. */
function touchOpen(path: string): void {
  setOpenPaths((prev) => [path, ...prev.filter((p) => p !== path)]);
}

/** Close an open file. Closing the file in the editor falls back to the next
 * most recently used one, or empties the editor when it was the last. */
export function closeFile(path: string): void {
  const isCurrent = currentPath() === path;
  const rest = openPaths().filter((p) => p !== path);
  setOpenPaths(rest);
  if (!isCurrent) return;
  // Falling back to another file goes through openFile, which parks the
  // outgoing buffer itself; the empty-editor case has to do it here.
  if (rest.length > 0) {
    void openFile(rest[0]);
    return;
  }
  switchAway();
  setCurrentPath(null);
  setCurrentContent("");
  setDirty(false);
  lastSavedContent = null;
  updateWindowTitle();
}

/** Show the link graph in the main pane. */
export function showGraph(): void {
  setView("graph");
}

/** Show the editor in the main pane. */
export function showEditor(): void {
  setView("editor");
}

export async function openFolder(): Promise<void> {
  try {
    const folder = await pickFolder();
    if (!folder) {
      return;
    }
    await loadFolder(folder);
  } catch (err) {
    const errMsg = String(err);
    console.error("Failed to open folder picker:", errMsg);
    toast.error("Failed to open folder picker", { description: errMsg });
    setError(errMsg);
  }
}

/** Update the native window title to reflect the open vault / file so it's
 * easy to find when alt-tabbing. */
function updateWindowTitle(): void {
  const path = currentPath();
  const root = vaultRoot();
  const name = path ? baseName(path) : root ? baseName(root) : null;
  const title = name ? `${name} - Typodown` : "Typodown";
  if (IS_TAURI) void getCurrentWindow().setTitle(title);
  else document.title = title;
}

function baseName(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  let name = norm.slice(norm.lastIndexOf("/") + 1);
  // Android content:// URIs percent-encode the real path into the last
  // segment (e.g. primary%3ADocuments%2Fnote.md); decode to get the filename.
  if (norm.startsWith("content://")) {
    try {
      const decoded = decodeURIComponent(name);
      name = decoded.slice(decoded.lastIndexOf("/") + 1);
    } catch {
      // keep the raw segment
    }
  }
  return name;
}

export async function loadFolder(folder: string): Promise<void> {
  setError(null);
  // Buffers parked from the previous vault become unreachable once the tree is
  // replaced, so this is the one switch that has to write them out.
  flushAll();
  try {
    stopWatch();
    const nodes = await readMarkdownTree(folder);
    setVaultRoot(folder);
    setTreeNodes(nodes);
    setCurrentPath(null);
    setCurrentContent("");
    setDirty(false);
    setOpenPaths([]);
    // Pick the first markdown file as a sensible default.
    const first = firstMarkdown(nodes);
    if (first) await openFile(first.path);
    startWatch(folder);
    updateWindowTitle();
  } catch (err) {
    setError(String(err));
    toast.error("Failed to open folder", { description: String(err) });
  }
}

/** When opening a single file, treat the parent folder as the vault root so
 * the explorer shows siblings too. */
async function loadParentFolder(file: string): Promise<void> {
  const parent = parentDir(file);
  if (!parent) return;
  try {
    const nodes = await readMarkdownTree(parent);
    setVaultRoot(parent);
    setTreeNodes(nodes);
    startWatch(parent);
    updateWindowTitle();
  } catch {
    // Reading the parent may fail on some platforms / sandboxes; that's fine,
    // the file is still open in the editor.
  }
}

/** Open a file handed to us by the OS (file association double-click on
 * desktop, VIEW intent on Android). `target` is either a plain path or an
 * Android `content://` URI, which the fs plugin reads via the ContentResolver. */
export async function openExternalFile(target: string): Promise<void> {
  await openFile(target);
  // content:// URIs are opaque single-document grants: we can't list the
  // parent folder without a separate SAF tree permission, so skip the tree.
  if (target.startsWith("content://")) return;
  await loadParentFolder(target);
}

/** Wire up OS "open with" handling. Registers the warm-start event listener
 * first, then drains any file that arrived before the frontend was ready. */
export async function initOpenWith(): Promise<void> {
  if (!IS_TAURI) return;
  try {
    await listen<string>(
      "open-file",
      (event) => void untrack(() => openExternalFile(event.payload)),
    );
    const pending = await invoke<string | null>("take_pending_open_file");
    if (pending) await openExternalFile(pending);
  } catch (err) {
    // Not running inside Tauri (plain browser dev server); nothing to wire up.
    console.warn("open-with init skipped:", err);
  }
}

// Opens are tokenised so a slower read can never land after a newer one: on a
// cloud folder a file can take seconds to materialise, and clicking on down
// the list meanwhile must not be overwritten by the earlier file arriving late.
let openToken = 0;

export async function openFile(path: string): Promise<void> {
  // Deal with the outgoing file's pending edits before switching.
  switchAway();
  setError(null);
  const token = ++openToken;
  setOpening(path);
  try {
    const content = await readFileContent(path);
    if (token !== openToken) return;
    // A parked buffer wins over the disk copy: those are the user's unsaved
    // edits. The disk read still happens, so `lastSavedContent` reflects what
    // is really there (the file may have changed since it was parked) and the
    // buffer goes back to clean when it turns out to match.
    const pending = parked.get(path);
    setCurrentPath(path);
    setCurrentContent(pending ?? content);
    lastSavedContent = content;
    setDirty(pending !== undefined && pending !== content);
    unpark(path);
    touchOpen(path);
    updateWindowTitle();
  } catch (err) {
    if (token !== openToken) return;
    setError(String(err));
    toast.error("Failed to open file", { description: String(err) });
  } finally {
    if (token === openToken) setOpening(null);
  }
}

/** Called by the editor on every keystroke. Updates the content signal and
 * schedules a debounced save to disk. Cloud documents additionally get a
 * "save at the latest every SAF_MAX_PENDING_MS" backstop, so a long
 * uninterrupted typing session (which keeps resetting the debounce) still
 * hits the disk regularly. */
export function onContentChange(value: string): void {
  setCurrentContent(value);
  const path = currentPath();
  if (!path) return;
  setDirty(true);
  if (!autoSave()) return;
  const cloud = isContentUri(path);
  if (saveTimer) saveTimer.cancel();
  saveTimer = debounce(() => void saveCurrent(), cloud ? SAF_DEBOUNCE_MS : LOCAL_DEBOUNCE_MS);
  saveTimer.run();
  if (cloud && !maxSaveTimer) {
    maxSaveTimer = setTimeout(() => {
      maxSaveTimer = null;
      void saveCurrent();
    }, SAF_MAX_PENDING_MS);
  }
}

/** Manual save entry point (the toolbar Save button and Ctrl/Cmd+S).
 * Reuses the same `saveCurrent` write path as auto-save, forcing through the
 * cloud write-gap so the user sees the save land immediately. Silent on
 * success -- the dirty marker in the explorer and the toolbar's Save button
 * both go quiet, which is feedback enough for something done this often; only
 * a failed write says anything, from `saveCurrent`. */
export function save(): void {
  if (!dirty() || !currentPath()) return;
  flushSave();
}

// Writes are serialized: a save that lands while another is in flight doesn't
// start a second overlapping write (which cloud providers turn into conflict
// copies); it just marks that a follow-up pass is needed with the latest
// content. Identical content is never rewritten, so timers firing with
// nothing new to say don't touch the file (and don't trigger a cloud upload).
let saving = false;
let saveAgain = false;
let lastSavedContent: string | null = null;
let lastCloudWriteAt = 0;
let gapTimer: ReturnType<typeof setTimeout> | null = null;

async function saveCurrent(force = false): Promise<void> {
  if (saving) {
    saveAgain = true;
    return;
  }
  const path = currentPath();
  if (!path) return;
  const content = currentContent();
  if (content === lastSavedContent) {
    setDirty(false);
    return;
  }
  // Cloud documents: respect the minimum gap between writes so each upload
  // can finish before the next one starts. The save isn't dropped, just
  // rescheduled for when the gap has elapsed; flushSave bypasses this.
  if (!force && isContentUri(path)) {
    const wait = lastCloudWriteAt + SAF_MIN_WRITE_GAP_MS - Date.now();
    if (wait > 0) {
      if (!gapTimer) {
        gapTimer = setTimeout(() => {
          gapTimer = null;
          void saveCurrent();
        }, wait);
      }
      return;
    }
  }
  saving = true;
  try {
    await writeFileContent(path, content);
    lastCloudWriteAt = Date.now();
    lastSavedContent = content;
    // Only clean if nothing changed while the write was in flight.
    if (currentContent() === content) setDirty(false);
  } catch (err) {
    setError(String(err));
    toast.error("Failed to save", { description: String(err) });
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      void saveCurrent(force);
    }
  }
}

function cancelSaveTimers(): void {
  if (saveTimer) {
    saveTimer.cancel();
    saveTimer = null;
  }
  if (maxSaveTimer) {
    clearTimeout(maxSaveTimer);
    maxSaveTimer = null;
  }
  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
}

export function flushSave(): void {
  cancelSaveTimers();
  // If still dirty after cancel, write now (ignoring the cloud write gap:
  // flushes fire when leaving the file or the app, where waiting is riskier
  // than an early upload).
  if (dirty() && currentPath()) void saveCurrent(true);
}

/** Write the editor buffer and every parked one. Parking edits is fine while
 * the app is alive, but they only exist in memory: losing the session would
 * lose them, so leaving the app (or turning auto-save on) writes them out. */
export function flushAll(): void {
  flushSave();
  // Snapshot: unpark mutates the map as we go.
  for (const [path, content] of Array.from(parked)) {
    unpark(path);
    void writeFileContent(path, content).catch((err: unknown) => {
      toast.error("Failed to save", { description: String(err) });
    });
  }
}

/** Write new content to a file from outside the editor (search & replace).
 *
 * When the file is the one in the editor, the buffer is updated first and any
 * pending auto-save is dropped, so the write cannot race with - or be undone
 * by - a debounced save of the pre-replace text. Resolves once the file is on
 * disk, so callers can re-scan straight after.
 *
 * A file with a parked buffer is written too: the replacement was computed
 * from that buffer, so the write saves the unsaved edits along with it. */
export async function replaceFileContent(path: string, content: string): Promise<void> {
  if (path !== currentPath()) {
    await writeFileContent(path, content);
    unpark(path);
    return;
  }
  cancelSaveTimers();
  setCurrentContent(content);
  setDirty(true);
  await saveCurrent(true);
}

// Flush pending edits the moment the app loses the foreground: on Android the
// WebView can be frozen or killed at any point after that, and a long SAF
// debounce would otherwise lose the tail of the session.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushAll();
  });
  window.addEventListener("pagehide", () => flushAll());
}

/** Rename a file or folder (same parent). For files, if the new name has no
 * extension the old one is kept, so typing "note" over note.md stays note.md.
 * When the renamed entry holds the open file (the file itself, or a folder
 * anywhere above it), its path is rewritten so the editor keeps tracking it. */
export async function renameEntry(oldPath: string, newName: string, isDir = false): Promise<void> {
  let name = newName.trim().replace(/[/\\]/g, "");
  if (!name) return;
  const oldName = baseName(oldPath);
  if (!isDir) {
    const oldExt = /\.[^./]+$/.exec(oldName)?.[0];
    if (oldExt && !/\.[^./]+$/.test(name)) name += oldExt;
  }
  if (name === oldName) return;
  const parent = parentDir(oldPath);
  const newPath = parent ? `${parent}/${name}` : name;
  const open = currentPath();
  const openNorm = open?.replace(/\\/g, "/") ?? null;
  const oldNorm = oldPath.replace(/\\/g, "/");
  const openAffected = isDir ? !!openNorm && openNorm.startsWith(`${oldNorm}/`) : open === oldPath;
  try {
    // Persist pending edits before the path moves.
    if (openAffected) flushSave();
    await renamePath(oldPath, newPath);
    // Rewrite every open path the rename moved, so the MRU list, the explorer
    // hints and any parked buffer keep pointing at the same documents.
    const moved = (p: string): string => {
      const norm = p.replace(/\\/g, "/");
      if (isDir) return norm.startsWith(`${oldNorm}/`) ? newPath + norm.slice(oldNorm.length) : p;
      return p === oldPath ? newPath : p;
    };
    setOpenPaths((prev) => prev.map(moved));
    for (const [p, content] of Array.from(parked)) {
      const next = moved(p);
      if (next === p) continue;
      parked.delete(p);
      parked.set(next, content);
      setParkedPaths([...parked.keys()]);
    }
    if (openAffected) {
      setCurrentPath(isDir ? newPath + openNorm!.slice(oldNorm.length) : newPath);
      updateWindowTitle();
    }
    await refreshTree();
  } catch (err) {
    toast.error("Failed to rename", { description: String(err) });
  }
}

/** Render a markdown file to a standalone HTML document and save it.
 *
 * Reads from disk rather than the editor buffer so exporting a file other than
 * the open one works, and flushes pending edits first so exporting the open file
 * cannot produce a stale document. Image paths are left as authored, so the
 * .html shows its images when saved beside the .md it came from. */
export async function exportToHtml(path: string): Promise<void> {
  try {
    if (path === currentPath()) flushSave();
    const markdown = await readFileContent(path);
    const name = baseName(path);
    const title = name.replace(MARKDOWN_EXT, "");
    const html = markdownToHtmlDocument(markdown, { title });

    const suggested = `${title}.html`;
    if (!IS_TAURI) {
      downloadFile(suggested, html, "text/html");
      return;
    }
    const target = await pickExportPath(suggested, "html");
    if (!target) return;
    await writeFileContent(target, html);
    toast.success("Exported to HTML", { description: baseName(target) });
  } catch (err) {
    toast.error("Failed to export to HTML", { description: String(err) });
  }
}

/** Render a markdown file and open the OS print dialog on it, where "Save as
 * PDF" produces the file. Images go through the asset-protocol resolver here (as
 * opposed to the HTML export) because the print window has to load them itself. */
export async function exportToPdf(path: string): Promise<void> {
  if (!IS_TAURI) {
    toast.error("Export to PDF is only available in the desktop app");
    return;
  }
  try {
    if (path === currentPath()) flushSave();
    const markdown = await readFileContent(path);
    const title = baseName(path).replace(MARKDOWN_EXT, "");
    const html = markdownToHtmlDocument(markdown, {
      title,
      resolveImageSrc: (src) => resolveLocalImageSrc(src, path),
    });
    await printHtmlDocument(html, title);
  } catch (err) {
    toast.error("Failed to export to PDF", { description: String(err) });
  }
}

/** Copy a file to the system clipboard as a file object, so it can be pasted
 * into Finder / Explorer / the VS Code file tree. */
export async function copyFileToClipboard(path: string): Promise<void> {
  if (!IS_TAURI) {
    toast.error("Copy file is only available in the desktop app");
    return;
  }
  try {
    await invoke("copy_file_to_clipboard", { path });
    toast.success("File copied", { description: "Paste it in your file manager or editor." });
  } catch (err) {
    toast.error("Failed to copy file", { description: String(err) });
  }
}

/** Publish a freshly read tree, remembering its shape so later refreshes can
 * tell whether anything actually changed. */
function setTreeNodes(nodes: TreeNode[]): void {
  treeSignature = treeSig(nodes);
  setTree(nodes);
}

/** Newline-joined fingerprint of every path in the markdown tree. Watcher
 * events fire for everything under the vault (a cloud folder syncing in the
 * background emits them nonstop) while the tree only shows markdown files and
 * their parents: comparing fingerprints stops those events from re-publishing
 * an identical tree, which would otherwise recreate every explorer row -
 * destroying the one under the pointer mid-click - every couple of seconds. */
function treeSig(nodes: TreeNode[], out: string[] = []): string {
  for (const node of nodes) {
    out.push(node.path);
    if (node.isDir) treeSig(node.children, out);
  }
  return out.join("\n");
}

// Tree reads walk the whole vault, so they are serialized: an event arriving
// mid-read queues a single follow-up pass instead of stacking another walk on
// top. On a big cloud folder a walk takes longer than the watcher debounce, and
// overlapping walks starve everything else on the IPC channel - including the
// read for the file the user just clicked.
let refreshing = false;
let refreshQueued = false;
let treeSignature = "";

async function refreshTree(): Promise<void> {
  const root = vaultRoot();
  if (!root) return;
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  try {
    const nodes = await readMarkdownTree(root);
    if (treeSig(nodes) === treeSignature) return;
    setTreeNodes(nodes);
    // Drop files that disappeared from disk from the open list, and clear the
    // editor if it was showing one of them.
    setOpenPaths((prev) => prev.filter((p) => containsPath(nodes, p)));
    for (const path of parked.keys()) if (!containsPath(nodes, path)) unpark(path);
    const open = currentPath();
    if (open && !containsPath(nodes, open)) {
      setCurrentPath(null);
      setCurrentContent("");
      setDirty(false);
      const next = openPaths()[0];
      if (next) void openFile(next);
    }
  } catch {
    // Watch refresh is best-effort.
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refreshTree();
    }
  }
}

function startWatch(root: string): void {
  stopWatch();
  void watchVault(root, () => void untrack(refreshTree)).then((fn) => {
    unwatch = fn;
  });
}

function stopWatch(): void {
  if (unwatch) {
    unwatch();
    unwatch = null;
  }
}

function firstMarkdown(nodes: TreeNode[]): TreeNode | null {
  for (const node of nodes) {
    if (!node.isDir) return node;
    const found = firstMarkdown(node.children);
    if (found) return found;
  }
  return null;
}

function containsPath(nodes: TreeNode[], target: string): boolean {
  for (const node of nodes) {
    if (node.path === target) return true;
    if (node.isDir && containsPath(node.children, target)) return true;
  }
  return false;
}

function parentDir(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "";
}

// Minimal debounce helper that supports cancel + run.
function debounce(fn: () => void, ms: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = () => {
    fn();
    timer = null;
  };
  return {
    run: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(wrapped, ms);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
