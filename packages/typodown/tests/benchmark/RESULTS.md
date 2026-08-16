# Typodown vs Muya benchmark

Generated: 2026-08-16T11:28:40.470Z

## Summary

The large mixed document contains 1,000 sections. Typodown used 628 DOM nodes versus 139,622 for Muya (222.3x fewer), and 28.7 MiB retained JavaScript heap versus 39.3 MiB.

Across the measured large-document action batch, Typodown used 3247.2 ms of Chromium task time versus 7755.2 ms for Muya (2.4x less).

## Environment

| Property                | Value        |
| ----------------------- | ------------ |
| Platform                | darwin-arm64 |
| Node                    | v24.19.0     |
| Chromium                | 137.0.7105.0 |
| Toggle iterations       | 20           |
| Warmup iterations       | 5            |
| Large sections          | 1000         |
| Large action iterations | 5            |
| Scroll steps            | 20           |

## Marker transition scaling

Mean synchronous duration. Lower is better.

| Paragraphs | Engine   | Show markers |  Render | Task time |     Heap | DOM nodes |
| ---------: | -------- | -----------: | ------: | --------: | -------: | --------: |
|         10 | typodown |      0.89 ms | 0.94 ms |   52.4 ms |  9.6 MiB |       190 |
|         10 | muya     |      1.02 ms | 1.02 ms |   58.2 ms | 10.2 MiB |        82 |
|        100 | typodown |      1.49 ms | 1.52 ms |   77.5 ms | 10.6 MiB |       389 |
|        100 | muya     |      0.84 ms | 0.98 ms |   75.0 ms | 10.5 MiB |       802 |
|        500 | typodown |      1.34 ms | 1.45 ms |   76.4 ms | 11.3 MiB |       389 |
|        500 | muya     |      1.16 ms | 1.17 ms |  106.7 ms | 11.0 MiB |     4,002 |

## Large mixed document resources

| Engine   |       Setup | Task time |   Layout |   Style |     Heap | DOM nodes |
| -------- | ----------: | --------: | -------: | ------: | -------: | --------: |
| typodown |    391.5 ms | 3247.2 ms |  35.1 ms | 59.5 ms | 28.7 MiB |       628 |
| muya     | 119550.8 ms | 7755.2 ms | 565.5 ms | 16.6 ms | 39.3 MiB |   139,622 |

## `test.md` scrolling

The repository torture fixture is measured separately because its awkward nesting and fences reproduce the reported VS Code scenario.

| Engine   |         Size | Mean settle | P95 settle | P95 frames | Max visible gap | Max scroll correction |
| -------- | -----------: | ----------: | ---------: | ---------: | --------------: | --------------------: |
| typodown | 20,012 bytes |    17.51 ms |   28.50 ms |          3 |          0.0 px |               51.0 px |
| muya     | 20,012 bytes |    16.82 ms |   27.60 ms |          2 |          0.0 px |                0.3 px |

## Large document scrolling

Programmatic jumps from the top to the bottom of the document. Settle time includes animation frames until the scroll offset is stable and no CodeMirror spacer intersects the viewport.

| Engine   | Mean settle | P95 settle | P95 frames | Max visible gap | Max scroll correction |
| -------- | ----------: | ---------: | ---------: | --------------: | --------------------: |
| typodown |    17.09 ms |   25.20 ms |          3 |          0.0 px |               37.3 px |
| muya     |    25.24 ms |   28.50 ms |          2 |          0.0 px |                0.3 px |

## Large mixed document actions

Mean synchronous duration after scrolling the target into view and allowing the viewport to settle. Lower is better.

| Position | Action         |  Typodown |     Muya | Faster   |
| -------- | -------------- | --------: | -------: | -------- |
| start    | show-markers   |   2.08 ms | 16.02 ms | Typodown |
| start    | render         |   1.90 ms | 15.88 ms | Typodown |
| start    | edit-paragraph |   4.80 ms | 19.22 ms | Typodown |
| start    | edit-code      | 159.92 ms | 13.20 ms | Muya     |
| middle   | show-markers   |   2.34 ms | 16.26 ms | Typodown |
| middle   | render         |   2.08 ms | 20.62 ms | Typodown |
| middle   | edit-paragraph |   5.08 ms | 38.12 ms | Typodown |
| middle   | edit-code      | 165.56 ms | 32.14 ms | Muya     |
| end      | show-markers   |   2.28 ms | 16.34 ms | Typodown |
| end      | render         |   2.10 ms | 16.10 ms | Typodown |
| end      | edit-paragraph |   5.04 ms | 58.64 ms | Typodown |
| end      | edit-code      | 162.72 ms | 56.32 ms | Muya     |

## Methodology

- Both editors receive the same generated Markdown content in the same Chromium page and viewport.
- The mixed fixture includes headings, emphasis, links, inline code and math, lists, tasks, blockquotes, tables, HTML, and fenced code cycling through 20 languages.
- Action time measures synchronous editor work. Paint time and p95 values remain available in `results.json`.
- Large-document targets are positioned at the start, middle, and end. Each target is scrolled into view before its action group.
- The scrolling test is separate from action timing and records blank virtual-viewport gaps, settling frames, and scroll correction.
- JavaScript heap is measured after forced garbage collection. It is not peak process RSS.
- Results depend on hardware, browser version, thermal state, and other system load. Compare runs made in similar environments.

## Reproduce

```sh
vp run benchmark
```

The command regenerates this report and `results.json`.
