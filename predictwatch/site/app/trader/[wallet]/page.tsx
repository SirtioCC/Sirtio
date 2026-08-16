import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import FollowButton from "@/components/FollowButton";
import { getTraderStats, getTraderPositions, resolveWallet, type TraderPosition } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";
// Was force-dynamic (fresh Supabase query on every single request) --
// switched to a 5-minute revalidation window 2026-08-16 after this
// hit Supabase's free-tier egress cap (115% of 5GB in one billing
// cycle). This is the highest-traffic route on the site AND every
// individual trader page is indexed in sitemap.xml, so search
// crawlers alone were re-querying Supabase on every crawl pass, on
// top of real visitors. The pipeline only writes new position/score
// data once a day, so a fresh query on every page view was always
// more freshness than the underlying data could actually provide --
// this trades a worst-case 5-minute staleness window for Vercel
// serving cached HTML to almost all traffic instead of hitting
// Supabase every time. See leaderboard/page.tsx for the same change.
export const revalidate = 300;

// Same tier system as the leaderboard (see leaderboard/page.tsx for the
// full z_score-vs-score rationale) -- duplicated here rather than shared
// since there's no existing shared utils module for it. Trader detail
// pages never surfaced tier before; this is genuinely new information,
// not just decoration.
function scoreTier(zScore: number | null): string | null {
  if (zScore === null) return null;
  if (zScore >= 6) return "Elite";
  if (zScore >= 3) return "Great";
  if (zScore >= 1) return "Good";
  if (zScore >= -1) return "Break even";
  if (zScore >= -3) return "Below average";
  return "Poor";
}

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

