import type { ScoreHistoryPoint } from "@/lib/queries";

/**
 * Renders a trader's Sirtio Score over the last 30 days as a simple
 * SVG line chart. Server-rendered, no client JS and no charting
 * library -- this is one line on one page, not worth the bundle cost
 * of recharts/d3 for. Built directly on trader_sirtio_scores' new
 * one-row-per-run history (see queries.ts getTraderScoreHistory and
 * the 2026-08-17 snapshot-history fix that made this data possible).
 *
 * Score values are exposed only via native <title> hover tooltips on
 * each point (no JS needed for that), while the x-axis carries dates
 * so the two aren't crammed next to each other.
 */
export default function ScoreHistoryChart({ points }: { points: ScoreHistoryPoint[] }) {
  const scored = points.filter(
    (p): p is { computed_at: string; sirtio_score: number } => p.sirtio_score !== null
  );
  if (scored.length < 2) return null;

  const width = 640;
  const height = 160;
  const padX = 8;
  const padY = 16;

  const scores = scored.map((p) => p.sirtio_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  // Keep a minimum visible range so a nearly-flat line (e.g. 99.7 to
  // 99.8) doesn't get stretched into a misleadingly dramatic zigzag.
  const range = Math.max(max - min, 5);
  const rangeMin = max - range < 0 ? 0 : min - (range - (max - min)) / 2;

  const stepX = (width - padX * 2) / (scored.length - 1);
  const toX = (i: number) => padX + i * stepX;
  const toY = (score: number) =>
    height - padY - ((score - rangeMin) / range) * (height - padY * 2);

  const linePoints = scored
    .map((p, i) => `${toX(i)},${toY(p.sirtio_score).toFixed(1)}`)
    .join(" ");

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  // Thin the x-axis labels so they don't overlap when there are many
  // points (up to ~30 for a daily-run history), while always labeling
  // the first and last point.
  const maxLabels = 8;
  const labelInterval = Math.max(1, Math.ceil((scored.length - 1) / (maxLabels - 1)));
  const labeledIndexes = scored
    .map((_, i) => i)
    .filter((i) => i % labelInterval === 0 || i === scored.length - 1);

  const first = scored[0];
  const last = scored[scored.length - 1];

  return (
    <div className="bg-surface-raised border border-accent/40 rounded-lg p-5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto text-accent"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Sirtio Score trend from ${formatDate(first.computed_at)} to ${formatDate(last.computed_at)}, ${first.sirtio_score.toFixed(1)} to ${last.sirtio_score.toFixed(1)}`}
      >
        <polyline
          points={linePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {scored.map((p, i) => (
          <g key={p.computed_at}>
            <circle
              cx={toX(i)}
              cy={toY(p.sirtio_score)}
              r={i === scored.length - 1 ? 3.5 : 2}
              fill="currentColor"
            />
            {/* Larger transparent hit area so the tooltip is easy to trigger on hover. */}
            <circle cx={toX(i)} cy={toY(p.sirtio_score)} r={10} fill="transparent">
              <title>{`${formatDate(p.computed_at)} · ${p.sirtio_score.toFixed(1)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="relative mt-2 h-4 text-xs text-muted font-mono">
        {labeledIndexes.map((i) => {
          const leftPct = (toX(i) / width) * 100;
          return (
            <span
              key={scored[i].computed_at}
              className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
              style={{ left: `${leftPct}%` }}
            >
              {formatDate(scored[i].computed_at)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
