// Lightweight, dependency-free syntax highlighter.
//
// `tokenize(code, lang)` returns tokens with offsets relative to the start of
// `code`. Unmatched characters are left as gaps (rendered plain), so the
// renderer can rebuild pieces covering the whole code range for caret mapping.
//
// Each grammar is an ordered list of rules; the first rule that matches at the
// cursor wins. Rules use sticky (`y`) regexes so they only match at the current
// position. A rule with an empty `type` consumes text without colouring it
// (used to swallow identifiers so keywords are not matched mid-word).

export interface Token {
  from: number;
  to: number;
  type: string;
}

interface Rule {
  type: string;
  re: RegExp;
}
type Grammar = Rule[];

function rx(pattern: string, insensitive = false): RegExp {
  return new RegExp(pattern, insensitive ? "iy" : "y");
}

function words(list: string): string {
  return list.trim().split(/\s+/).join("|");
}

// ---- shared rules -------------------------------------------------------

const STR_DOUBLE: Rule = { type: "string", re: rx(`"(?:\\\\.|[^"\\\\\\n])*"?`) };
const STR_SINGLE: Rule = { type: "string", re: rx(`'(?:\\\\.|[^'\\\\\\n])*'?`) };
const STR_TEMPLATE: Rule = { type: "string", re: rx("`(?:\\\\.|[^`\\\\])*`?") };
const COMMENT_SLASH: Rule = { type: "comment", re: rx("//[^\\n]*") };
const COMMENT_BLOCK: Rule = { type: "comment", re: rx("/\\*[\\s\\S]*?\\*/") };
const COMMENT_HASH: Rule = { type: "comment", re: rx("#[^\\n]*") };
const NUMBER: Rule = {
  type: "number",
  re: rx("0[xX][0-9a-fA-F]+|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"),
};
const IDENT_SKIP: Rule = { type: "", re: rx("[A-Za-z_$][\\w$]*") };
const OPERATOR: Rule = { type: "operator", re: rx("[+\\-*/%=<>!&|^~?:]+") };
const PUNCT: Rule = { type: "punctuation", re: rx("[{}()\\[\\].,;]") };
const FUNC: Rule = { type: "function", re: rx("[A-Za-z_$][\\w$]*(?=\\s*\\()") };

// Build a C-like grammar from a keyword list.
function clike(keywords: string, constants = "true false null"): Grammar {
  return [
    COMMENT_SLASH,
    COMMENT_BLOCK,
    STR_DOUBLE,
    STR_SINGLE,
    STR_TEMPLATE,
    NUMBER,
    { type: "keyword", re: rx(`(?:${words(keywords)})\\b`) },
    { type: "boolean", re: rx(`(?:${words(constants)})\\b`) },
    FUNC,
    IDENT_SKIP,
    OPERATOR,
    PUNCT,
  ];
}

const JS = clike(
  `const let var function return if else for while do switch case default break
   continue new delete typeof instanceof in of this class extends super import
   export from as async await yield try catch finally throw void interface type
   enum implements public private protected readonly abstract namespace declare
   keyof infer satisfies static get set`,
  "true false null undefined NaN Infinity",
);

const PY: Grammar = [
  COMMENT_HASH,
  { type: "string", re: rx(`[rbfRBF]?"""[\\s\\S]*?"""`) },
  { type: "string", re: rx(`[rbfRBF]?'''[\\s\\S]*?'''`) },
  { type: "string", re: rx(`[rbfRBF]?"(?:\\\\.|[^"\\\\\\n])*"?`) },
  { type: "string", re: rx(`[rbfRBF]?'(?:\\\\.|[^'\\\\\\n])*'?`) },
  { type: "function", re: rx("@[\\w.]+") },
  NUMBER,
  {
    type: "keyword",
    re: rx(
      `(?:${words(`def class return if elif else for while break continue import
       from as pass with try except finally raise lambda yield global nonlocal
       in is not and or async await del assert match case`)})\\b`,
    ),
  },
  { type: "boolean", re: rx("(?:None|True|False)\\b") },
  FUNC,
  IDENT_SKIP,
  OPERATOR,
  PUNCT,
];