// Real specifics pulled from this trader's actual positions -- their
// best win, worst loss, and whether one trade dominates their total
// realized PnL for the window. Two traders with a similar score can
// read completely differently here if one got there from one huge
// trade and the other from a long consistent streak.
function scoreBreakdownDetail(positions: TraderPosition[]): string | null {
  const withPnl = positions.filter((p) => p.realized_pnl !== null);
  if (withPnl.length === 0) return null;

  const sorted = [...withPnl].sort((a, b) => b.realized_pnl! - a.realized_pnl!);
  const bestWin = sorted[0].realized_pnl! > 0 ? sorted[0] : null;
  const worstLoss = sorted[sorted.length - 1].realized_pnl! < 0 ? sorted[sorted.length - 1] : null;
  const totalPnl = withPnl.reduce((sum, p) => sum + p.realized_pnl!, 0);
  const bestWinShare = bestWin && totalPnl > 0 ? bestWin.realized_pnl! / totalPnl : null;

  const parts: string[] = [];
  if (bestWin) {
    const pct = bestWin.percent_return_approx !== null
      ? ` (a ${bestWin.percent_return_approx.toFixed(0)}% return)`
      : "";
    parts.push(`The best single trade in this window was ${formatMoney(bestWin.realized_pnl)} ` +
      `on "${bestWin.market_title}"${pct}.`);
  }
  if (worstLoss) {
    parts.push(`The worst was a ${formatMoney(worstLoss.realized_pnl)} loss on "${worstLoss.market_title}".`);
  } else if (bestWin) {
    parts.push(`Every resolved position in this window closed in the green -- no losses to report.`);
  }
  if (bestWinShare !== null && bestWinShare > 0.5) {
    parts.push(`That single trade alone accounts for more than half of this trader's ` +
      `total realized gains in the window, worth keeping in mind when weighing consistency.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
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
          <p className="text-body mb-8">
            We only track wallets that have appeared on Polymarket's
            Monthly leaderboard (their top traders by profit over
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
          <p className="text-body mb-8">
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

        <div className="mt-6 flex items-start justify-between gap-8 flex-wrap">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl text-parchment">
                {getDisplayName(stats.username, stats.wallet)}
              </h1>
              <FollowButton wallet={stats.wallet} />
            </div>
            <div className="flex items-center gap-3">
              <CopyableWallet wallet={stats.wallet} />
              <a href={polymarketProfileUrl(stats.wallet)} target="_blank" rel="noopener noreferrer"
                className="text-xs text-accent hover:underline">
                View on Polymarket
              </a>
            </div>
          </div>

          {scoreTier(stats.z_score) && (
            <div className="bg-surface-raised border border-accent/40 rounded-lg px-6 py-3 text-center">
              <p className="font-mono text-xs uppercase tracking-wide text-muted mb-1">
                Tier
              </p>
              <p className="font-[family-name:var(--font-title)] font-bold text-2xl text-accent">
                {scoreTier(stats.z_score)}
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-sm text-body leading-relaxed max-w-3xl">
          {traderSummary(stats, name)}
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
          <div className="bg-surface-raised border border-accent/40 rounded-lg p-5 flex items-start gap-10">
            {stats.rank !== null && (
              <div className="text-center">
                <p className="font-mono text-xs uppercase tracking-wide text-muted">
                  Rank
                </p>
                <p className="font-[family-name:var(--font-display)] italic text-3xl text-parchment">
                  #{stats.rank}
                </p>
              </div>
            )}
            <div className="text-center">
              <p className="font-mono text-xs uppercase tracking-wide text-muted">
                Sirtio score
              </p>
              <p className="font-mono text-3xl text-accent">
                {stats.pm_score !== null ? stats.pm_score.toFixed(1) : "--"}
              </p>
            </div>
          </div>
          <div className="bg-surface-raised border border-accent/40 rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">
              Avg edge (per position)
            </p>
            <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
              {stats.avg_edge_pct !== null ? `${stats.avg_edge_pct >= 0 ? "+" : ""}${stats.avg_edge_pct.toFixed(0)}%` : "--"}
            </p>
          </div>
          <div className="bg-surface-raised border border-accent/40 rounded-lg p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Positions (90d)</p>
            <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
              {stats.position_count}
            </p>
          </div>
        </div>

        <div className="mt-10">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
            Sirtio Score Breakdown
          </h2>
          <p className="text-xs text-muted mb-6">
            See the <Link href="/methodology" className="text-accent hover:underline">full methodology</Link> for how each piece is calculated.
          </p>

          {stats.position_count > 0 && stats.z_score !== null ? (() => {
            const detailText = scoreBreakdownDetail(positions);
            const edgeText = stats.avg_edge_pct !== null
              ? `${stats.avg_edge_pct >= 0 ? "+" : ""}${stats.avg_edge_pct.toFixed(0)}%`
              : "--";
            const zText = `${stats.z_score! >= 0 ? "+" : ""}${stats.z_score!.toFixed(2)}`;
            const scoreText = stats.pm_score !== null ? stats.pm_score.toFixed(1) : "--";
            return (
            <div className="space-y-6">
              <div className="bg-surface-raised rounded-lg px-6 py-6">
                <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-1">
                  <div className="flex-1 text-center">
                    <p className="text-xs uppercase tracking-wide text-muted mb-1">Raw avg return</p>
                    <p className="font-mono text-2xl text-parchment">{edgeText}</p>
                    <p className="text-xs text-muted mt-1">across {stats.position_count} position{stats.position_count === 1 ? "" : "s"}</p>
                  </div>
                  <div className="flex flex-col items-center justify-center px-2 max-w-[130px]">
                    <span className="text-accent text-xl leading-none">&rarr;</span>
                    <span className="text-[10px] text-muted text-center mt-1 leading-tight">
                      Shrunk toward the pool average, weighted by sample size
                    </span>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-xs uppercase tracking-wide text-muted mb-1">Z-score</p>
                    <p className="font-mono text-2xl text-parchment">{zText}</p>
                    <p className="text-xs text-muted mt-1">distance from average, adjusted for confidence</p>
                  </div>
                  <div className="flex flex-col items-center justify-center px-2 max-w-[130px]">
                    <span className="text-accent text-xl leading-none">&rarr;</span>
                    <span className="text-[10px] text-muted text-center mt-1 leading-tight">
                      Converted to a 0-100 scale
                    </span>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-xs uppercase tracking-wide text-muted mb-1">Sirtio score</p>
                    <p className="font-mono text-2xl text-accent">{scoreText}</p>
                  </div>
                </div>
                <p className="text-xs text-muted mt-5 text-center">
                  The exact weighting is part of the model we keep private (see{" "}
                  <Link href="/methodology" className="text-accent hover:underline">methodology</Link>),
                  but every number above is this trader's real, calculated value at that step.
                </p>
              </div>
              {detailText && (
                <p className="text-sm text-body leading-relaxed max-w-2xl">
                  {detailText}
                </p>
              )}
            </div>
            );
          })() : (
            <p className="text-sm text-body">
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
            <div key={p.condition_id}
              className="grid grid-cols-[1fr_75px_55px] items-center gap-2 py-3 border-b border-hairline"
            >
              <div className="min-w-0">
                <p className="text-sm text-parchment truncate">{p.market_title || "--"}</p>
                <p className="text-xs text-muted mt-0.5 truncate">{p.outcome || "--"}</p>
              </div>
              <span className={`font-mono text-xs text-right ${isWin ? "text-signal-yes" : "text-signal-no"}`}>
                {formatMoney(p.realized_pnl)}
              </span>
              <span className={`font-mono text-xs text-right ${isWin ? "text-signal-yes" : "text-signal-no"}`}>
                {p.percent_return_approx !== null ? `${p.percent_return_approx.toFixed(0)}%` : "--"}
              </span>
            </div>
          );

          return (
            <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-10">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl text-parchment mb-4">
                  Top 5 Wins (Last 90 Days)
                </h2>
                {topWins.length > 0 ? (
                  <div>{topWins.map((p) => renderRow(p, true))}</div>
                ) : (
                  <p className="text-sm text-body">No winning positions in this window.</p>
                )}
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl text-parchment mb-4">
                  Top 5 Losses (Last 90 Days)
                </h2>
                {topLosses.length > 0 ? (
                  <div>{topLosses.map((p) => renderRow(p, false))}</div>
                ) : (
                  <p className="text-sm text-body">No losing positions in this window.</p>
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
            <p className="text-sm text-body">No positions resolved in the last 90 days for this wallet.</p>
          ) : (
            <div className="bg-surface rounded-lg px-4 sm:px-6 pt-2">
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
                    <div className="min-w-0">
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
              <div className="pb-2" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
