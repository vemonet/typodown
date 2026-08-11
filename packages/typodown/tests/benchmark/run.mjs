/* eslint-disable no-console -- This CLI prints benchmark tables and report paths. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite-plus";
import { renderMarkdownReport } from "./report.mjs";

const host = "127.0.0.1";
const benchmarkDir = fileURLToPath(new URL(".", import.meta.url));
const outputDir = process.env.BENCH_OUTPUT_DIR ?? benchmarkDir;
const chromiumPath = process.env.CHROMIUM_PATH ?? "/opt/homebrew/bin/chromium";
const sizes = [10, 100, 500];
const iterations = Number(process.env.BENCH_ITERATIONS ?? 40);
const warmup = Number(process.env.BENCH_WARMUP ?? 8);
const largeSections = Number(process.env.BENCH_LARGE_SECTIONS ?? 1000);
const largeIterations = Number(process.env.BENCH_LARGE_ITERATIONS ?? 10);

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summarize(samples, transition) {
  const matching = samples.filter((sample) => sample.transition === transition);
  return {
    scriptMeanMs: average(matching.map((sample) => sample.scriptMs)),
    scriptP95Ms: percentile(
      matching.map((sample) => sample.scriptMs),
      0.95,
    ),
    paintMeanMs: average(matching.map((sample) => sample.paintMs)),
    paintP95Ms: percentile(
      matching.map((sample) => sample.paintMs),
      0.95,
    ),
    mutationsMean: average(matching.map((sample) => sample.mutations)),
  };
}

function summarizeActions(samples) {
  const summaries = {};
  for (const position of ["start", "middle", "end"]) {
    summaries[position] = {};
    for (const action of ["show-markers", "render", "edit-paragraph", "edit-code"]) {
      const matching = samples.filter(
        (sample) => sample.position === position && sample.action === action,
      );
      summaries[position][action] = {
        scriptMeanMs: average(matching.map((sample) => sample.scriptMs)),
        scriptP95Ms: percentile(
          matching.map((sample) => sample.scriptMs),
          0.95,
        ),
        paintMeanMs: average(matching.map((sample) => sample.paintMs)),
        paintP95Ms: percentile(
          matching.map((sample) => sample.paintMs),
          0.95,
        ),
        mutationsMean: average(matching.map((sample) => sample.mutations)),
      };
    }
  }
  return summaries;
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

const server = await createServer({
  configFile: fileURLToPath(new URL("vite.config.ts", import.meta.url)),
  server: { host, port: 0 },
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not provide a local benchmark URL");
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(url);
  await page.waitForFunction(() => "toggleBenchmark" in window);

  const results = [];
  for (const paragraphs of sizes) {
    for (const engine of ["typodown", "muya"]) {
      await page.evaluate(
        async ({ engine: selectedEngine, paragraphs: count }) => {
          await window.toggleBenchmark.setup(selectedEngine, count);
        },
        { engine, paragraphs },
      );
      await cdp.send("HeapProfiler.collectGarbage");
      const before = metricMap((await cdp.send("Performance.getMetrics")).metrics);
      const samples = await page.evaluate(
        async ({ iterations: count, warmup: warmupCount }) =>
          window.toggleBenchmark.run(count, warmupCount),
        { iterations, warmup },
      );
      await cdp.send("HeapProfiler.collectGarbage");
      const after = metricMap((await cdp.send("Performance.getMetrics")).metrics);
      const stats = await page.evaluate(() => window.toggleBenchmark.stats());

      results.push({
        engine,
        paragraphs,
        iterations,
        showMarkers: summarize(samples, "show-markers"),
        render: summarize(samples, "render"),
        resources: {
          jsHeapMiB: after.JSHeapUsedSize / 1024 / 1024,
          domNodes: stats.domNodes,
          taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
          styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
        },
      });
    }
  }

  const largeResults = [];
  for (const engine of ["typodown", "muya"]) {
    const setupStarted = performance.now();
    await page.evaluate(
      async ({ engine: selectedEngine, sections }) => {
        await window.toggleBenchmark.setupLarge(selectedEngine, sections);
      },
      { engine, sections: largeSections },
    );
    const setupMs = performance.now() - setupStarted;
    await cdp.send("HeapProfiler.collectGarbage");
    const before = metricMap((await cdp.send("Performance.getMetrics")).metrics);
    const samples = await page.evaluate(
      async ({ iterations: count, warmup: warmupCount }) =>
        window.toggleBenchmark.runLarge(count, warmupCount),
      { iterations: largeIterations, warmup },
    );
    await cdp.send("HeapProfiler.collectGarbage");
    const after = metricMap((await cdp.send("Performance.getMetrics")).metrics);
    const stats = await page.evaluate(() => window.toggleBenchmark.stats());
    largeResults.push({
      engine,
      sections: largeSections,
      setupMs,
      actions: summarizeActions(samples),
      resources: {
        jsHeapMiB: after.JSHeapUsedSize / 1024 / 1024,
        domNodes: stats.domNodes,
        textLength: stats.textLength,
        taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
        layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
        styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      },
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      chromiumPath,
      chromiumVersion: browser.version(),
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      iterations,
      warmup,
      largeSections,
      largeIterations,
    },
    results,
    largeResults,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(outputDir, "RESULTS.md"), renderMarkdownReport(report));
  console.table(
    results.map((result) => ({
      engine: result.engine,
      paragraphs: result.paragraphs,
      "show script ms": result.showMarkers.scriptMeanMs.toFixed(2),
      "render script ms": result.render.scriptMeanMs.toFixed(2),
      "show paint ms": result.showMarkers.paintMeanMs.toFixed(2),
      "render paint ms": result.render.paintMeanMs.toFixed(2),
      "heap MiB": result.resources.jsHeapMiB.toFixed(1),
      "DOM nodes": result.resources.domNodes,
      "task ms": result.resources.taskMs.toFixed(1),
    })),
  );
  console.log(`\nLarge mixed document (${largeSections} sections):`);
  console.table(
    largeResults.flatMap((result) =>
      Object.entries(result.actions).map(([position, actions]) => ({
        engine: result.engine,
        position,
        "show ms": actions["show-markers"].scriptMeanMs.toFixed(2),
        "render ms": actions.render.scriptMeanMs.toFixed(2),
        "paragraph edit ms": actions["edit-paragraph"].scriptMeanMs.toFixed(2),
        "code edit ms": actions["edit-code"].scriptMeanMs.toFixed(2),
        "setup ms": result.setupMs.toFixed(0),
        "heap MiB": result.resources.jsHeapMiB.toFixed(1),
        "DOM nodes": result.resources.domNodes,
      })),
    ),
  );
  console.log(`Reports: ${resolve(outputDir, "RESULTS.md")} and results.json`);
} finally {
  await browser?.close();
  await server.close();
}
