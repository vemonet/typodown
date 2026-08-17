# Typodown vs Muya marker toggle benchmark

This browser benchmark compares the live-preview transition shared by Typodown and Muya:

- `show-markers`: move the caret from adjacent plain text into a bold construct.
- `render`: move it back out so the raw `**` markers are hidden again.

Each sample records synchronous editor work and time through the next two animation frames. Chromium's DevTools protocol supplies JavaScript heap, DOM node, task, layout, and style-recalculation metrics for the whole measured batch.

The same run also builds a 1,000-section mixed document containing headings, emphasis, links, inline code and math, lists, tasks, blockquotes, tables, HTML, and fenced code cycling through 20 languages. It measures marker reveal/render, paragraph edits, and code-block edits independently at the start, middle, and end of the file. Before each group, the target is scrolled into view and allowed to settle; viewport navigation is not included in the individual action duration.

A separate scrolling pass jumps through that large document from top to bottom. It reports settling time and frames, visible CodeMirror spacer gaps, and scroll-position correction after layout measurement. This covers the blank viewport and scroll-jump behavior that the action timings intentionally exclude.

The same scrolling pass runs against the `tests/test.md` torture fixture, which covers the VS Code reproduction case directly.

## Run

```sh
vp run benchmark
```

The default executable is `/opt/homebrew/bin/chromium`. Override it and the sample counts when needed:

```sh
CHROMIUM_PATH=/path/to/chromium BENCH_ITERATIONS=100 BENCH_WARMUP=20 vp run benchmark
```

The large workload can be scaled separately with `BENCH_LARGE_SECTIONS`, `BENCH_LARGE_ITERATIONS`, and `BENCH_SCROLL_STEPS`.
Set `BENCH_OUTPUT_DIR` to write the generated reports somewhere other than this directory.

The console prints a compact table. Every run generates two committable reports:

- [`RESULTS.md`](RESULTS.md): formatted summary tables and methodology for sharing.
- [`results.json`](results.json): full means, p95 values, mutation counts, resources, and environment metadata.

Run the benchmark on an otherwise idle machine and compare results from the same browser and hardware. Paint measurements include frame scheduling, so they are expected to cluster near the display's frame interval. Heap figures are retained heap after forced garbage collection, not peak process RSS.
