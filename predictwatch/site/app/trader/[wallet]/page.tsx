import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import { getTraderStats, getTraderPositions, resolveWallet } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";
export const dynamic = "force-dynamic";

function formatMoney(v: number | null) {
  if (v === null) return "--";
  const sign = v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Real, varied per-trader summary text -- not a single templated
// sentence reused verbatim across every page. Search engines treat
// near-duplicate boilerplate across many pages as low-value; this
// gives each trader page unique, indexable prose grounded in their
// actual numbers, with wording that changes by tier (same z_score
// bands as scoreTier() on the leaderboard page).
function traderSummary(stats: {
  position_count: number;
  avg_edge_pct: number | null;
  z_score: number | null;
  rank: number | null;
}, name: string): string {
  const { position_count, avg_edge_pct, z_score, rank } = stats;

  if (position_count === 0 || z_score === null) {
    return `${name} doesn't have enough resolved positions in the ` +
      `last 90 days yet for Sirtio to compute a reliable skill estimate.`;
  }

  const edgeText = avg_edge_pct !== null
    ? `${avg_edge_pct >= 0 ? "+" : ""}${avg_edge_pct.toFixed(0)}%`
    : "an unclear";
  const posText = `${position_count} resolved position${position_count === 1 ? "" : "s"}`;
  const rankText = rank !== null ? ` and currently sits at rank #${rank} on Sirtio's leaderboard` : "";

  let verdict: string;
  if (z_score >= 6) {
    verdict = `ranks among the most skilled Polymarket traders we track`;
  } else if (z_score >= 3) {
    verdict = `has consistently outperformed the average tracked trader`;
  } else if (z_score >= 1) {
    verdict = `shows a real edge over the average tracked trader, though a more moderate one`;
  } else if (z_score >= -1) {
    verdict = `performs about in line with the average tracked trader`;
  } else if (z_score >= -3) {
    verdict = `has underperformed the average tracked trader over this window`;
  } else {
    verdict = `has clearly underperformed the rest of the tracked pool`;
  }

  return `Over the last 90 days, ${name} closed ${posText} on Polymarket ` +
    `at an average return of ${edgeText} per position. Based on Sirtio's ` +
    `skill model, ${name} ${verdict}${rankText}.`;
}

type TraderPageProps = {
  params: Promise<{ wallet: string }>;
};

export async function generateMetadata({ params }: TraderPageProps) {
  const { wallet: rawParam } = await params;
  const wallet = await resolveWallet(decodeURIComponent(rawParam));
  if (!wallet) {
    return { title: "Trader Not Found" };
  }
  const stats = await getTraderStats(wallet);
  if (!stats) {
    return { title: "Trader Not Found" };
  }
  const name = getDisplayName(stats.username, stats.wallet);
  const scoreText =
    stats.pm_score !== null ? `Sirtio Score: ${stats.pm_score.toFixed(1)}. ` : "";
  return {
    title: `${name}: Polymarket Trader Profile`,
    description:
      `${scoreText}${name}'s realized PnL, resolved positions, and trading ` +
      `history on Polymarket, tracked and scored by Sirtio.`,
  };
}

export default async function TraderPage({
  params,
}: TraderPageProps) {
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
            Monthly leaderboard (their top 100 traders by profit over
            the last 30 days) so far. Try a wallet address, or browse
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
            This wallet isn't currently on Polymarket's Monthly
            leaderboard, so we don't have position data for it yet.
          </p>
          <Link href="/leaderboard" className="text-accent hover:underline">
            View the leaderboard --&gt;
          </Link>
        </section>
      </div>
    );
  }

  const name = getDisplayName(stats.username, stats.wallet);
  const traderJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: `${name}: Polymarket Trader Profile`,
    description:
      `${name}'s realized PnL, resolved positions, and Sirtio Score on Polymarket.`,
    mainEntity: {
      "@type": "Person",
      name,
      identifier: stats.wallet,
    },
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(traderJsonLd) }}
      />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <Link href="/leaderboard" className="text-sm text-accent hover:underline">
          --&gt; Back to leaderboard
        </Link>

        <div className="mt-6 flex items-start justify-between flex-wrap gap-6">
          <div>
            <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl text-parchment mb-2">
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

        <p className="mt-6 text-sm text-muted leading-relaxed max-w-3xl">
          {traderSummary(stats, name)}
        </p>

        <div className="mt-12 grid grid-cols-2 gap-4 max-w-xl">
          <div className="border border-hairline rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">
              Avg edge (per position)
            </p>
            <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              {stats.avg_edge_pct !== null ? `${stats.avg_edge_pct >= 0 ? "+" : ""}${stats.avg_edge_pct.toFixed(0)}%` : "--"}
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Positions (90d)</p>
            <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              {stats.position_count}
            </p>
          </div>
        </div>

        <div className="mt-16">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment">
              Sirtio Score Breakdown
            </h2>
            <p className="font-mono text-3xl text-signal-yes">
              {stats.pm_score !== null ? stats.pm_score.toFixed(1) : "--"}
            </p>
          </div>
          <p className="text-xs text-muted mb-6">
            See the <Link href="/methodology" className="text-accent hover:underline">full methodology</Link> for how each piece is calculated.
          </p>

          {stats.position_count > 0 && stats.z_score !== null ? (
            <div className="space-y-4">
              <p className="text-sm text-muted leading-relaxed max-w-2xl">
                This trader's average return across {stats.position_count}{" "}
                resolved position{stats.position_count === 1 ? "" : "s"} was{" "}
                {stats.avg_edge_pct !== null
                  ? `${stats.avg_edge_pct >= 0 ? "+" : ""}${stats.avg_edge_pct.toFixed(0)}%`
                  : "--"}
                . Sirtio Score doesn't use that raw number
                directly. It's first blended toward the average
                trader's return, in proportion to how much track
                record exists for this wallet, then measured against
                how uncertain that blended estimate still is. A thin
                sample or an inconsistent track record both widen that
                uncertainty and pull the score toward 50 (breakeven).
                A large, consistent sample lets the score move further
                from 50 in either direction.
              </p>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs uppercase tracking-wide text-muted">
                  Z-score
                </span>
                <span className="font-mono text-sm text-parchment">
                  {stats.z_score >= 0 ? "+" : ""}
                  {stats.z_score.toFixed(2)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              No resolved positions yet. Sirtio Score needs at least
              some position history to compute.
            </p>
          )}
        </div>

        {positions.length > 0 && (() => {
          const sorted = [...positions].sort((a, b) => (b.realized_pnl ?? 0) - (a.realized_pnl ?? 0));
          const topWins = sorted.filter((p) => (p.realized_pnl ?? 0) > 0).slice(0, 5);
          const topLosses = sorted.filter((p) => (p.realized_pnl ?? 0) < 0).slice(-5).reverse();

          const renderRow = (p: typeof positions[number], isWin: boolean) => (
            <div key={p.condition_id} className="flex items-center justify-between gap-4 py-3 border-b border-hairline">
              <div className="min-w-0">
                <p className="text-sm text-parchment truncate">{p.market_title || "--"}</p>
                <p className="text-xs text-muted mt-0.5 truncate">{p.outcome || "--"}</p>
              </div>
              <span className={`font-mono text-sm text-right shrink-0 ${isWin ? "text-signal-yes" : "text-signal-no"}`}>
                {formatMoney(p.realized_pnl)}
              </span>
            </div>
          );

          return (
            <div className="mt-16 grid md:grid-cols-2 gap-10">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl text-parchment mb-4">
                  Top 5 Wins (Last 90 Days)
                </h2>
                {topWins.length > 0 ? (
                  <div>{topWins.map((p) => renderRow(p, true))}</div>
                ) : (
                  <p className="text-sm text-muted">No winning positions in this window.</p>
                )}
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl text-parchment mb-4">
                  Top 5 Losses (Last 90 Days)
                </h2>
                {topLosses.length > 0 ? (
                  <div>{topLosses.map((p) => renderRow(p, false))}</div>
                ) : (
                  <p className="text-sm text-muted">No losing positions in this window.</p>
                )}
              </div>
            </div>
          );
        })()}

        <div className="mt-16">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
            All Positions (Last 90 Days)
          </h2>
          {positions.length === 0 ? (
            <p className="text-sm text-muted">No positions resolved in the last 90 days for this wallet.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[1fr_90px_80px] sm:grid-cols-[1fr_80px_90px_100px_90px] gap-3 sm:gap-4 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
                <span>Market</span>
                <span className="hidden sm:block text-right">Side</span>
                <span className="hidden sm:block text-right">Entry</span>
                <span className="text-right">PnL</span>
                <span className="text-right">Return</span>
              </div>
              {positions.map((p) => {
                return (
                  <div key={p.condition_id}
                    className="grid grid-cols-[1fr_90px_80px] sm:grid-cols-[1fr_80px_90px_100px_90px] items-center gap-3 sm:gap-4 py-3 border-b border-hairline"
                  >
                    <div>
                      <p className="text-sm text-parchment truncate">{p.market_title || "--"}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {p.closed_at
                          ? `Resolved ${new Date(p.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : "Resolved"}
                      </p>
                    </div>
                    <span className="hidden sm:block font-mono text-xs text-muted text-right">{p.outcome || "--"}</span>
                    <span className="hidden sm:block font-mono text-xs text-muted text-right">
                      {p.avg_price !== null ? `${(p.avg_price * 100).toFixed(0)}c` : "--"}
                    </span>
                    <span className={`font-mono text-xs text-right ${
                        (p.realized_pnl ?? 0) >= 0 ? "text-signal-yes" : "text-signal-no"
                      }`}
                    >
                      {formatMoney(p.realized_pnl)}
                    </span>
                    <span className={`font-mono text-xs text-right ${
                        (p.percent_return_approx ?? 0) >= 0 ? "text-signal-yes" : "text-signal-no"
                      }`}
                    >
                      {p.percent_return_approx !== null ? `${p.percent_return_approx.toFixed(0)}%` : "--"}
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
