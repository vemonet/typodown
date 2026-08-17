# Typodown benchmark

Generated: 2026-08-16T21:35:41.847Z

## Summary

The large mixed document contains 1,000 sections. Typodown used 702 DOM nodes versus 139,622 for Muya (198.9x fewer), and 28.0 MiB retained JavaScript heap versus 39.4 MiB.

Across the measured large-document action batch, Typodown used 10759.0 ms of Chromium task time versus 17318.7 ms for Muya (1.6x less).

## Environment

| Property                | Value        |
| ----------------------- | ------------ |
| Platform                | darwin-arm64 |
| Node                    | v24.19.0     |
| Chromium                | 137.0.7105.0 |
| Toggle iterations       | 40           |
| Warmup iterations       | 8            |
| Large sections          | 1000         |
| Large action iterations | 10           |
| Scroll steps            | 20           |

## Marker transition scaling

Mean synchronous duration. Lower is better.

| Paragraphs | Engine   | Show markers |      Render |    Task time |         Heap | DOM nodes |
| ---------: | -------- | -----------: | ----------: | -----------: | -----------: | --------: |
|         10 | typodown |  **1.19 ms** | **1.20 ms** |     136.4 ms |  **9.7 MiB** |       193 |
|         10 | muya     |      1.32 ms |     1.38 ms | **109.7 ms** |     10.4 MiB |    **82** |
|        100 | typodown |  **1.44 ms** | **1.37 ms** | **154.1 ms** |     10.8 MiB |   **392** |
|        100 | muya     |      1.53 ms |     1.39 ms |     182.5 ms | **10.6 MiB** |       802 |
|        500 | typodown |      1.25 ms |     1.33 ms | **150.0 ms** |     11.4 MiB |   **392** |
|        500 | muya     |  **1.18 ms** | **1.07 ms** |     207.9 ms | **11.1 MiB** |     4,002 |

## Large mixed document resources

| Engine   |        Setup |      Task time |      Layout |       Style |         Heap | DOM nodes |
| -------- | -----------: | -------------: | ----------: | ----------: | -----------: | --------: |
| typodown | **394.0 ms** | **10759.0 ms** | **71.9 ms** |    109.7 ms | **28.0 MiB** |   **702** |
| muya     |  112786.7 ms |     17318.7 ms |   1070.2 ms | **30.7 ms** |     39.4 MiB |   139,622 |

## `test.md` scrolling

The repository torture fixture is measured separately.

| Engine   |         Size |  Mean settle |   P95 settle | P95 frames | Max visible gap | Max scroll correction |
| -------- | -----------: | -----------: | -----------: | ---------: | --------------: | --------------------: |
| typodown | 19,998 bytes |     17.07 ms | **24.80 ms** |          3 |      **0.0 px** |               51.0 px |
| muya     | 19,998 bytes | **16.61 ms** |     26.20 ms |      **2** |      **0.0 px** |            **0.3 px** |

## Large document scrolling

Programmatic jumps from the top to the bottom of the document. Settle time includes animation frames until the scroll offset is stable and no CodeMirror spacer intersects the viewport.

| Engine   |  Mean settle |   P95 settle | P95 frames | Max visible gap | Max scroll correction |
| -------- | -----------: | -----------: | ---------: | --------------: | --------------------: |
| typodown | **18.33 ms** | **25.10 ms** |          3 |      **0.0 px** |                9.5 px |
| muya     |     24.87 ms |     25.80 ms |      **2** |      **0.0 px** |            **0.3 px** |

## Large mixed document actions

Mean synchronous duration after scrolling the target into view and allowing the viewport to settle. Lower is better.

| Position | Action         |    Typodown |        Muya |
| -------- | -------------- | ----------: | ----------: |
| start    | show-markers   | **1.90 ms** |    15.05 ms |
| start    | render         | **1.60 ms** |    16.13 ms |
| start    | edit-paragraph |     4.43 ms | **1.69 ms** |
| start    | edit-code      | **3.91 ms** |     5.65 ms |
| middle   | show-markers   | **2.17 ms** |    15.01 ms |
| middle   | render         | **1.71 ms** |    15.57 ms |
| middle   | edit-paragraph | **4.57 ms** |    19.83 ms |
| middle   | edit-code      | **3.69 ms** |    22.83 ms |
| end      | show-markers   | **2.16 ms** |    15.15 ms |
| end      | render         | **1.62 ms** |    15.08 ms |
| end      | edit-paragraph | **4.47 ms** |    35.91 ms |
| end      | edit-code      | **3.58 ms** |    40.40 ms |

## Methodology

- Both editors receive the same generated Markdown content in the same Chromium page and viewport.
- The mixed fixture includes headings, emphasis, links, inline code and math, lists, tasks, blockquotes, tables, HTML, and fenced code cycling through 20 languages.
- Action time measures synchronous editor work. Paint time and p95 values remain available in `results.json`.
- Large-document targets are positioned at the start, middle, and end. Before timing, each action is scrolled into view and its caret is placed in the state that action requires.
- The scrolling test is separate from action timing and records blank virtual-viewport gaps, settling frames, and scroll correction.
- JavaScript heap is measured after forced garbage collection. It is not peak process RSS.
- Results depend on hardware, browser version, thermal state, and other system load. Compare runs made in similar environments.

## Reproduce

```sh
vp run benchmark
```

The command regenerates this report and `results.json`.
