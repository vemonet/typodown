import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { RefreshCw } from "lucide-solid";
import { Button } from "@/components/ui/button";
import { vault, openFile, showEditor } from "@/lib/vault";
import { loadGraphData, type GraphData, type GraphNode } from "@/lib/graph";

/** Max rows per legend column; longer legends flow into extra columns. */
const LEGEND_ROWS = 5;

// Categorical palette for node colouring by OKF `type`. Chosen to stay legible
// on both light and dark backgrounds and to avoid the "untyped" file blue.
const TYPE_PALETTE = [
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#eab308", // yellow
  "#a855f7", // purple
  "#22c55e", // green
];

/** Deterministic type -> colour map for the graph's real (non-ghost) nodes. */
function typeColorMap(nodes: GraphNode[]): Map<string, string> {
  const types = [...new Set(nodes.filter((n) => !n.missing && n.type).map((n) => n.type!))].sort();
  return new Map(types.map((t, i) => [t, TYPE_PALETTE[i % TYPE_PALETTE.length]!]));
}

/** Hovered node plus the cursor position (container-relative) and which way to
 * flip the panel so it stays on screen near the edges. */
interface HoverState {
  node: GraphNode;
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
}

/** Link graph of the open folder rendered with sigma.js. Files are nodes,
 * relative markdown links are edges; clicking a real node opens that file in
 * the editor. Unresolved links show as dimmed "ghost" nodes. */
