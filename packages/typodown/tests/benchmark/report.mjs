function fixed(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function ratio(smaller, larger) {
  if (!smaller || !larger) return "n/a";
  return `${fixed(larger / smaller, 1)}x`;
}

function lower(value, other, rendered) {
  return value <= other ? `**${rendered}**` : rendered;
}

function engineResult(results, engine) {
  const result = results.find((entry) => entry.engine === engine);
  if (!result) throw new Error(`Missing ${engine} benchmark result`);
  return result;
}

export function renderMarkdownReport(report) {
  const generated = new Date(report.generatedAt).toISOString();
  const lines = ["# Typodown benchmark", "", `Generated: ${generated}`, "", "## Summary", ""];

  const largeTypodown = engineResult(report.largeResults, "typodown");
  const largeMuya = engineResult(report.largeResults, "muya");
  lines.push(
    `The large mixed document contains ${largeTypodown.sections.toLocaleString("en-US")} sections. Typodown used ${largeTypodown.resources.domNodes.toLocaleString("en-US")} DOM nodes versus ${largeMuya.resources.domNodes.toLocaleString("en-US")} for [Muya](https://github.com/marktext/marktext/tree/develop/packages/muya) (${ratio(largeTypodown.resources.domNodes, largeMuya.resources.domNodes)} fewer), and ${fixed(largeTypodown.resources.jsHeapMiB, 1)} MiB retained JavaScript heap versus ${fixed(largeMuya.resources.jsHeapMiB, 1)} MiB.`,
    "",
    `Across the measured large-document action batch, Typodown used ${fixed(largeTypodown.resources.taskMs, 1)} ms of Chromium task time versus ${fixed(largeMuya.resources.taskMs, 1)} ms for [Muya](https://github.com/marktext/marktext/tree/develop/packages/muya) (${ratio(largeTypodown.resources.taskMs, largeMuya.resources.taskMs)} less).`,
    "",
    "## Environment",
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| Platform | ${report.environment.platform} |`,
    `| Node | ${report.environment.nodeVersion} |`,
    `| Chromium | ${report.environment.chromiumVersion} |`,
    `| Toggle iterations | ${report.environment.iterations} |`,
    `| Warmup iterations | ${report.environment.warmup} |`,
    `| Large sections | ${report.environment.largeSections} |`,
    `| Large action iterations | ${report.environment.largeIterations} |`,
    `| Scroll steps | ${report.environment.scrollSteps} |`,
    "",
    "## Marker transition scaling",
    "",
    "Mean synchronous duration. Lower is better.",
    "",
    "| Paragraphs | Engine | Show markers | Render | Task time | Heap | DOM nodes |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of report.results) {
    const other = report.results.find(
      (entry) => entry.paragraphs === result.paragraphs && entry.engine !== result.engine,
    );
    if (!other) throw new Error(`Missing comparison for ${result.paragraphs} paragraphs`);
    lines.push(
      `| ${result.paragraphs} | ${result.engine} | ${lower(result.showMarkers.scriptMeanMs, other.showMarkers.scriptMeanMs, `${fixed(result.showMarkers.scriptMeanMs)} ms`)} | ${lower(result.render.scriptMeanMs, other.render.scriptMeanMs, `${fixed(result.render.scriptMeanMs)} ms`)} | ${lower(result.resources.taskMs, other.resources.taskMs, `${fixed(result.resources.taskMs, 1)} ms`)} | ${lower(result.resources.jsHeapMiB, other.resources.jsHeapMiB, `${fixed(result.resources.jsHeapMiB, 1)} MiB`)} | ${lower(result.resources.domNodes, other.resources.domNodes, result.resources.domNodes.toLocaleString("en-US"))} |`,
    );
  }

  lines.push(
    "",
    "## Large mixed document resources",
    "",
    "| Engine | Setup | Task time | Layout | Style | Heap | DOM nodes |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of report.largeResults) {
    const other = result.engine === "typodown" ? largeMuya : largeTypodown;
    lines.push(
      `| ${result.engine} | ${lower(result.setupMs, other.setupMs, `${fixed(result.setupMs, 1)} ms`)} | ${lower(result.resources.taskMs, other.resources.taskMs, `${fixed(result.resources.taskMs, 1)} ms`)} | ${lower(result.resources.layoutMs, other.resources.layoutMs, `${fixed(result.resources.layoutMs, 1)} ms`)} | ${lower(result.resources.styleMs, other.resources.styleMs, `${fixed(result.resources.styleMs, 1)} ms`)} | ${lower(result.resources.jsHeapMiB, other.resources.jsHeapMiB, `${fixed(result.resources.jsHeapMiB, 1)} MiB`)} | ${lower(result.resources.domNodes, other.resources.domNodes, result.resources.domNodes.toLocaleString("en-US"))} |`,
    );
  }

  lines.push(
    "",
    "## `test.md` scrolling",
    "",
    "The repository torture fixture is measured separately.",
    "",
    "| Engine | Size | Mean settle | P95 settle | P95 frames | Max visible gap | Max scroll correction |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of report.testDocumentResults) {
    const other = report.testDocumentResults.find((entry) => entry.engine !== result.engine);
    if (!other) throw new Error(`Missing test.md comparison for ${result.engine}`);
    lines.push(
      `| ${result.engine} | ${result.bytes.toLocaleString("en-US")} bytes | ${lower(result.scroll.settleMeanMs, other.scroll.settleMeanMs, `${fixed(result.scroll.settleMeanMs)} ms`)} | ${lower(result.scroll.settleP95Ms, other.scroll.settleP95Ms, `${fixed(result.scroll.settleP95Ms)} ms`)} | ${lower(result.scroll.framesP95, other.scroll.framesP95, result.scroll.framesP95)} | ${lower(result.scroll.maxVisibleGapPx, other.scroll.maxVisibleGapPx, `${fixed(result.scroll.maxVisibleGapPx, 1)} px`)} | ${lower(result.scroll.maxScrollCorrectionPx, other.scroll.maxScrollCorrectionPx, `${fixed(result.scroll.maxScrollCorrectionPx, 1)} px`)} |`,
    );
  }

  lines.push(
    "",
    "## Large document scrolling",
    "",
    "Programmatic jumps from the top to the bottom of the document. Settle time includes animation frames until the scroll offset is stable and no CodeMirror spacer intersects the viewport.",
    "",
    "| Engine | Mean settle | P95 settle | P95 frames | Max visible gap | Max scroll correction |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of report.largeResults) {
    const other = result.engine === "typodown" ? largeMuya : largeTypodown;
    lines.push(
      `| ${result.engine} | ${lower(result.scroll.settleMeanMs, other.scroll.settleMeanMs, `${fixed(result.scroll.settleMeanMs)} ms`)} | ${lower(result.scroll.settleP95Ms, other.scroll.settleP95Ms, `${fixed(result.scroll.settleP95Ms)} ms`)} | ${lower(result.scroll.framesP95, other.scroll.framesP95, result.scroll.framesP95)} | ${lower(result.scroll.maxVisibleGapPx, other.scroll.maxVisibleGapPx, `${fixed(result.scroll.maxVisibleGapPx, 1)} px`)} | ${lower(result.scroll.maxScrollCorrectionPx, other.scroll.maxScrollCorrectionPx, `${fixed(result.scroll.maxScrollCorrectionPx, 1)} px`)} |`,
    );
  }

  lines.push(
    "",
    "## Large mixed document actions",
    "",
    "Mean synchronous duration after scrolling the target into view and allowing the viewport to settle. Lower is better.",
    "",
    "| Position | Action | Typodown | Muya |",
    "| --- | --- | ---: | ---: |",
  );
  for (const position of ["start", "middle", "end"]) {
    for (const action of ["show-markers", "render", "edit-paragraph", "edit-code"]) {
      const typodown = largeTypodown.actions[position][action].scriptMeanMs;
      const muya = largeMuya.actions[position][action].scriptMeanMs;
      lines.push(
        `| ${position} | ${action} | ${lower(typodown, muya, `${fixed(typodown)} ms`)} | ${lower(muya, typodown, `${fixed(muya)} ms`)} |`,
      );
    }
  }

  lines.push(
    "",
    "## Methodology",
    "",
    "- Both editors receive the same generated Markdown content in the same Chromium page and viewport.",
    "- The mixed fixture includes headings, emphasis, links, inline code and math, lists, tasks, blockquotes, tables, HTML, and fenced code cycling through 20 languages.",
    "- Action time measures synchronous editor work. Paint time and p95 values remain available in `results.json`.",
    "- Large-document targets are positioned at the start, middle, and end. Before timing, each action is scrolled into view and its caret is placed in the state that action requires.",
    "- The scrolling test is separate from action timing and records blank virtual-viewport gaps, settling frames, and scroll correction.",
    "- JavaScript heap is measured after forced garbage collection. It is not peak process RSS.",
    "- Results depend on hardware, browser version, thermal state, and other system load. Compare runs made in similar environments.",
    "",
    "## Reproduce",
    "",
    "```sh",
    "vp run benchmark",
    "```",
    "",
    "The command regenerates this report and `results.json`.",
    "",
  );
  return lines.join("\n");
}
