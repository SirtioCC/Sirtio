import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import FollowButton from "@/components/FollowButton";
import PositionsList from "@/components/PositionsList";
import { getTraderStats, getTraderPositions, getPositionsTrackingStart, resolveWallet, type TraderPosition } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";
import { scoreTier, SCORE_TIER_CUTOFFS } from "@/lib/tiers";
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

// scoreTier() now lives in lib/tiers.ts, shared with the leaderboard --
// a trader's tier badge here has to match what they'd see for
// themselves on the leaderboard, so it can't be a second, independently
// tuned copy. See that file for why tiers are fixed on the 0-100 score.

// Honest window label for the "All Positions" table, added 2026-08-26.
// A wallet Sirtio started tracking less than 90 days ago has not had
// a full 90-day window fetched -- a position that resolved before
// tracking began is missing from the table no matter what, so calling
// it "Last 90 Days" overstates coverage. Falls back to "Last 90 Days"
// when trackingStartedAt is null (no ledger rows yet at all) since
// the empty-state message below the table already covers that case.
function positionsWindowLabel(trackingStartedAt: string | null): string {
  if (!trackingStartedAt) return "Last 90 Days";
  const start = new Date(trackingStartedAt);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  if (start > ninetyDaysAgo) {
    const dateText = start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `Since Tracked ${dateText}`;
  }
  return "Last 90 Days";
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
// actual numbers, with wording that changes by tier (same SCORE_TIER_CUTOFFS
// bands as scoreTier(), both from lib/tiers.ts).
function traderSummary(stats: {
  position_count: number;
  avg_edge_pct: number | null;
  pm_score: number | null;
  rank: number | null;
}, name: string): string {
  const { position_count, avg_edge_pct, pm_score, rank } = stats;

  if (position_count === 0 || pm_score === null) {
    return `${name} doesn't have enough resolved positions in the ` +
      `last 90 days yet for Sirtio to compute a reliable skill estimate.`;
  }

  const edgeText = avg_edge_pct !== null
    ? `${avg_edge_pct >= 0 ? "+" : ""}${avg_edge_pct.toFixed(0)}%`
    : "an unclear";
  const posText = `${position_count} resolved position${position_count === 1 ? "" : "s"}`;
  const rankText = rank !== null ? ` and currently sits at rank #${rank} on Sirtio's leaderboard` : "";

  let verdict: string;
  if (pm_score >= SCORE_TIER_CUTOFFS.elite) {
    verdict = `ranks among the most skilled Polymarket traders we track`;
  } else if (pm_score >= SCORE_TIER_CUTOFFS.great) {
    verdict = `has consistently outperformed the average tracked trader`;
  } else if (pm_score >= SCORE_TIER_CUTOFFS.good) {
    verdict = `shows a real edge over the average tracked trader, though a more moderate one`;
  } else if (pm_score >= SCORE_TIER_CUTOFFS.breakEven) {
    verdict = `performs about in line with the average tracked trader`;
  } else if (pm_score >= SCORE_TIER_CUTOFFS.belowAverage) {
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
  const title = `${name}: Polymarket Trader Profile`;
  const description =
    `${scoreText}${name}'s realized PnL, resolved positions, and trading ` +
    `history on Polymarket, tracked and scored by Sirtio.`;

  // openGraph/twitter aren't deep-merged with the root layout's defaults --
  // a page that only sets the plain title/description above still shares
  // the layout's static "Sirtio: Prediction Market Intelligence" og/twitter
  // title, even though this route's opengraph-image.tsx renders a real,
  // trader-specific card. That mismatch is exactly what shows up as the
  // caption on X/Discord/Slack link previews, so it has to be set here too.
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
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

  const [stats, positions, trackingStartedAt] = await Promise.all([
    getTraderStats(wallet),
    getTraderPositions(wallet),
    getPositionsTrackingStart(wallet),
  ]);

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
  // Structured data for rich snippets. Google Search Console flagged
  // this page's markup with "Invalid object type for field <parent_node>"
  // -- AggregateRating is only valid as a property of specific
  // schema.org types Google's Review-snippet validator recognizes
  // (Product, LocalBusiness, Book, Course, Event, Movie, Recipe,
  // SoftwareApplication, and a handful of others). Person -- what this
  // page's mainEntity is -- isn't one of them, so nesting aggregateRating
  // under a Person is structurally invalid regardless of the values
  // inside it. The Sirtio Score is carried as a plain PropertyValue in
  // additionalProperty instead, alongside the rest of the trader's
  // stats -- same information, no invalid nesting.
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
      additionalProperty: [
        ...(stats.pm_score !== null
          ? [{ "@type": "PropertyValue", name: "Sirtio Score", value: stats.pm_score.toFixed(1) }]
          : []),
        ...(stats.rank !== null
          ? [{ "@type": "PropertyValue", name: "Sirtio Leaderboard Rank", value: stats.rank }]
          : []),
        ...(stats.avg_edge_pct !== null
          ? [{ "@type": "PropertyValue", name: "Average Edge (per position)", value: `${stats.avg_edge_pct.toFixed(1)}%` }]
          : []),
        { "@type": "PropertyValue", name: "Resolved Positions (90d)", value: stats.position_count },
        ...(stats.realized_pnl_90d !== null
          ? [{ "@type": "PropertyValue", name: "Realized PnL (90d, USD)", value: stats.realized_pnl_90d.toFixed(0) }]
          : []),
        ...(scoreTier(stats.pm_score)
          ? [{ "@type": "PropertyValue", name: "Sirtio Tier", value: scoreTier(stats.pm_score) }]
          : []),
      ],
    },
  };

  return (
    <div className="min-h-screen">
      <Nav showFreshness />
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

          {scoreTier(stats.pm_score) && (
            <Link href="/methodology#tiers"
              className="bg-surface-raised border border-accent/40 hover:border-accent transition-colors rounded-lg px-6 py-3 text-center"
              title="See how tiers work on the Methodology page"
            >
              <p className="font-mono text-xs uppercase tracking-wide text-muted mb-1">
                Tier
              </p>
              <p className="font-[family-name:var(--font-title)] font-bold text-2xl text-accent">
                {scoreTier(stats.pm_score)}
              </p>
            </Link>
          )}
        </div>

        <p className="mt-6 text-sm text-parchment leading-relaxed max-w-3xl">
          {traderSummary(stats, name)}
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
          <div className="bg-surface-raised border border-accent/40 rounded-lg p-5 flex items-start gap-6 sm:gap-10">
            <div className="text-center">
              <p className="font-mono text-xs uppercase tracking-wide text-muted">
                Rank
              </p>
              {stats.rank !== null ? (
                <p className="font-[family-name:var(--font-display)] italic text-3xl text-parchment">
                  #{stats.rank}
                </p>
              ) : (
                <p className="text-xs text-muted mt-1 max-w-[10rem]">
                  Not yet ranked by Sirtio Score
                </p>
              )}
            </div>
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

        {stats.open_fraction !== null && stats.open_fraction > 0.4 && (
          <p className="mt-4 text-sm text-parchment max-w-3xl">
            Heads up: a win has to be redeemed to become real money, but a
            losing position that settled at $0 never has to be -- so the{" "}
            {stats.position_count} closed positions this score is based on
            skew toward wins by construction, not necessarily by skill. An
            estimated {(stats.open_fraction * 100).toFixed(0)}% of {name}&apos;s
            real money hasn&apos;t gone through that filter yet, so the Avg
            edge and Sirtio Score above could be flattering their true
            record until more of it resolves.
          </p>
        )}

        <div className="mt-10">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
            Sirtio Score Breakdown
          </h2>
          <p className="text-xs text-parchment mb-6">
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
              <div className="bg-surface-raised border border-accent/40 rounded-lg px-6 py-6">
                <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-1">
                  <div className="flex-1 text-center">
                    <p className="text-xs uppercase tracking-wide text-parchment mb-1">Raw avg return</p>
                    <p className="font-mono text-2xl text-accent">{edgeText}</p>
                    <p className="text-xs text-parchment mt-1">across {stats.position_count} position{stats.position_count === 1 ? "" : "s"}</p>
                  </div>
                  <div className="flex flex-col items-center justify-center px-2 max-w-[130px]">
                    <span className="text-accent text-xl leading-none">&rarr;</span>
                    <span className="text-[10px] text-parchment text-center mt-1 leading-tight">
                      Shrunk toward the pool average, weighted by sample size
                    </span>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-xs uppercase tracking-wide text-parchment mb-1">Z-score</p>
                    <p className="font-mono text-2xl text-accent">{zText}</p>
                    <p className="text-xs text-parchment mt-1">distance from average, adjusted for confidence</p>
                  </div>
                  <div className="flex flex-col items-center justify-center px-2 max-w-[130px]">
                    <span className="text-accent text-xl leading-none">&rarr;</span>
                    <span className="text-[10px] text-parchment text-center mt-1 leading-tight">
                      Converted to a 0-100 scale
                    </span>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-xs uppercase tracking-wide text-parchment mb-1">Sirtio score</p>
                    <p className="font-mono text-2xl text-accent">{scoreText}</p>
                  </div>
                </div>
                <p className="text-xs text-parchment mt-5 text-center">
                  The exact weighting is part of the model we keep private (see{" "}
                  <Link href="/methodology" className="text-accent hover:underline">methodology</Link>),
                  but every number above is this trader's real, calculated value at that step.
                </p>
              </div>
              {detailText && (
                <p className="text-sm text-parchment leading-relaxed max-w-2xl">
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

        {stats.is_tracked && positions.length > 0 && (() => {
          const sorted = [...positions].sort((a, b) => (b.realized_pnl ?? 0) - (a.realized_pnl ?? 0));
          const topWins = sorted.filter((p) => (p.realized_pnl ?? 0) > 0).slice(0, 5);
          const topLosses = sorted.filter((p) => (p.realized_pnl ?? 0) < 0).slice(-5).reverse();

          const renderRow = (p: typeof positions[number], isWin: boolean) => {
            const color = isWin ? "text-signal-yes" : "text-signal-no";
            const pnlText = formatMoney(p.realized_pnl);
            const returnText = p.percent_return_approx !== null ? `${p.percent_return_approx.toFixed(0)}%` : "--";
            return (
              <div key={p.condition_id} className="py-3 border-b border-hairline">
                {/* Mobile: full-width title, PnL/Return on their own row --
                    same fix as PositionsList, avoids truncating market
                    names down to a handful of characters. */}
                <div className="sm:hidden">
                  <p className="text-sm text-parchment leading-snug">{p.market_title || "--"}</p>
                  <p className="text-xs text-muted mt-0.5">{p.outcome || "--"}</p>
                  <div className="flex items-center gap-4 mt-1.5">
                    <span className={`font-mono text-sm ${color}`}>{pnlText}</span>
                    <span className={`font-mono text-xs ${color}`}>{returnText}</span>
                  </div>
                </div>
                <div className="hidden sm:grid sm:grid-cols-[1fr_75px_55px] sm:items-center sm:gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-parchment truncate">{p.market_title || "--"}</p>
                    <p className="text-xs text-muted mt-0.5 truncate">{p.outcome || "--"}</p>
                  </div>
                  <span className={`font-mono text-xs text-right ${color}`}>{pnlText}</span>
                  <span className={`font-mono text-xs text-right ${color}`}>{returnText}</span>
                </div>
              </div>
            );
          };

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
            All Positions ({positionsWindowLabel(trackingStartedAt)})
          </h2>
          {/*
            is_tracked === false, added 2026-08-25: this wallet is outside
            Sirtio's own top-100-by-score AND has no followers, so the
            pipeline's activity fetch (see run_pipeline.py) has stopped
            pulling new trade/redeem events for it -- the position ledger
            below would silently be frozen as of whatever day it fell out,
            not actually current, even though it renders identically to a
            live table. Showing an explanation and a path to fix it (follow
            the wallet) beats rendering a table that LOOKS live but isn't --
            confirmed live via Flipadelphia: his ledger froze exactly the
            day he fell off Polymarket's OWN top-100, the prior tracking
            criterion, and the site kept showing his last-known positions
            with no indication anything had stopped updating.
          */}
          {!stats.is_tracked ? (
            <p className="text-sm text-body max-w-2xl">
              This trader isn't in Sirtio's top 100 by score and has no
              followers, so we've paused fetching new position data for
              them -- the numbers above reflect their last tracked
              activity, not necessarily their current trading. Follow
              this trader (see the button near their name above) to
              resume tracking their live positions.
            </p>
          ) : positions.length === 0 ? (
            <p className="text-sm text-body">No positions resolved in the last 90 days for this wallet.</p>
          ) : (
            <PositionsList positions={positions} />
          )}
        </div>
      </section>
    </div>
  );
}