const SQL: Grammar = [
  { type: "comment", re: rx("--[^\\n]*") },
  COMMENT_BLOCK,
  { type: "string", re: rx(`'(?:''|[^'])*'?`) },
  { type: "string", re: rx(`"(?:""|[^"])*"?`) },
  NUMBER,
  {
    type: "keyword",
    re: rx(
      `(?:${words(`select from where insert into update delete set values create
       table alter drop truncate join left right inner outer full cross on using
       group by order having limit offset as and or not null is in like between
       distinct union all case when then else end primary key foreign references
       index unique default constraint asc desc count sum avg min max exists`)})\\b`,
      true,
    ),
  },
  { type: "boolean", re: rx("(?:true|false|null)\\b", true) },
  FUNC,
  IDENT_SKIP,
  OPERATOR,
  PUNCT,
];

const SPARQL: Grammar = [
  COMMENT_HASH,
  { type: "string", re: rx(`"""[\\s\\S]*?"""|'''[\\s\\S]*?'''`) },
  STR_DOUBLE,
  STR_SINGLE,
  { type: "iri", re: rx('<[^<>"{}|^`\\s]*>') },
  { type: "variable", re: rx("[?$][A-Za-z_][\\w]*") },
  { type: "attr", re: rx("@[A-Za-z-]+") },
  { type: "number", re: rx("[+-]?\\b\\d[\\d]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?") },
  {
    type: "keyword",
    re: rx(
      `(?:${words(`prefix base select construct describe ask where from named
       distinct reduced order by asc desc limit offset group having filter
       optional union minus graph service bind values as exists not in insert
       delete data with using clear drop create load add move copy silent to
       separator`)})\\b`,
      true,
    ),
  },
  {
    type: "function",
    re: rx(
      `(?:${words(`str lang langmatches datatype bound iri uri bnode rand abs
       ceil floor round concat strlen ucase lcase encode_for_uri contains
       strstarts strends strbefore strafter year month day hours minutes seconds
       timezone tz now uuid struuid md5 sha1 sha256 sha384 sha512 coalesce if
       strlang strdt sameterm isiri isuri isblank isliteral isnumeric regex
       substr replace count sum min max avg sample group_concat`)})\\b`,
      true,
    ),
  },
  // Prefixed names (foo:bar) and the "a" keyword (rdf:type).
  { type: "prefixed", re: rx("[A-Za-z_][\\w.-]*:[A-Za-z_][\\w.-]*|[A-Za-z_][\\w.-]*:") },
  { type: "keyword", re: rx("a(?=\\s)") },
  IDENT_SKIP,
  OPERATOR,
  { type: "punctuation", re: rx("[{}().,;]") },
];

const JSON_G: Grammar = [
  { type: "property", re: rx(`"(?:\\\\.|[^"\\\\])*"(?=\\s*:)`) },
  { type: "string", re: rx(`"(?:\\\\.|[^"\\\\])*"?`) },
  NUMBER,
  { type: "boolean", re: rx("(?:true|false|null)\\b") },
  PUNCT,
];

const YAML_G: Grammar = [
  COMMENT_HASH,
  { type: "property", re: rx("[\\w.-]+(?=\\s*:)") },
  STR_DOUBLE,
  STR_SINGLE,
  { type: "boolean", re: rx("(?:true|false|null|yes|no|~)\\b", true) },
  NUMBER,
  { type: "punctuation", re: rx("[-:?\\[\\]{},]") },
];

const CSS_G: Grammar = [
  COMMENT_BLOCK,
  { type: "keyword", re: rx("@[\\w-]+") },
  STR_DOUBLE,
  STR_SINGLE,
  { type: "number", re: rx("#[0-9a-fA-F]{3,8}\\b") },
  { type: "property", re: rx("[A-Za-z-]+(?=\\s*:)") },
  { type: "function", re: rx("[A-Za-z-]+(?=\\()") },
  { type: "number", re: rx("\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|ex|ch)?") },
  { type: "punctuation", re: rx("[{}();:,]") },
];

const MARKUP: Grammar = [
  { type: "comment", re: rx("<!--[\\s\\S]*?-->") },
  { type: "tag", re: rx("</?[A-Za-z][\\w-]*|/?>") },
  { type: "attr", re: rx("[A-Za-z_:][\\w:.-]*(?==)") },
  STR_DOUBLE,
  STR_SINGLE,
];

