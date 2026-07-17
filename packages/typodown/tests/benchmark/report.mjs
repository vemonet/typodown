function fixed(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function ratio(smaller, larger) {
  if (!smaller || !larger) return "n/a";
  return `${fixed(larger / smaller, 1)}x`;
}

function engineResult(results, engine) {
  const result = results.find((entry) => entry.engine === engine);
  if (!result) throw new Error(`Missing ${engine} benchmark result`);
  return result;
}

export function renderMarkdownReport(report) {
  const generated = new Date(report.generatedAt).toISOString();
  const lines = [
    "# Typodown vs Muya benchmark",
    "",
    `Generated: ${generated}`,
    "",
    "## Summary",
    "",
  ];

  const largeTypodown = engineResult(report.largeResults, "typodown");
  const largeMuya = engineResult(report.largeResults, "muya");
  lines.push(
    `The large mixed document contains ${largeTypodown.sections.toLocaleString("en-US")} sections. Typodown used ${largeTypodown.resources.domNodes.toLocaleString("en-US")} DOM nodes versus ${largeMuya.resources.domNodes.toLocaleString("en-US")} for Muya (${ratio(largeTypodown.resources.domNodes, largeMuya.resources.domNodes)} fewer), and ${fixed(largeTypodown.resources.jsHeapMiB, 1)} MiB retained JavaScript heap versus ${fixed(largeMuya.resources.jsHeapMiB, 1)} MiB.`,
    "",
    `Across the measured large-document action batch, Typodown used ${fixed(largeTypodown.resources.taskMs, 1)} ms of Chromium task time versus ${fixed(largeMuya.resources.taskMs, 1)} ms for Muya (${ratio(largeTypodown.resources.taskMs, largeMuya.resources.taskMs)} less).`,
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
    "",
    "## Marker transition scaling",
    "",
    "Mean synchronous duration. Lower is better.",
    "",
    "| Paragraphs | Engine | Show markers | Render | Task time | Heap | DOM nodes |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of report.results) {
    lines.push(
      `| ${result.paragraphs} | ${result.engine} | ${fixed(result.showMarkers.scriptMeanMs)} ms | ${fixed(result.render.scriptMeanMs)} ms | ${fixed(result.resources.taskMs, 1)} ms | ${fixed(result.resources.jsHeapMiB, 1)} MiB | ${result.resources.domNodes.toLocaleString("en-US")} |`,
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
    lines.push(
      `| ${result.engine} | ${fixed(result.setupMs, 1)} ms | ${fixed(result.resources.taskMs, 1)} ms | ${fixed(result.resources.layoutMs, 1)} ms | ${fixed(result.resources.styleMs, 1)} ms | ${fixed(result.resources.jsHeapMiB, 1)} MiB | ${result.resources.domNodes.toLocaleString("en-US")} |`,
    );
  }

  lines.push(
    "",
    "## Large mixed document actions",
    "",
    "Mean synchronous duration after scrolling the target into view and allowing the viewport to settle. Lower is better.",
    "",
    "| Position | Action | Typodown | Muya | Faster |",
    "| --- | --- | ---: | ---: | --- |",
  );
  for (const position of ["start", "middle", "end"]) {
    for (const action of ["show-markers", "render", "edit-paragraph", "edit-code"]) {
      const typodown = largeTypodown.actions[position][action].scriptMeanMs;
      const muya = largeMuya.actions[position][action].scriptMeanMs;
      const winner = typodown < muya ? "Typodown" : muya < typodown ? "Muya" : "Tie";
      lines.push(
        `| ${position} | ${action} | ${fixed(typodown)} ms | ${fixed(muya)} ms | ${winner} |`,
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
    "- Large-document targets are positioned at the start, middle, and end. Each target is scrolled into view before its action group.",
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