const GraphView: Component<{ theme: "light" | "dark" }> = (props) => {
  let container!: HTMLDivElement;
  let sigma: Sigma | undefined;
  const [status, setStatus] = createSignal<"loading" | "empty" | "ready">("loading");
  const [count, setCount] = createSignal({ nodes: 0, edges: 0 });
  const [data, setData] = createSignal<GraphData | null>(null);
  const [hover, setHover] = createSignal<HoverState | null>(null);
  // Node lookup for hover, and the last cursor position over the canvas.
  let nodeIndex = new Map<string, GraphNode>();
  let mouse = { x: 0, y: 0, flipX: false, flipY: false };

  const handleMove = (e: MouseEvent): void => {
    const r = container.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    mouse = { x, y, flipX: x > r.width * 0.6, flipY: y > r.height * 0.6 };
    setHover((h) => (h ? { ...h, ...mouse } : h));
  };

  const palette = () =>
    props.theme === "dark"
      ? { file: "#6ea8fe", missing: "#6b7280", edge: "#3d444d", label: "#e6edf3" }
      : { file: "#0969da", missing: "#9aa4b2", edge: "#d1d9e0", label: "#1f2328" };

  async function build(): Promise<void> {
    const root = vault.vaultRoot();
    if (!root) {
      setData(null);
      setStatus("empty");
      return;
    }
    setStatus("loading");
    try {
      setData(await loadGraphData(root, vault.tree()));
    } catch {
      setData(null);
      setStatus("empty");
    }
  }

  function renderGraph(gd: GraphData): void {
    sigma?.kill();
    sigma = undefined;
    if (gd.nodes.length === 0) {
      setStatus("empty");
      return;
    }
    const pal = palette();
    const typeColors = typeColorMap(gd.nodes);
    const degree = new Map<string, number>();
    for (const e of gd.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    nodeIndex = new Map(gd.nodes.map((nd) => [nd.id, nd]));
    const g = new Graph();
    const n = gd.nodes.length;
    gd.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n;
      const deg = degree.get(node.id) ?? 0;
      g.addNode(node.id, {
        label: node.label,
        x: Math.cos(angle),
        y: Math.sin(angle),
        size: Math.max(4, Math.min(16, 4 + deg * 1.6)),
        color: node.missing
          ? pal.missing
          : node.type
            ? (typeColors.get(node.type) ?? pal.file)
            : pal.file,
        path: node.path,
        missing: node.missing,
      });
    });
    for (const e of gd.edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
        g.addEdge(e.source, e.target, { size: 2.5, color: pal.edge, type: "arrow" });
      }
    }
    // Spread the circular seed into clusters. FA2 needs >1 node with positions.
    if (n > 2) {
      try {
        forceAtlas2.assign(g, {
          iterations: 300,
          settings: { ...forceAtlas2.inferSettings(g), scalingRatio: 12, gravity: 1.2 },
        });
      } catch {
        // Keep the circular seed layout if FA2 is unhappy with the graph.
      }
    }
    setCount({ nodes: g.order, edges: g.size });
    sigma = new Sigma(g, container, {
      labelColor: { color: pal.label },
      defaultEdgeColor: pal.edge,
      defaultEdgeType: "arrow", // draw a direction arrowhead at the target end
      labelRenderedSizeThreshold: 0,
      labelFont: "Inter Variable, system-ui, sans-serif",
    });
    sigma.on("clickNode", ({ node }) => {
      const attrs = g.getNodeAttributes(node) as { path: string | null; missing: boolean };
      if (attrs.missing || !attrs.path) return;
      void openFile(attrs.path);
      showEditor();
    });
    sigma.on("enterNode", ({ node }) => {
      container.style.cursor = "pointer";
      const gn = nodeIndex.get(node);
      if (gn) setHover({ node: gn, ...mouse });
    });
    sigma.on("leaveNode", () => {
      container.style.cursor = "default";
      setHover(null);
    });
    setStatus("ready");
  }

  // Legend entries: one per type present, plus untyped / missing when relevant.
  const legend = createMemo<{ label: string; color: string }[]>(() => {
    const gd = data();
    if (!gd) return [];
    const pal = palette();
    const entries = [...typeColorMap(gd.nodes)].map(([label, color]) => ({ label, color }));
    if (gd.nodes.some((n) => !n.missing && !n.type))
      entries.push({ label: "Untyped", color: pal.file });
    if (gd.nodes.some((n) => n.missing)) entries.push({ label: "Missing", color: pal.missing });
    return entries;
  });
  // Legend entries split into columns of LEGEND_ROWS.
  const legendColumns = createMemo(() => {
    const entries = legend();
    const columns: (typeof entries)[] = [];
    for (let i = 0; i < entries.length; i += LEGEND_ROWS) {
      columns.push(entries.slice(i, i + LEGEND_ROWS));
    }
    return columns;
  });
  // Hide the legend when there's nothing meaningful to distinguish (all untyped,
  // no missing nodes).
  const showLegend = createMemo(() => {
    const gd = data();
    if (!gd || status() !== "ready") return false;
    return gd.nodes.some((n) => (!n.missing && n.type) || n.missing);
  });

  // Rebuild when the folder changes (runs once immediately on mount too).
  createEffect(
    on(
      () => vault.vaultRoot(),
      () => void build(),
    ),
  );
  // (Re)render whenever the data or theme changes.
  createEffect(() => {
    const gd = data();
    palette(); // track theme so colours refresh on light/dark switch
    if (gd) renderGraph(gd);
  });
  onCleanup(() => sigma?.kill());

  return (
    <div class="relative h-full w-full">
      <div
        ref={container}
        class="h-full w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      />

      <Show when={hover()}>
        {(h) => (
          <div
            class="pointer-events-none absolute z-30 max-w-[16rem] rounded-md border border-border/50 bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-md backdrop-blur-sm"
            style={{
              left: `${h().x}px`,
              top: `${h().y}px`,
              transform: `translate(${h().flipX ? "calc(-100% - 12px)" : "12px"}, ${
                h().flipY ? "calc(-100% - 12px)" : "12px"
              })`,
            }}
          >
            <div class="mb-1 break-all font-medium">{h().node.label}</div>
            <Show
              when={!h().node.missing}
              fallback={<div class="italic text-muted-foreground">Missing file</div>}
            >
              <Show
                when={(h().node.meta?.length ?? 0) > 0}
                fallback={<div class="italic text-muted-foreground">No front matter</div>}
              >
                <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                  <For each={h().node.meta ?? []}>
                    {(m) => (
                      <>
                        <dt class="text-muted-foreground">{m.key}</dt>
                        <dd class="break-words">{m.value}</dd>
                      </>
                    )}
                  </For>
                </dl>
              </Show>
            </Show>
          </div>
        )}
      </Show>

      <div class="absolute right-3 top-3 flex items-center gap-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
        <Show when={status() === "ready"}>
          <span>
            {count().nodes} nodes · {count().edges} links
          </span>
        </Show>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Rebuild graph"
          title="Rebuild graph"
          onClick={() => void build()}
        >
          <RefreshCw class="size-3.5" />
        </Button>
      </div>

      <Show when={showLegend()}>
        {/* Explicit columns of at most LEGEND_ROWS entries each, so a long
         * legend grows sideways instead of overflowing the page bottom. */}
        <div
          class="absolute bottom-9 left-3 flex items-end gap-x-4 overflow-x-auto rounded-md border border-border/50 bg-background/60 px-2.5 py-2 text-xs shadow-sm backdrop-blur-sm"
          style={{ "max-width": "calc(100% - 1.5rem)" }}
        >
          <For each={legendColumns()}>
            {(column) => (
              <div class="flex flex-col gap-y-1">
                <For each={column}>
                  {(entry) => (
                    <div class="flex items-center gap-2">
                      <span
                        class="size-2.5 shrink-0 rounded-full"
                        style={{ "background-color": entry.color }}
                      />
                      <span class="whitespace-nowrap text-muted-foreground">{entry.label}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={status() === "loading"}>
        <Overlay>Building graph...</Overlay>
      </Show>
      <Show when={status() === "empty"}>
        <Overlay>
          {vault.vaultRoot() ? "No markdown links found in this folder." : "Open a folder first."}
        </Overlay>
      </Show>
    </div>
  );
};

const Overlay: Component<{ children: unknown }> = (props) => (
  <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
    <span class="rounded-md bg-background/80 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur-sm">
      {props.children as never}
    </span>
  </div>
);

export default GraphView;
