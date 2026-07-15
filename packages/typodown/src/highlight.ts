// Syntax highlighting for fenced code blocks and front matter.
//
// Highlighting is delegated to CodeMirror's own language parsers (the same
// Lezer grammars CodeMirror uses when a whole document is in that language):
// `tokenize(code, lang)` parses the snippet with the matching parser, walks the
// resulting tree with `@lezer/highlight`, and returns tokens whose `type` is one
// of our theme classes (see `cm-td-tok-*` in theme.css). Offsets are relative to
// the start of `code`; ranges the grammar does not tag are left as gaps
// (rendered plain), matching the previous tokenizer's contract.

import type { Parser } from "@lezer/common";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";

// First-party LR grammars.
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { pythonLanguage } from "@codemirror/lang-python";
import { StandardSQL } from "@codemirror/lang-sql";
import { jsonLanguage } from "@codemirror/lang-json";
import { htmlLanguage } from "@codemirror/lang-html";
import { cssLanguage } from "@codemirror/lang-css";
import { xmlLanguage } from "@codemirror/lang-xml";
import { javaLanguage } from "@codemirror/lang-java";
import { cppLanguage } from "@codemirror/lang-cpp";
import { rustLanguage } from "@codemirror/lang-rust";
import { phpLanguage } from "@codemirror/lang-php";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { goLanguage } from "@codemirror/lang-go";

// Legacy stream grammars for languages without a first-party Lezer package.
import { csharp, kotlin, objectiveC, scala } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { sparql } from "@codemirror/legacy-modes/mode/sparql";
import { turtle } from "@codemirror/legacy-modes/mode/turtle";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { r } from "@codemirror/legacy-modes/mode/r";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { properties } from "@codemirror/legacy-modes/mode/properties";

export interface Token {
  from: number;
  to: number;
  type: string;
}

/** Map Lezer highlight tags onto our theme's token classes (the `type` in the
 * returned tokens, rendered as `cm-td-tok-<type>`). Only these classes exist in
 * the theme; anything a grammar leaves untagged renders plain.
 */
const HIGHLIGHTER = tagHighlighter([
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.modifier,
      t.self,
    ],
    class: "keyword",
  },
  { tag: [t.bool, t.null, t.atom], class: "boolean" },
  {
    tag: [t.string, t.special(t.string), t.docString, t.character, t.regexp, t.attributeValue],
    class: "string",
  },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "comment" },
  { tag: [t.number, t.integer, t.float], class: "number" },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.macroName,
      t.typeName,
      t.className,
      t.namespace,
    ],
    class: "function",
  },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: "property" },
  {
    tag: [t.variableName, t.labelName, t.local(t.variableName), t.special(t.variableName)],
    class: "variable",
  },
  { tag: [t.tagName], class: "tag" },
  { tag: [t.attributeName], class: "attr" },
  {
    tag: [
      t.operator,
      t.arithmeticOperator,
      t.logicOperator,
      t.bitwiseOperator,
      t.compareOperator,
      t.updateOperator,
      t.definitionOperator,
      t.typeOperator,
      t.controlOperator,
    ],
    class: "operator",
  },
  {
    tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket],
    class: "punctuation",
  },
]);

function stream(parser: StreamParser<unknown>): Parser {
  return StreamLanguage.define(parser).parser;
}

/** Canonical language id -> Lezer parser. Aliases are resolved through ALIASES
 * before lookup, so only canonical names appear here.
 */
