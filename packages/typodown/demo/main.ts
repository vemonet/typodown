import { createTypodown, type Theme } from "../src/index.ts";
import "../src/theme.css";
import "./demo.css";

const SAMPLE = `# Typodown

A **Typora-like** WYSIWYG editor for **GitHub Flavored Markdown**, written in
_vanilla TypeScript_ with zero runtime dependencies. Put your cursor on any
styled text and its raw \`markdown\` syntax appears, just like Typora.

## Inline formatting

Write **bold**, _italic_, ***bold italic***, ~~strikethrough~~ and
\`inline code\`. Backslash escapes work too: \\*not emphasized\\*. Links can be
[inline](https://github.com/vemonet/typodown), autolinks like
<https://viteplus.dev>, or an email such as <hello@example.com>.

Select some text and press \`Cmd/Ctrl+B\`, \`Cmd/Ctrl+I\`, or \`Cmd/Ctrl+K\`
(copy a URL first) to format it.

## Headings

# Heading level 1
## Heading level 2
### Heading level 3
#### Heading level 4
##### Heading level 5
###### Heading level 6

## Lists

Unordered lists nest with different bullets per level (Tab / Shift+Tab):

- Fruit
  - Apple
  - Banana
    - Cavendish
- Vegetables

Ordered lists keep their starting number:

3. Third item
4. Fourth item
5. Fifth item

Task lists stay interactive:

- [x] Parse GitHub Flavored Markdown
- [x] Reveal the syntax under the cursor
- [ ] Take over the world

## Blockquotes and alerts

> A plain blockquote.
> It can span several lines.

> [!NOTE]
> Useful information that users should know, even when skimming.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

## Table

Columns can be left, center, or right aligned:

| Feature     | Supported | Notes                       |
| :---------- | :-------: | --------------------------: |
| Headings    |    yes    | \`#\` through \`######\`        |
| Emphasis    |    yes    | bold, italic, strikethrough |
| Code blocks |    yes    | syntax highlighted          |
| Tables      |    yes    | with column alignment       |

## Code blocks

TypeScript:

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

Python:

\`\`\`python
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)
\`\`\`

Shell:

\`\`\`bash
npm install @vemonet/typodown
vp dev   # start this demo
\`\`\`

SPARQL:

\`\`\`sparql
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT ?name ?email WHERE {
  ?person a foaf:Person ;
          foaf:name ?name ;
          foaf:mbox ?email .
  FILTER(CONTAINS(?name, "Ada"))
}
ORDER BY ?name
LIMIT 10
\`\`\`

## Image

![MIT licensed](https://img.shields.io/badge/license-MIT-blue)

## Raw HTML

Raw HTML renders in place, and reveals its dimmed source when the caret lands on
it, just like markdown syntax. It is on by default; pass **html: false** to
turn it off.

<div style="padding: 12px; border-left: 3px solid var(--td-link); background: var(--td-block-bg); border-radius: 0 6px 6px 0;">
  <strong>Custom callout</strong> built from a block of inline-styled HTML.
</div>

<details>
  <summary>Collapsible section (click to expand)</summary>
  Hidden content inside a native <code>details</code> element.
</details>

Inline HTML like <kbd>Ctrl</kbd> + <kbd>K</kbd>, <span style="color: var(--td-caution);">colored text</span>,
subscript H<sub>2</sub>O, and <small>small print</small> all work too.

---

Everything above is driven from a single markdown string. Edit freely and the
source stays in sync.
`;

const host = document.getElementById("editor")!;
const editor = createTypodown(host, {
  value: SAMPLE,
  theme: "auto",
  placeholder: "Write some markdown...",
});

const select = document.getElementById("theme") as HTMLSelectElement;
// Keep the whole page in sync with the editor's theme, not just the editor.
const applyTheme = (theme: Theme): void => {
  editor.setTheme(theme);
  document.documentElement.dataset.theme = theme;
};
select.addEventListener("change", () => applyTheme(select.value as Theme));
applyTheme(select.value as Theme);

editor.focus();
