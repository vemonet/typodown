import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, writeTextFile, watch, type UnwatchFn } from "@tauri-apps/plugin-fs";

export type { UnwatchFn } from "@tauri-apps/plugin-fs";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i;
const HIDDEN_SEG = /(^|\/)\.[^/]/;

/** Open a folder picker. Returns the absolute path or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title: "Open markdown vault" });
  return typeof result === "string" ? result : null;
}

/** Open a single markdown file picker. Returns the absolute path or null. */
export async function pickMarkdownFile(): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title: "Open markdown file",
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] }],
  });
  return typeof result === "string" ? result : null;
}

/** Recursively read a directory and return a tree containing only markdown
 * files and the folders that hold them. Hidden paths (dotfiles / dotdirs) are
 * skipped. Folders are sorted before files, each group alphabetical. */
export async function readMarkdownTree(rootPath: string): Promise<TreeNode[]> {
  const root = await readDirSafe(rootPath);
  const nodes = await Promise.all(root.map(async (entry) => buildNode(entry, rootPath)));
  return nodes.filter((n): n is TreeNode => n !== null).sort(compareNodes);
}

async function buildNode(
  entry: { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean },
  parentPath: string,
): Promise<TreeNode | null> {
  if (HIDDEN_SEG.test(entry.name)) return null;
  const path = joinPath(parentPath, entry.name);
  if (entry.isDirectory) {
    const children = await readDirSafe(path);
    const childNodes = await Promise.all(children.map((c) => buildNode(c, path)));
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

async function readDirSafe(path: string) {
  try {
    return await readDir(path);
  } catch {
    return [];
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
  return readTextFile(path);
}

/** Write text to a file. */
export async function writeFileContent(path: string, content: string): Promise<void> {
  await writeTextFile(path, content);
}

/** Watch a folder for changes. Returns an unwatch function. */
export async function watchVault(rootPath: string, cb: () => void): Promise<UnwatchFn> {
  return watch(rootPath, cb, { recursive: true });
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
