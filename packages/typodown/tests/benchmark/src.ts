import Muya from "@marktext/muya";
import { Typodown } from "../../src/index.ts";
import "../../src/theme.css";
import "./style.css";

type Engine = "typodown" | "muya";
type Transition = "show-markers" | "render";
type DocumentPosition = "start" | "middle" | "end";
type LargeAction = Transition | "edit-paragraph" | "edit-code";

interface ToggleSample {
  transition: Transition;
  scriptMs: number;
  paintMs: number;
  mutations: number;
}

interface ActionSample {
  action: LargeAction;
  position: DocumentPosition;
  scriptMs: number;
  paintMs: number;
  mutations: number;
}

interface ScrollSample {
  step: number;
  settleMs: number;
  frames: number;
  maxVisibleGapPx: number;
  scrollCorrectionPx: number;
}

interface BenchmarkWindow extends Window {
  toggleBenchmark: {
    setup(engine: Engine, paragraphs: number): Promise<void>;
    run(iterations: number, warmup: number): Promise<ToggleSample[]>;
    setupLarge(engine: Engine, sections: number): Promise<void>;
    setupScrollDocument(engine: Engine, markdown: string): Promise<void>;
    runLarge(iterations: number, warmup: number): Promise<ActionSample[]>;
    runScroll(steps: number): Promise<ScrollSample[]>;
    stats(): { domNodes: number; textLength: number };
    destroy(): void;
  };
}

const MARKER_TEXT = "benchmark target";
const host = document.querySelector<HTMLElement>("#benchmark")!;
let destroyEditor: (() => void) | undefined;
let moveCursor: ((showMarkers: boolean) => void) | undefined;
let performLargeAction: ((action: LargeAction, position: DocumentPosition) => void) | undefined;
let prepareLargePosition: ((position: DocumentPosition, action: LargeAction) => void) | undefined;
let scrollTarget: HTMLElement | undefined;

const POSITIONS: DocumentPosition[] = ["start", "middle", "end"];
const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "cpp",
  "c",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "sql",
  "html",
  "css",
  "json",
  "yaml",
  "bash",
  "dockerfile",
];

function fixture(paragraphs: number): string {
  return Array.from(
    { length: paragraphs },
    (_, index) =>
      `Paragraph ${index + 1}: **${MARKER_TEXT}** with an adjacent plain-text idle anchor.`,
  ).join("\n\n");
}

function largeFixture(sections: number): string {
  return Array.from({ length: sections }, (_, index) => {
    const position =
      index === 0
        ? "start"
        : index === Math.floor(sections / 2)
          ? "middle"
          : index === sections - 1
            ? "end"
            : `section-${index}`;
    const language = LANGUAGES[index % LANGUAGES.length];
    return `## Section ${index + 1}

Paragraph ${index + 1} contains **bold-${position}**, *emphasis*, ~~strike~~, [a link](https://example.com/${index}), \`inline code\`, $x_${index}^2$, and PARAGRAPH_TARGET_${position}_Q.

- List item ${index}
- [${index % 2 ? "x" : " "}] Task item

> A quoted line with **formatted text**.

| Name | Value | Status |
| --- | ---: | :---: |
| row-${index} | ${index} | ok |

\`\`\`${language}
// CODE_TARGET_${position}_Q
const section_${index} = ${index};
\`\`\`

<kbd>HTML ${index}</kbd>`;
  }).join("\n\n");
}

