# Typodown vs Muya benchmark

Generated: 2026-07-17T11:27:24.280Z

## Summary

The large mixed document contains 1,000 sections. Typodown used 607 DOM nodes versus 139,622 for Muya (230.0x fewer), and 23.9 MiB retained JavaScript heap versus 39.0 MiB.

Across the measured large-document action batch, Typodown used 9312.7 ms of Chromium task time versus 14269.0 ms for Muya (1.5x less).

## Environment

| Property                | Value        |
| ----------------------- | ------------ |
| Platform                | darwin-arm64 |
| Node                    | v24.18.0     |
| Chromium                | 137.0.7105.0 |
| Toggle iterations       | 40           |
| Warmup iterations       | 8            |
| Large sections          | 1000         |
| Large action iterations | 10           |

## Marker transition scaling

Mean synchronous duration. Lower is better.

| Paragraphs | Engine   | Show markers |  Render | Task time |     Heap | DOM nodes |
| ---------: | -------- | -----------: | ------: | --------: | -------: | --------: |
|         10 | typodown |      1.75 ms | 1.61 ms |  161.0 ms |  8.8 MiB |       182 |
|         10 | muya     |      0.84 ms | 0.85 ms |   85.8 ms |  9.5 MiB |        82 |
|        100 | typodown |      2.61 ms | 2.52 ms |  242.2 ms |  9.8 MiB |       343 |
|        100 | muya     |      2.18 ms | 2.13 ms |  280.8 ms |  9.7 MiB |       802 |
|        500 | typodown |      2.88 ms | 2.94 ms |  270.7 ms | 10.3 MiB |       353 |
|        500 | muya     |      2.74 ms | 2.87 ms |  431.0 ms | 10.2 MiB |     4,002 |

## Large mixed document resources

| Engine   |       Setup |  Task time |    Layout |   Style |     Heap | DOM nodes |
| -------- | ----------: | ---------: | --------: | ------: | -------: | --------: |
| typodown |     59.9 ms |  9312.7 ms |   73.2 ms | 87.2 ms | 23.9 MiB |       607 |
| muya     | 112993.3 ms | 14269.0 ms | 1029.4 ms | 27.2 ms | 39.0 MiB |   139,622 |

## Large mixed document actions

Mean synchronous duration after scrolling the target into view and allowing the viewport to settle. Lower is better.

| Position | Action         |  Typodown |     Muya | Faster   |
| -------- | -------------- | --------: | -------: | -------- |
| start    | show-markers   |   1.05 ms | 16.11 ms | Typodown |
| start    | render         |   1.19 ms | 16.08 ms | Typodown |
| start    | edit-paragraph | 134.63 ms | 17.72 ms | Muya     |
| start    | edit-code      | 121.66 ms | 10.69 ms | Muya     |
| middle   | show-markers   |   1.21 ms | 16.02 ms | Typodown |
| middle   | render         |   1.30 ms | 16.11 ms | Typodown |
| middle   | edit-paragraph | 132.12 ms | 36.56 ms | Muya     |
| middle   | edit-code      | 121.97 ms | 30.49 ms | Muya     |
| end      | show-markers   |   1.04 ms | 17.04 ms | Typodown |
| end      | render         |   1.10 ms | 16.31 ms | Typodown |
| end      | edit-paragraph | 138.11 ms | 56.22 ms | Muya     |
| end      | edit-code      | 125.34 ms | 49.93 ms | Muya     |

## Methodology

- Both editors receive the same generated Markdown content in the same Chromium page and viewport.
- The mixed fixture includes headings, emphasis, links, inline code and math, lists, tasks, blockquotes, tables, HTML, and fenced code cycling through 20 languages.
- Action time measures synchronous editor work. Paint time and p95 values remain available in `results.json`.
- Large-document targets are positioned at the start, middle, and end. Each target is scrolled into view before its action group.
- JavaScript heap is measured after forced garbage collection. It is not peak process RSS.
- Results depend on hardware, browser version, thermal state, and other system load. Compare runs made in similar environments.

## Reproduce

```sh
vp run benchmark
```

The command regenerates this report and `results.json`.
