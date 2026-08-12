import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import { getTraderStats, getTraderPositions, resolveWallet } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";

function formatMoney(v: number | null) {
  if (v === null) return "--";
  const sign = v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPlainMoney(v: number | null) {
  if (v === null) return "--";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default async function TraderPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet: rawParam } = await params;
  const wallet = await resolveWallet(decodeURIComponent(rawParam));

  if (!wallet) {
    return (
      <div className="min-h-screen">
        <Nav />
        <section className="max-w-3xl mx-auto px-6 py-20 text-center">
          <p className="font-[family-name:var(--font-display)] text-3xl text-parchment mb-4">
            No trader found for "{decodeURIComponent(rawParam)}"
          </p>
          <p className="text-muted mb-8">
            We only track wallets that have appeared on Polymarket's
            top-25 leaderboard so far. Try a wallet address, or browse
            the full leaderboard below.
          </p>
          <Link href="/leaderboard" className="text-accent hover:underline">
            View the leaderboard --&gt;
          </Link>
        </section>
      </div>
    );
  }

  const stats = await getTraderStats(wallet);
  const positions = await getTraderPositions(wallet);

  const noData =
    !stats ||
    (stats.position_count === 0 && stats.rank === null && stats.username === null);

  if (noData || !stats) {
    return (
      <div className="min-h-screen">
        <Nav />
        <section className="max-w-3xl mx-auto px-6 py-20 text-center">
          <p className="font-[family-name:var(--font-display)] text-3xl text-parchment mb-4">
            No data for this wallet yet
          </p>
          <p className="text-muted mb-8">
            This wallet isn't currently on Polymarket's top-25
            leaderboard, so we don't have position data for it.
          </p>
          <Link href="/leaderboard" className="text-accent hover:underline">
            View the leaderboard --&gt;
          </Link>
        </section>
      </div>
    );
  }

  const resolvedPositions = positions.filter((p) => p.realized_pnl !== null && p.realized_pnl !== 0);
  const winCount = resolvedPositions.filter((p) => (p.realized_pnl ?? 0) > 0).length;
  const lossCount = resolvedPositions.filter((p) => (p.realized_pnl ?? 0) <= 0).length;
  const winPct = resolvedPositions.length > 0 ? (winCount / resolvedPositions.length) * 100 : 0;

  const edgeNormalized =
    stats.avg_edge_pct !== null
      ? Math.min(Math.max((stats.avg_edge_pct + 100) / 200, 0), 1)
      : null;
  const consistency =
    stats.avg_edge_pct !== null && stats.pnl_stddev !== null
      ? Math.min(
          Math.max(1 - stats.pnl_stddev / (Math.abs(stats.avg_edge_pct) + 1), 0),
          1
        )
      : null;
  const sampleFactor = Math.min(stats.position_count / 30, 1);

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <Link href="/leaderboard" className="text-sm text-accent hover:underline">
          --&gt; Back to leaderboard
        </Link>

        <div className="mt-6 flex items-start justify-between flex-wrap gap-6">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-4xl text-parchment mb-2">
              {getDisplayName(stats.username, stats.wallet)}
            </h1>
            <div className="flex items-center gap-3">
              <CopyableWallet wallet={stats.wallet} />
              <a href={polymarketProfileUrl(stats.wallet)} target="_blank" rel="noopener noreferrer"
                className="text-xs text-accent hover:underline">
                View on Polymarket
              </a>
            </div>
          </div>
          {stats.rank !== null && (
            <div className="text-right">
              <p className="font-mono text-xs uppercase tracking-wide text-muted">
                Leaderboard rank
              </p>
              <p className="font-[family-name:var(--font-display)] text-3xl text-accent">
                #{stats.rank}
              </p>
            </div>
          )}
        </div>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="border border-hairline rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Total PnL</p>
            <p className={`font-[family-name:var(--font-display)] text-2xl ${
                (stats.pnl ?? 0) >= 0 ? "text-signal-yes" : "text-signal-no"
              }`}
            >
              {formatMoney(stats.pnl)}
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Volume</p>
            <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              {formatPlainMoney(stats.volume)}
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">
              Win rate (weighted)
            </p>
            <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              {stats.win_rate !== null ? `${(stats.win_rate * 100).toFixed(0)}%` : "--"}
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Resolved / total positions</p>
            <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              {stats.position_count} / {positions.length}
            </p>
          </div>
        </div>

        <div className="mt-16">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              PM Score breakdown
            </h2>
            <p className="font-mono text-3xl text-signal-yes">
              {stats.pm_score !== null ? stats.pm_score.toFixed(1) : "--"}
            </p>
          </div>
          <p className="text-xs text-muted mb-6">
            See the <Link href="/methodology" className="text-accent hover:underline">full methodology</Link> for how each piece is calculated.
          </p>

          {stats.position_count > 0 ? (
            <div className="space-y-5">
              <ScoreRow label="Win rate" weight="40%" value={stats.win_rate} />
              <ScoreRow label="Average edge (normalized)" weight="35%" value={edgeNormalized} />
              <ScoreRow label="Consistency" weight="25%" value={consistency} />
              <ScoreRow label="Sample-size factor" weight="multiplier" value={sampleFactor} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              No resolved positions yet -- PM Score needs at least some
              position history to compute.
            </p>
          )}
        </div>

        {resolvedPositions.length > 0 && (
          <div className="mt-16">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
              Position outcomes (resolved only)
            </h2>
            <div className="flex items-center gap-3">
              <div className="relative h-3 flex-1 rounded-full bg-signal-no overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-signal-yes" style={{ width: `${winPct}%` }} />
              </div>
              <span className="font-mono text-sm text-muted whitespace-nowrap">
                {winCount} win{winCount === 1 ? "" : "s"} / {lossCount} loss{lossCount === 1 ? "" : "es"}
              </span>
            </div>
          </div>
        )}

        <div className="mt-16">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
            All positions
          </h2>
          {positions.length === 0 ? (
            <p className="text-sm text-muted">No position data for this wallet.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[1fr_80px_90px_90px_100px_90px] gap-4 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
                <span>Market</span>
                <span className="text-right">Side</span>
                <span className="text-right">Entry</span>
                <span className="text-right">Current</span>
                <span className="text-right">PnL</span>
                <span className="text-right">Return</span>
              </div>
              {positions.map((p) => {
                const resolved = p.cur_price !== null && (p.cur_price >= 0.98 || p.cur_price <= 0.02);
                return (
                  <div key={p.condition_id}
                    className="grid grid-cols-[1fr_80px_90px_90px_100px_90px] items-center gap-4 py-3 border-b border-hairline"
                  >
                    <div>
                      <p className="text-sm text-parchment truncate">{p.market_title || "--"}</p>
                      <p className="text-xs text-muted mt-0.5">{resolved ? "Resolved" : "Open"}</p>
                    </div>
                    <span className="font-mono text-xs text-muted text-right">{p.outcome || "--"}</span>
                    <span className="font-mono text-xs text-muted text-right">
                      {p.avg_price !== null ? `${(p.avg_price * 100).toFixed(0)}c` : "--"}
                    </span>
                    <span className="font-mono text-xs text-muted text-right">
                      {p.cur_price !== null ? `${(p.cur_price * 100).toFixed(0)}c` : "--"}
                    </span>
                    <span className={`font-mono text-xs text-right ${
                        (p.cash_pnl ?? 0) >= 0 ? "text-signal-yes" : "text-signal-no"
                      }`}
                    >
                      {formatMoney(p.cash_pnl)}
                    </span>
                    <span className={`font-mono text-xs text-right ${
                        (p.percent_realized_pnl ?? 0) >= 0 ? "text-signal-yes" : "text-signal-no"
                      }`}
                    >
                      {p.percent_realized_pnl !== null ? `${p.percent_realized_pnl.toFixed(0)}%` : "--"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ScoreRow({
  label,
  weight,
  value,
}: {
  label: string;
  weight: string;
  value: number | null;
}) {
  const pct = value !== null ? value * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-sm text-parchment">{label}</p>
        <p className="font-mono text-xs text-muted">
          {weight} {value !== null ? `-- ${pct.toFixed(0)}%` : ""}
        </p>
      </div>
      <div className="h-2 rounded-full bg-hairline overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

