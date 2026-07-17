import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type TreeNode,
  pickFolder,
  pickMarkdownFile,
  readMarkdownTree,
  readFileContent,
  renamePath,
  writeFileContent,
  watchVault,
  type UnwatchFn,
  IS_TAURI,
} from "./tauri";

export type VaultMode = "folder" | "file" | null;
/** Which surface the main pane shows: the editor or the link graph. */
export type ViewMode = "editor" | "graph";

const [vaultRoot, setVaultRoot] = createSignal<string | null>(null);
const [vaultMode, setVaultMode] = createSignal<VaultMode>(null);
const [view, setView] = createSignal<ViewMode>("editor");
const [tree, setTree] = createSignal<TreeNode[]>([]);
const [currentPath, setCurrentPath] = createSignal<string | null>(null);
const [currentContent, setCurrentContent] = createSignal<string>("");
const [dirty, setDirty] = createSignal<boolean>(false);
const [loading, setLoading] = createSignal<boolean>(false);
const [error, setError] = createSignal<string | null>(null);

let unwatch: UnwatchFn | null = null;
let saveTimer: Debouncer | null = null;
let maxSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** When false (e.g. on Android, where a manual Save button replaces
 * auto-save), onContentChange updates the in-memory content and dirty flag
 * but never schedules a write to disk; the user triggers saves explicitly via
 * `save()`, which reuses the same code path the auto-save did. */
let autoSave = true;

export function setAutoSave(enabled: boolean): void {
  autoSave = enabled;
  if (!enabled) flushSave();
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
  vaultMode,
  view,
  tree,
  currentPath,
  currentContent,
  dirty,
  loading,
  error,
};

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
      console.log("Folder picker cancelled");
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
  setLoading(true);
  setError(null);
  try {
    stopWatch();
    const nodes = await readMarkdownTree(folder);
    setVaultRoot(folder);
    setVaultMode("folder");
    setTree(nodes);
    setCurrentPath(null);
    setCurrentContent("");
    setDirty(false);
    // Pick the first markdown file as a sensible default.
    const first = firstMarkdown(nodes);
    if (first) await openFile(first.path);
    startWatch(folder);
    updateWindowTitle();
  } catch (err) {
    setError(String(err));
    toast.error("Failed to open folder", { description: String(err) });
  } finally {
    setLoading(false);
  }
}

export async function openSingleFile(): Promise<void> {
  const file = await pickMarkdownFile();
  if (!file) return;
  await openFile(file);
  await loadParentFolder(file);
}

/** When opening a single file, treat the parent folder as the vault root so
 * the explorer shows siblings too. */
async function loadParentFolder(file: string): Promise<void> {
  const parent = parentDir(file);
  if (!parent) return;
  try {
    const nodes = await readMarkdownTree(parent);
    setVaultRoot(parent);
    setVaultMode("file");
    setTree(nodes);
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
  if (target.startsWith("content://")) {
    setVaultMode("file");
    return;
  }
  await loadParentFolder(target);
}

/** Wire up OS "open with" handling. Registers the warm-start event listener
 * first, then drains any file that arrived before the frontend was ready. */
export async function initOpenWith(): Promise<void> {
  if (!IS_TAURI) return;
  try {
    await listen<string>("open-file", (event) => void openExternalFile(event.payload));
    const pending = await invoke<string | null>("take_pending_open_file");
    if (pending) await openExternalFile(pending);
  } catch (err) {
    // Not running inside Tauri (plain browser dev server); nothing to wire up.
    console.warn("open-with init skipped:", err);
  }
}

export async function openFile(path: string): Promise<void> {
  // Flush any pending save of the previous file before switching.
  flushSave();
  setLoading(true);
  setError(null);
  try {
    const content = await readFileContent(path);
    setCurrentPath(path);
    setCurrentContent(content);
    lastSavedContent = content;
    setDirty(false);
    updateWindowTitle();
  } catch (err) {
    setError(String(err));
    toast.error("Failed to open file", { description: String(err) });
  } finally {
    setLoading(false);
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
  if (!autoSave) return;
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

/** Manual save entry point (used by the toolbar Save button on Android).
 * Reuses the same `saveCurrent` write path as auto-save, forcing through the
 * cloud write-gap so the user sees the save land immediately. Pops a short
 * "Saved" toast so the tap has visible feedback (an error toast already fires
 * from `saveCurrent` if the write fails). */
export function save(): void {
  if (!dirty() || !currentPath()) return;
  flushSave();
  toast.success("Saved");
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

export function flushSave(): void {
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
  // If still dirty after cancel, write now (ignoring the cloud write gap:
  // flushes fire when leaving the file or the app, where waiting is riskier
  // than an early upload).
  if (dirty() && currentPath()) void saveCurrent(true);
}

// Flush pending edits the moment the app loses the foreground: on Android the
// WebView can be frozen or killed at any point after that, and a long SAF
// debounce would otherwise lose the tail of the session.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushSave();
  });
  window.addEventListener("pagehide", () => flushSave());
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
    if (openAffected) {
      setCurrentPath(isDir ? newPath + openNorm!.slice(oldNorm.length) : newPath);
      updateWindowTitle();
    }
    await refreshTree();
  } catch (err) {
    toast.error("Failed to rename", { description: String(err) });
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

export function closeVault(): void {
  flushSave();
  stopWatch();
  setVaultRoot(null);
  setVaultMode(null);
  setTree([]);
  setCurrentPath(null);
  setCurrentContent("");
  lastSavedContent = null;
  setDirty(false);
  updateWindowTitle();
}

async function refreshTree(): Promise<void> {
  const root = vaultRoot();
  if (!root) return;
  try {
    const nodes = await readMarkdownTree(root);
    setTree(nodes);
    // If the open file disappeared from disk, clear it.
    const open = currentPath();
    if (open && !containsPath(nodes, open)) {
      setCurrentPath(null);
      setCurrentContent("");
      setDirty(false);
    }
  } catch {
    // Watch refresh is best-effort.
  }
}

function startWatch(root: string): void {
  stopWatch();
  void watchVault(root, () => void refreshTree()).then((fn) => {
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
