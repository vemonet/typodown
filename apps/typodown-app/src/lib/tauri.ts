import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readDir,
  readTextFile,
  rename,
  writeTextFile,
  watch,
  type WatchEvent,
} from "@tauri-apps/plugin-fs";
import ignore, { type Ignore } from "ignore";

export type UnwatchFn = () => void;

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/** The markdown extensions the app treats as editable documents. */
export const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i;

// Folders never worth walking in a markdown vault: dependency, VCS and build
// caches that can hold thousands of stray README/CHANGELOG files. Applied even
// when the project has no .gitignore. Hidden dot-folders are otherwise shown.
const DEFAULT_IGNORED = ["node_modules", ".git"];

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let webRoot: FileSystemDirectoryHandle | null = null;

/** Resolve an image path relative to its Markdown file. Remote URLs, data
 * URLs, anchors, and root-relative paths are already meaningful and remain
 * unchanged. Tauri's asset protocol serves local files with their MIME type,
 * including SVG images. */
export function resolveLocalImageSrc(src: string, markdownPath: string | null): string {
  if (!IS_TAURI || !markdownPath || !src || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(src)) return src;
  const normalizedMarkdownPath = markdownPath.replace(/\\/g, "/");
  const slash = normalizedMarkdownPath.lastIndexOf("/");
  if (slash < 0) return src;
  const relativePath = src.split(/[?#]/, 1)[0]!;
  const suffix = src.slice(relativePath.length);
  let decodedPath = relativePath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    // Keep malformed percent escapes literal instead of breaking rendering.
  }
  const segments = `${normalizedMarkdownPath.slice(0, slash + 1)}${decodedPath}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "..") resolved.pop();
    else if (segment !== ".") resolved.push(segment);
  }
  return convertFileSrc(resolved.join("/")) + suffix;
}
const webHandles = new Map<string, FileSystemHandle>();

/** Open a folder picker. Returns the absolute path or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  if (!IS_TAURI) {
    if (!("showDirectoryPicker" in window)) {
      throw new Error(
        "Opening folders requires a Chromium-based browser with File System Access support.",
      );
    }
    webRoot = await window.showDirectoryPicker({ mode: "readwrite" });
    webHandles.clear();
    webHandles.set(webRoot.name, webRoot);
    return webRoot.name;
  }
  const result = await open({ directory: true, multiple: false, title: "Open markdown vault" });
  return typeof result === "string" ? result : null;
}

/** Open a single markdown file picker. Returns the absolute path or null. */
export async function pickMarkdownFile(): Promise<string | null> {
  if (!IS_TAURI) {
    if (!("showOpenFilePicker" in window)) return null;
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Markdown",
          accept: { "text/markdown": [".md", ".markdown", ".mdown", ".mkd", ".mdx"] },
        },
      ],
    });
    if (!handle) return null;
    webRoot = null;
    webHandles.clear();
    webHandles.set(handle.name, handle);
    return handle.name;
  }
  const result = await open({
    directory: false,
    multiple: false,
    title: "Open markdown file",
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] }],
  });
  return typeof result === "string" ? result : null;
}

/** Ask where to save an exported file. Returns the chosen path, or null when the
 * user cancels. In the browser build there is no native save dialog, so the file
 * is offered as a download and null is returned to say "already handled". */
export async function pickExportPath(
  suggestedName: string,
  extension: string,
): Promise<string | null> {
  if (!IS_TAURI) return null;
  const result = await save({
    defaultPath: suggestedName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  return typeof result === "string" ? result : null;
}

/** Save `content` as a download in the browser build (no filesystem access). */
export function downloadFile(name: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Hand a rendered HTML document to the Rust side, which opens it in its own
 * window and brings up the OS print dialog ("Save as PDF"). */
export async function printHtmlDocument(html: string, title: string): Promise<void> {
  await invoke("export_pdf", { html, title });
}

/** Recursively read a directory and return a tree containing only markdown
 * files and the folders that hold them. Hidden paths (dotfiles / dotdirs) are
 * skipped. Folders are sorted before files, each group alphabetical. */
export async function readMarkdownTree(rootPath: string): Promise<TreeNode[]> {
  if (!IS_TAURI) return readWebMarkdownTree(rootPath);
  const ig = await buildIgnore(rootPath);
  const root = await readDirSafe(rootPath);
  const nodes = await Promise.all(root.map((entry) => buildNode(entry, rootPath, rootPath, ig)));
  return nodes.filter((n): n is TreeNode => n !== null).sort(compareNodes);
}

/** Ignore matcher combining the built-in folder blocklist with the vault's
 * root .gitignore (if any), so opening e.g. an npm project doesn't surface the
 * hundreds of READMEs under node_modules. */
async function buildIgnore(rootPath: string): Promise<Ignore> {
  const ig = ignore().add(DEFAULT_IGNORED);
  try {
    ig.add(await readTextFile(joinPath(rootPath, ".gitignore")));
  } catch {
    // No .gitignore (or unreadable, e.g. content:// vault): defaults still apply.
  }
  return ig;
}

async function buildNode(
  entry: { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean },
  parentPath: string,
  rootPath: string,
  ig: Ignore,
): Promise<TreeNode | null> {
  const path = joinPath(parentPath, entry.name);
  // `ignore` needs a non-empty, root-relative POSIX path (relativePath already
  // yields forward slashes). Directory patterns like `dist/` match the bare
  // dir path, so no trailing slash is required.
  const rel = relativePath(path, rootPath);
  if (rel && ig.ignores(rel)) return null;
  if (entry.isDirectory) {
    const children = await readDirSafe(path);
    const childNodes = await Promise.all(children.map((c) => buildNode(c, path, rootPath, ig)));
    const filtered = childNodes.filter((n): n is TreeNode => n !== null).sort(compareNodes);
    // Keep a folder only if it contains at least one markdown file somewhere below it.
    if (!hasMarkdown(filtered)) return null;
    return { name: entry.name, path, isDir: true, children: filtered };
  }
  if (entry.isFile && MARKDOWN_EXT.test(entry.name)) {
    return { name: entry.name, path, isDir: false, children: [] };
  }
  return null;
}

// A vault walk issues one readDir per directory, and every one of them is an
// IPC round trip. Fanning them all out at once (a cloud folder can hold
// thousands of directories) floods the bridge, so anything the user does
// meanwhile - clicking a file, for one - waits behind the whole walk. Cap how
// many are in flight; the walk releases its slot before recursing, so nesting
// cannot deadlock.
const MAX_CONCURRENT_READ_DIR = 8;
let activeReadDirs = 0;
const readDirWaiters: (() => void)[] = [];

async function readDirSafe(path: string) {
  if (activeReadDirs >= MAX_CONCURRENT_READ_DIR) {
    await new Promise<void>((resolve) => readDirWaiters.push(resolve));
  }
  activeReadDirs++;
  try {
    return await readDir(path);
  } catch {
    return [];
  } finally {
    activeReadDirs--;
    readDirWaiters.shift()?.();
  }
}

function hasMarkdown(nodes: TreeNode[]): boolean {
  for (const node of nodes) {
    if (!node.isDir) return true;
    if (hasMarkdown(node.children)) return true;
  }
  return false;
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function joinPath(parent: string, child: string): string {
  if (parent.endsWith("/") || parent.endsWith("\\")) return parent + child;
  return `${parent}/${child}`;
}

/** Read a markdown file as text. */
export async function readFileContent(path: string): Promise<string> {
  if (!IS_TAURI) {
    const handle = webHandles.get(path);
    if (!handle || handle.kind !== "file") throw new Error(`File is no longer available: ${path}`);
    return (await (handle as FileSystemFileHandle).getFile()).text();
  }
  return readTextFile(path);
}

/** Write text to a file. */
export async function writeFileContent(path: string, content: string): Promise<void> {
  if (!IS_TAURI) {
    const handle = webHandles.get(path);
    if (!handle || handle.kind !== "file") throw new Error(`File is no longer available: ${path}`);
    const writable = await (handle as FileSystemFileHandle).createWritable();
    await writable.write(content);
    await writable.close();
    return;
  }
  await writeTextFile(path, content);
}

/** Rename / move a file. */
export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  if (!IS_TAURI) {
    await renameWebPath(oldPath, newPath);
    return;
  }
  await rename(oldPath, newPath);
}

/** Watch a folder for changes. Returns an unwatch function. */
export async function watchVault(rootPath: string, cb: () => void): Promise<UnwatchFn> {
  if (!IS_TAURI) {
    const onFocus = () => cb();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }
  return watch(
    rootPath,
    (event) => {
      if (changesTree(event)) cb();
    },
    { recursive: true },
  );
}

/** Whether a filesystem event can possibly change what the explorer shows.
 * The tree only holds markdown files and the folders leading to them, while a
 * vault kept in a cloud folder emits events continuously for everything else
 * it syncs - and each one would otherwise cost a full walk of the vault. */
function changesTree(event: WatchEvent): boolean {
  const kind = event.type;
  if (kind === "any") return true;
  if (typeof kind === "object" && "access" in kind) return false;
  // Only appearing or disappearing entries can add or drop a folder; a plain
  // modification matters solely for markdown files.
  const structural = typeof kind === "object" && ("create" in kind || "remove" in kind);
  return event.paths.some((path) => {
    const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    // Dotfiles are editor swap files and cloud bookkeeping, never tree content.
    if (name.startsWith(".")) return false;
    if (MARKDOWN_EXT.test(name)) return true;
    // No extension: most likely a directory, which only counts when created or
    // removed. Anything else with an extension is a non-markdown file.
    return structural && !name.includes(".");
  });
}

async function readWebMarkdownTree(rootPath: string): Promise<TreeNode[]> {
  const root = webRoot ?? webHandles.get(rootPath);
  if (!root) throw new Error("The folder permission has expired. Open the folder again.");
  if (root.kind === "file") {
    return MARKDOWN_EXT.test(root.name)
      ? [{ name: root.name, path: root.name, isDir: false, children: [] }]
      : [];
  }
  const directory = root as FileSystemDirectoryHandle;
  webHandles.clear();
  webHandles.set(rootPath, directory);
  const ig = ignore().add(DEFAULT_IGNORED);
  try {
    const gitignore = await directory.getFileHandle(".gitignore");
    ig.add(await (await gitignore.getFile()).text());
  } catch {
    // The folder does not contain a readable .gitignore.
  }
  return readWebDirectory(directory, rootPath, rootPath, ig);
}

async function readWebDirectory(
  directory: FileSystemDirectoryHandle,
  path: string,
  rootPath: string,
  ig: Ignore,
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];
  for await (const [name, handle] of directory.entries()) {
    const childPath = joinPath(path, name);
    const rel = relativePath(childPath, rootPath);
    if (ig.ignores(rel)) continue;
    webHandles.set(childPath, handle);
    if (handle.kind === "directory") {
      const children = await readWebDirectory(
        handle as FileSystemDirectoryHandle,
        childPath,
        rootPath,
        ig,
      );
      if (hasMarkdown(children)) nodes.push({ name, path: childPath, isDir: true, children });
    } else if (MARKDOWN_EXT.test(name)) {
      nodes.push({ name, path: childPath, isDir: false, children: [] });
    }
  }
  return nodes.sort(compareNodes);
}

async function renameWebPath(oldPath: string, newPath: string): Promise<void> {
  const handle = webHandles.get(oldPath);
  const parentPath = oldPath.slice(0, oldPath.lastIndexOf("/"));
  const parent = webHandles.get(parentPath);
  if (!handle || !parent || parent.kind !== "directory")
    throw new Error("Cannot access this path.");
  const newName = newPath.slice(newPath.lastIndexOf("/") + 1);
  const directory = parent as FileSystemDirectoryHandle;
  if (handle.kind === "file") {
    const target = await directory.getFileHandle(newName, { create: true });
    const writable = await target.createWritable();
    await writable.write(await (handle as FileSystemFileHandle).getFile());
    await writable.close();
  } else {
    const target = await directory.getDirectoryHandle(newName, { create: true });
    await copyWebDirectory(handle as FileSystemDirectoryHandle, target);
  }
  await directory.removeEntry(handle.name, { recursive: handle.kind === "directory" });
}

async function copyWebDirectory(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of source.entries()) {
    if (handle.kind === "directory") {
      await copyWebDirectory(
        handle as FileSystemDirectoryHandle,
        await target.getDirectoryHandle(name, { create: true }),
      );
    } else {
      const output = await target.getFileHandle(name, { create: true });
      const writable = await output.createWritable();
      await writable.write(await (handle as FileSystemFileHandle).getFile());
      await writable.close();
    }
  }
}

/** Strip the vault root prefix from an absolute path for display. */
export function relativePath(fullPath: string, rootPath: string | null): string {
  if (!rootPath) return fullPath;
  const norm = fullPath.replace(/\\/g, "/");
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  if (norm.startsWith(root + "/")) return norm.slice(root.length + 1);
  if (norm === root) return "";
  return fullPath;
}