const BASH: Grammar = [
  COMMENT_HASH,
  STR_DOUBLE,
  STR_SINGLE,
  { type: "variable", re: rx("\\$\\{?[A-Za-z_]\\w*\\}?|\\$[0-9@*#?$!-]") },
  {
    type: "keyword",
    re: rx(
      `(?:${words(`if then elif else fi for while until do done case esac in
       function return exit break continue local export readonly declare source
       echo cd set unset trap eval`)})\\b`,
    ),
  },
  NUMBER,
  OPERATOR,
  { type: "punctuation", re: rx("[{}()\\[\\];|&]") },
];

const GRAMMARS: Record<string, Grammar> = {
  javascript: JS,
  typescript: JS,
  jsx: JS,
  tsx: JS,
  python: PY,
  sql: SQL,
  sparql: SPARQL,
  json: JSON_G,
  json5: JSON_G,
  yaml: YAML_G,
  css: CSS_G,
  scss: CSS_G,
  less: CSS_G,
  html: MARKUP,
  xml: MARKUP,
  svg: MARKUP,
  bash: BASH,
  java: clike(
    `public private protected class interface extends implements void int long
     double float boolean char byte short new return if else for while do switch
     case default break continue try catch finally throw throws this super static
     final abstract synchronized volatile transient package import enum var
     instanceof record sealed`,
  ),
  c: clike(
    `int char float double void long short unsigned signed struct union enum
     typedef const static extern return if else for while do switch case default
     break continue goto sizeof volatile register inline`,
    "true false NULL",
  ),
  cpp: clike(
    `int char float double void long short unsigned signed struct union enum
     typedef const static extern return if else for while do switch case default
     break continue goto sizeof class public private protected virtual template
     typename namespace using new delete this operator friend override final auto
     inline constexpr noexcept nullptr bool mutable explicit`,
    "true false nullptr NULL",
  ),
  csharp: clike(
    `using namespace class struct interface enum public private protected internal
     static readonly const void int string bool var new return if else for foreach
     while do switch case default break continue try catch finally throw this base
     async await get set override virtual abstract sealed partial record yield`,
    "true false null",
  ),
  go: clike(
    `func package import var const type struct interface map chan go defer return
     if else for range switch case default break continue fallthrough select`,
    "nil true false iota",
  ),
  rust: clike(
    `fn let mut const static struct enum trait impl mod use pub crate self super
     return if else for while loop match break continue ref move where as dyn
     async await unsafe extern type`,
    "true false Some None Ok Err",
  ),
  php: clike(
    `function class interface trait extends implements public private protected
     static const var return if else elseif for foreach while do switch case
     default break continue try catch finally throw new echo print namespace use
     instanceof abstract final global`,
    "true false null TRUE FALSE NULL",
  ),
  ruby: clike(
    `def class module end if elsif else unless case when then while until for in
     do begin rescue ensure raise return yield next break self require include
     attr_accessor attr_reader attr_writer lambda proc puts`,
    "true false nil",
  ),
  kotlin: clike(
    `fun val var class interface object return if else for while do when is in as
     import package public private protected internal open abstract override
     sealed data enum companion init constructor lateinit suspend`,
    "true false null",
  ),
  swift: clike(
    `func let var class struct enum protocol extension return if else for while
     repeat switch case default break continue guard defer import public private
     internal fileprivate static override init deinit self super throws try catch`,
    "true false nil",
  ),
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
  htm: "html",
  ttl: "turtle",
  turtle: "sparql",
  rq: "sparql",
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
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "yaml",
  "xml",
  "kotlin",
  "swift",
  "scss",
  "jsx",
  "tsx",
  "markdown",
  "turtle",
  "graphql",
];

function getGrammar(lang: string): Grammar | null {
  const key = lang.toLowerCase();
  return GRAMMARS[key] ?? GRAMMARS[ALIASES[key] ?? ""] ?? null;
}

// Reverse map: canonical name → aliases that resolve to it.
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

export function tokenize(code: string, lang: string): Token[] {
  const grammar = getGrammar(lang);
  if (!grammar) return [];
  const tokens: Token[] = [];
  let i = 0;
  const len = code.length;
  while (i < len) {
    let matched = false;
    for (const rule of grammar) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        if (rule.type) tokens.push({ from: i, to: i + m[0].length, type: rule.type });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return tokens;
}