const PARSERS: Record<string, Parser> = {
  javascript: javascriptLanguage.parser,
  typescript: typescriptLanguage.parser,
  jsx: jsxLanguage.parser,
  tsx: tsxLanguage.parser,
  python: pythonLanguage.parser,
  sql: StandardSQL.language.parser,
  json: jsonLanguage.parser,
  html: htmlLanguage.parser,
  css: cssLanguage.parser,
  xml: xmlLanguage.parser,
  java: javaLanguage.parser,
  c: cppLanguage.parser,
  cpp: cppLanguage.parser,
  rust: rustLanguage.parser,
  php: phpLanguage.parser,
  yaml: yamlLanguage.parser,
  go: goLanguage.parser,
  csharp: stream(csharp),
  kotlin: stream(kotlin),
  scala: stream(scala),
  objectivec: stream(objectiveC),
  bash: stream(shell),
  ruby: stream(ruby),
  swift: stream(swift),
  sparql: stream(sparql),
  turtle: stream(turtle),
  lua: stream(lua),
  perl: stream(perl),
  r: stream(r),
  toml: stream(toml),
  dockerfile: stream(dockerFile),
  powershell: stream(powerShell),
  groovy: stream(groovy),
  haskell: stream(haskell),
  clojure: stream(clojure),
  julia: stream(julia),
  diff: stream(diff),
  ini: stream(properties),
};

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  rs: "rust",
  "c++": "cpp",
  cs: "csharp",
  "objective-c": "objectivec",
  objc: "objectivec",
  htm: "html",
  svg: "xml",
  scss: "css",
  less: "css",
  json5: "json",
  jsonc: "json",
  ttl: "turtle",
  rq: "sparql",
  ps1: "powershell",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  kt: "kotlin",
  pl: "perl",
  properties: "ini",
};

/** Names offered by the language autocomplete, roughly by popularity. */
export const LANGUAGES: string[] = [
  "javascript",
  "typescript",
  "python",
  "json",
  "bash",
  "html",
  "css",
  "sql",
  "sparql",
  "turtle",
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "yaml",
  "toml",
  "xml",
  "kotlin",
  "swift",
  "scala",
  "lua",
  "r",
  "perl",
  "haskell",
  "clojure",
  "julia",
  "groovy",
  "objectivec",
  "dockerfile",
  "powershell",
  "diff",
  "ini",
  "jsx",
  "tsx",
  "markdown",
  "graphql",
  "mermaid",
];

/** All names offered by the code-block language dropdown: canonical names plus
 *  their short aliases (js, ts, py, ...). */
export const LANGUAGE_SUGGESTIONS: string[] = [
  ...LANGUAGES,
  ...Object.keys(ALIASES).filter((alias) => !LANGUAGES.includes(alias)),
];

function getParser(lang: string): Parser | null {
  const key = lang.toLowerCase();
  return PARSERS[key] ?? PARSERS[ALIASES[key] ?? ""] ?? null;
}

/** Reverse map: canonical name → aliases that resolve to it. */
const ALIAS_OF: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const list = m.get(canonical) ?? [];
    list.push(alias);
    m.set(canonical, list);
  }
  return m;
})();

/** Returns language names (canonical + aliases) matching the query, by
 *  substring on the name itself or on any of its aliases. */
export function matchLanguages(query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  if (!q) return LANGUAGES.slice(0, limit);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of LANGUAGES) {
    if (name.includes(q) || (ALIAS_OF.get(name) ?? []).some((a) => a.includes(q))) {
      out.push(name);
      seen.add(name);
    }
  }
  for (const alias of Object.keys(ALIASES)) {
    if (alias.includes(q) && !seen.has(alias)) {
      out.push(alias);
      seen.add(alias);
    }
  }
  return out.slice(0, limit);
}

// Decoration rebuilds re-tokenize every visible code block on each keystroke
// and caret move, and a full Lezer parse is the expensive part. Memoize per
// (lang, code); Map insertion order doubles as the LRU eviction order.
const TOKEN_CACHE = new Map<string, Token[]>();
const TOKEN_CACHE_MAX = 128;

export function tokenize(code: string, lang: string): Token[] {
  const parser = getParser(lang);
  if (!parser) return [];
  const canonical = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  const key = `${canonical}\x00${code}`;
  const hit = TOKEN_CACHE.get(key);
  if (hit) {
    TOKEN_CACHE.delete(key);
    TOKEN_CACHE.set(key, hit);
    return hit;
  }
  const tree = parser.parse(code);
  const tokens: Token[] = [];
  highlightTree(tree, HIGHLIGHTER, (from, to, classes) => {
    // Each rule maps to a single class; if several tags matched, the most
    // specific (last) one wins.
    const type = classes.includes(" ") ? classes.slice(classes.lastIndexOf(" ") + 1) : classes;
    tokens.push({ from, to, type });
  });
  TOKEN_CACHE.set(key, tokens);
  if (TOKEN_CACHE.size > TOKEN_CACHE_MAX) {
    TOKEN_CACHE.delete(TOKEN_CACHE.keys().next().value!);
  }
  return tokens;
}