function targetOffsets(markdown: string, position: DocumentPosition) {
  const bold = `bold-${position}`;
  const paragraph = `PARAGRAPH_TARGET_${position}_Q`;
  const code = `CODE_TARGET_${position}_Q`;
  return {
    marker: markdown.indexOf(bold) + 2,
    idle: markdown.indexOf(paragraph) + 3,
    paragraphEdit: markdown.indexOf(paragraph) + paragraph.length - 1,
    codeEdit: markdown.indexOf(code) + code.length - 1,
  };
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setupTypodown(markdown: string): void {
  const editor = new Typodown(host, {
    value: markdown,
    outline: false,
    toolbar: "hidden",
    html: true,
  });
  const view = (editor as unknown as { view: { dispatch(spec: object): void; focus(): void } })
    .view;
  const markerPosition = markdown.indexOf(MARKER_TEXT) + 3;
  const idlePosition = markdown.indexOf("idle anchor") + 3;

  moveCursor = (showMarkers) => {
    view.dispatch({ selection: { anchor: showMarkers ? markerPosition : idlePosition } });
  };
  view.focus();
  destroyEditor = () => editor.destroy();
}

function setupLargeTypodown(markdown: string): void {
  const editor = new Typodown(host, {
    value: markdown,
    outline: false,
    toolbar: "hidden",
    html: true,
  });
  const view = (
    editor as unknown as {
      view: {
        state: { doc: { sliceString(from: number, to: number): string } };
        dispatch(spec: object): void;
        focus(): void;
      };
    }
  ).view;
  const offsets = Object.fromEntries(
    POSITIONS.map((position) => [position, targetOffsets(markdown, position)]),
  ) as Record<DocumentPosition, ReturnType<typeof targetOffsets>>;
  let editCharacter = "x";

  performLargeAction = (action, position) => {
    const target = offsets[position];
    if (action === "show-markers" || action === "render") {
      view.dispatch({
        selection: { anchor: action === "show-markers" ? target.marker : target.idle },
      });
      return;
    }
    const from = action === "edit-paragraph" ? target.paragraphEdit : target.codeEdit;
    view.dispatch({ changes: { from, to: from + 1, insert: editCharacter } });
    editCharacter = editCharacter === "x" ? "y" : "x";
  };
  prepareLargePosition = (position, action) => {
    const target = offsets[position];
    const anchor =
      action === "show-markers"
        ? target.idle
        : action === "render"
          ? target.marker
          : action === "edit-paragraph"
            ? target.paragraphEdit
            : target.codeEdit;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
  };
  scrollTarget = editor.wrapper.querySelector<HTMLElement>(".cm-scroller") ?? undefined;
  view.focus();
  destroyEditor = () => editor.destroy();
}

interface MuyaContentBlock {
  domNode?: HTMLElement;
  text: string;
  setCursor(begin: number, end: number, needUpdate?: boolean): void;
}

interface MuyaTree {
  depthFirstTraverse(callback: (node: unknown) => void): void;
}

function muyaContentBlocks(editor: Muya): MuyaContentBlock[] {
  const blocks: MuyaContentBlock[] = [];
  const tree = editor.editor.scrollPage as unknown as MuyaTree;
  tree.depthFirstTraverse((node) => {
    const candidate = node as Partial<MuyaContentBlock>;
    if (typeof candidate.text === "string" && candidate.setCursor) {
      blocks.push(candidate as MuyaContentBlock);
    }
  });
  return blocks;
}

function setupMuya(markdown: string): void {
  const mount = document.createElement("div");
  host.appendChild(mount);
  const editor = new Muya(mount, {
    markdown,
    disableHtml: false,
    math: true,
    hideQuickInsertHint: true,
  });
  editor.init();

  const content = muyaContentBlocks(editor).find((block) => block.text.includes(MARKER_TEXT));
  if (!content) throw new Error("Could not find Muya benchmark content block");

  const markerPosition = content.text.indexOf(MARKER_TEXT) + 3;
  const idlePosition = content.text.indexOf("idle anchor") + 3;
  moveCursor = (showMarkers) => {
    content!.setCursor(
      showMarkers ? markerPosition : idlePosition,
      showMarkers ? markerPosition : idlePosition,
      true,
    );
  };
  destroyEditor = () => editor.destroy();
}

function setupLargeMuya(markdown: string): void {
  const mount = document.createElement("div");
  host.appendChild(mount);
  const editor = new Muya(mount, {
    markdown,
    disableHtml: false,
    math: true,
    hideQuickInsertHint: true,
  });
  editor.init();
  const blocks = muyaContentBlocks(editor);
  const targets = Object.fromEntries(
    POSITIONS.map((position) => {
      const bold = `bold-${position}`;
      const paragraphToken = `PARAGRAPH_TARGET_${position}_Q`;
      const codeToken = `CODE_TARGET_${position}_Q`;
      const paragraph = blocks.find((block) => block.text.includes(paragraphToken));
      const code = blocks.find((block) => block.text.includes(codeToken));
      if (!paragraph || !code) throw new Error(`Could not find Muya ${position} targets`);
      return [
        position,
        {
          paragraph,
          code,
          marker: paragraph.text.indexOf(bold) + 2,
          idle: paragraph.text.indexOf(paragraphToken) + 3,
          paragraphEdit: paragraph.text.indexOf(paragraphToken) + paragraphToken.length - 1,
          codeEdit: code.text.indexOf(codeToken) + codeToken.length - 1,
        },
      ];
    }),
  ) as Record<
    DocumentPosition,
    {
      paragraph: MuyaContentBlock;
      code: MuyaContentBlock;
      marker: number;
      idle: number;
      paragraphEdit: number;
      codeEdit: number;
    }
  >;
  let editCharacter = "x";

  performLargeAction = (action, position) => {
    const target = targets[position];
    if (action === "show-markers" || action === "render") {
      target.paragraph.setCursor(
        action === "show-markers" ? target.marker : target.idle,
        action === "show-markers" ? target.marker : target.idle,
        true,
      );
      return;
    }
    if (!document.execCommand("insertText", false, editCharacter)) {
      throw new Error("Muya edit command was rejected by the browser");
    }
    editCharacter = editCharacter === "x" ? "y" : "x";
  };
  prepareLargePosition = (position, action) => {
    const target = targets[position];
    const block = action === "edit-code" ? target.code : target.paragraph;
    const offset =
      action === "show-markers"
        ? target.idle
        : action === "render"
          ? target.marker
          : action === "edit-paragraph"
            ? target.paragraphEdit
            : target.codeEdit;
    block.setCursor(offset, action.startsWith("edit-") ? offset + 1 : offset, true);
    block.domNode?.scrollIntoView({ block: "center" });
  };
  scrollTarget = host;
  destroyEditor = () => editor.destroy();
}

async function setup(engine: Engine, paragraphs: number): Promise<void> {
  destroyEditor?.();
  host.replaceChildren();
  const markdown = fixture(paragraphs);
  if (engine === "typodown") setupTypodown(markdown);
  else setupMuya(markdown);
  moveCursor?.(false);
  await nextPaint();
}

async function setupLarge(engine: Engine, sections: number): Promise<void> {
  destroyEditor?.();
  host.replaceChildren();
  const markdown = largeFixture(sections);
  if (engine === "typodown") setupLargeTypodown(markdown);
  else setupLargeMuya(markdown);
  await nextPaint();
}

async function setupScrollDocument(engine: Engine, markdown: string): Promise<void> {
  destroyEditor?.();
  host.replaceChildren();
  if (engine === "typodown") {
    const editor = new Typodown(host, {
      value: markdown,
      outline: false,
      toolbar: "hidden",
      html: true,
    });
    scrollTarget = editor.wrapper.querySelector<HTMLElement>(".cm-scroller") ?? undefined;
    editor.focus();
    destroyEditor = () => editor.destroy();
  } else {
    const mount = document.createElement("div");
    host.appendChild(mount);
    const editor = new Muya(mount, {
      markdown,
      disableHtml: false,
      math: true,
      hideQuickInsertHint: true,
    });
    editor.init();
    scrollTarget = host;
    destroyEditor = () => editor.destroy();
  }
  await nextPaint();
}

function visibleGapPx(scroller: HTMLElement): number {
  const viewport = scroller.getBoundingClientRect();
  let largest = 0;
  for (const gap of host.querySelectorAll<HTMLElement>(".cm-gap")) {
    const rect = gap.getBoundingClientRect();
    const overlap = Math.min(viewport.bottom, rect.bottom) - Math.max(viewport.top, rect.top);
    largest = Math.max(largest, overlap);
  }
  return largest;
}

/** Measure viewport rendering itself, which the action benchmark deliberately
 * excludes. A sample settles after two frames with no visible CodeMirror gap
 * and no scroll correction, capped to avoid hanging on a regression. */
async function runScroll(steps: number): Promise<ScrollSample[]> {
  const scroller = scrollTarget;
  if (!scroller) throw new Error("Large benchmark editor is not initialized");
  scroller.scrollTop = 0;
  await nextPaint();

  const samples: ScrollSample[] = [];
  for (let step = 1; step <= steps; step++) {
    const target = ((scroller.scrollHeight - scroller.clientHeight) * step) / steps;
    const started = performance.now();
    scroller.scrollTop = target;
    let frames = 0;
    let stableFrames = 0;
    let previousTop = scroller.scrollTop;
    let maxVisibleGapPx = 0;
    while (frames < 12 && stableFrames < 2) {
      await nextFrame();
      frames++;
      const gap = visibleGapPx(scroller);
      maxVisibleGapPx = Math.max(maxVisibleGapPx, gap);
      const currentTop = scroller.scrollTop;
      if (gap < 1 && Math.abs(currentTop - previousTop) < 1) stableFrames++;
      else stableFrames = 0;
      previousTop = currentTop;
    }
    samples.push({
      step,
      settleMs: performance.now() - started,
      frames,
      maxVisibleGapPx,
      scrollCorrectionPx: Math.abs(scroller.scrollTop - target),
    });
  }
  return samples;
}

async function toggle(showMarkers: boolean): Promise<ToggleSample> {
  if (!moveCursor) throw new Error("Benchmark editor is not initialized");
  let mutations = 0;
  const observer = new MutationObserver((records) => {
    mutations += records.length;
  });
  observer.observe(host, { attributes: true, childList: true, subtree: true, characterData: true });

  const started = performance.now();
  moveCursor(showMarkers);
  const scriptFinished = performance.now();
  await nextPaint();
  const painted = performance.now();
  observer.disconnect();
  return {
    transition: showMarkers ? "show-markers" : "render",
    scriptMs: scriptFinished - started,
    paintMs: painted - started,
    mutations,
  };
}

async function run(iterations: number, warmup: number): Promise<ToggleSample[]> {
  for (let index = 0; index < warmup; index++) {
    await toggle(index % 2 === 0);
  }
  const samples: ToggleSample[] = [];
  for (let index = 0; index < iterations; index++) {
    samples.push(await toggle(index % 2 === 0));
  }
  return samples;
}

async function largeAction(action: LargeAction, position: DocumentPosition): Promise<ActionSample> {
  if (!performLargeAction) throw new Error("Large benchmark editor is not initialized");
  let mutations = 0;
  const observer = new MutationObserver((records) => {
    mutations += records.length;
  });
  observer.observe(host, { attributes: true, childList: true, subtree: true, characterData: true });
  const started = performance.now();
  performLargeAction(action, position);
  const scriptFinished = performance.now();
  await nextPaint();
  const painted = performance.now();
  observer.disconnect();
  return {
    action,
    position,
    scriptMs: scriptFinished - started,
    paintMs: painted - started,
    mutations,
  };
}

async function runLarge(iterations: number, warmup: number): Promise<ActionSample[]> {
  if (!prepareLargePosition) throw new Error("Large benchmark editor is not initialized");
  const actions: LargeAction[] = ["show-markers", "render", "edit-paragraph", "edit-code"];
  for (let index = 0; index < warmup; index++) {
    const action = actions[index % actions.length]!;
    prepareLargePosition(POSITIONS[index % POSITIONS.length]!, action);
    await nextPaint();
    await largeAction(action, POSITIONS[index % POSITIONS.length]!);
  }
  const samples: ActionSample[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const position of POSITIONS) {
      for (const action of actions) {
        prepareLargePosition(position, action);
        await nextPaint();
        samples.push(await largeAction(action, position));
      }
    }
  }
  return samples;
}

(window as unknown as BenchmarkWindow).toggleBenchmark = {
  setup,
  run,
  setupLarge,
  setupScrollDocument,
  runLarge,
  runScroll,
  stats: () => ({
    domNodes: host.querySelectorAll("*").length,
    textLength: host.textContent?.length ?? 0,
  }),
  destroy: () => destroyEditor?.(),
};
