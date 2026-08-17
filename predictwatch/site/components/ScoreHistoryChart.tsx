import type { ScoreHistoryPoint } from "@/lib/queries";

/**
 * Renders a trader's Sirtio Score over the last 30 days as a simple
 * SVG line chart. Server-rendered, no client JS and no charting
 * library -- this is one line on one page, not worth the bundle cost
 * of recharts/d3 for. Built directly on trader_sirtio_scores' new
 * one-row-per-run history (see queries.ts getTraderScoreHistory and
 * the 2026-08-17 snapshot-history fix that made this data possible).
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
  const toY = (score: number) =>
    height - padY - ((score - rangeMin) / range) * (height - padY * 2);

  const linePoints = scored
    .map((p, i) => `${padX + i * stepX},${toY(p.sirtio_score).toFixed(1)}`)
    .join(" ");

  const first = scored[0];
  const last = scored[scored.length - 1];
  const firstDate = new Date(first.computed_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const lastDate = new Date(last.computed_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="bg-surface-raised border border-accent/40 rounded-lg p-5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto text-accent"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Sirtio Score trend from ${firstDate} to ${lastDate}, ${first.sirtio_score.toFixed(1)} to ${last.sirtio_score.toFixed(1)}`}
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
          <circle
            key={p.computed_at}
            cx={padX + i * stepX}
            cy={toY(p.sirtio_score)}
            r={i === scored.length - 1 ? 3.5 : 2}
            fill="currentColor"
          />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted font-mono">
        <span>{firstDate} · {first.sirtio_score.toFixed(1)}</span>
        <span>{lastDate} · {last.sirtio_score.toFixed(1)}</span>
      </div>
    </div>
  );
}
