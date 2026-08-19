import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import { getLeaderboard } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";
// Was force-dynamic (fresh Supabase query on every single request) --
// switched to a 5-minute revalidation window 2026-08-16 after this
// hit Supabase's free-tier egress cap (115% of 5GB in one billing
// cycle). The pipeline only writes new leaderboard data once a day via
// the scheduled GitHub Action, so a fresh query on every page view was
// always more freshness than the underlying data could actually
// provide -- this trades a worst-case 5-minute staleness window for
// Vercel serving cached HTML to almost all traffic instead of hitting
// Supabase every time.
export const revalidate = 300;

export const metadata = {
  title: "Trader Leaderboard",
  description:
    "The top Polymarket traders ranked by Sirtio Score, a statistical model built to separate real trading skill from lucky one-off bets, using realized PnL and Bayesian shrinkage.",
};

// Sirtio Score is built so 50 represents a truly break-even trader
// (0% avg edge, $0 realized PnL) at full sample size -- see
// methodology's formula section. Sample-size damping only ever pulls
// a score DOWN from there, never up, so these bands are read directly
// against the final (already-damped) score shown on the page.
// Tier cutoffs anchored to z_score, not the raw 0-100 score -- Z is
// the real statistic (skill above/below average in posterior-
// uncertainty units); the 0-100 number is just a display transform of
// it via a logistic k that gets re-calibrated from real data every
// pipeline run and will drift slightly over time. Z-based cutoffs stay
// meaningful even as k shifts; score-based cutoffs would need constant
// re-tuning. Set 2026-08-14 against the first real run's output
// (67 scored wallets) -- see sirtio_score.py for the full derivation.
function scoreTier(zScore: number | null): string | null {
  if (zScore === null) return null;
  if (zScore >= 6) return "Elite";
  if (zScore >= 3) return "Great";
  if (zScore >= 1) return "Good";
  if (zScore >= -1) return "Break even";
  if (zScore >= -3) return "Below average";
  return "Poor";
}

// Rank-mover badge: compares a trader's position in today's list
// (their index in scoredTraders, 1-based) against prev_rank (their
// position in yesterday's snapshot, from getLeaderboard). prev_rank
// === null means no prior snapshot exists for this wallet yet (brand
// new to the leaderboard, or this is the first day the feature has
// snapshot history to compare against) -- shown as NEW, not a fake
// number. A zero-spot change (rare, but possible) is shown as a plain
// dash rather than an arrow with no distance behind it.
function RankMove({ currentRank, prevRank }: { currentRank: number; prevRank: number | null }) {
  if (prevRank === null) {
    return <span className="text-xs font-mono text-accent">NEW</span>;
  }
  const change = prevRank - currentRank; // positive = moved up (better rank)
  if (change === 0) {
    return <span className="text-sm font-mono text-muted">--</span>;
  }
  const isUp = change > 0;
  return (
    <span className={`text-sm font-mono ${isUp ? "text-signal-yes" : "text-signal-no"}`}>
      {isUp ? "▲" : "▼"}{Math.abs(change)}
    </span>
  );
}

export default async function LeaderboardPage() {
  const traders = await getLeaderboard(100);
  const scoredTraders = traders.filter(
    (t) => t.pm_score !== null || t.position_count > 0
  );

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl text-parchment mb-2">
          Trader Leaderboard
        </h1>
        <p className="text-body mb-2">
          Polymarket only.
          This leaderboard draws from Polymarket's own public
          "Monthly" leaderboard, the top 100 traders by profit over
          the last 30 days. It's not every Polymarket trader, and
          it's not an all-time ranking. Once we have that pool of 100
          wallets, we score each one on their own using 90 days of
          realized PnL history to compute Sirtio Score, a different
          window than the monthly pull used to find them.
        </p>
        <p className="text-body mb-10">
          Sirtio Score is built entirely from realized PnL: average
          edge per position and total realized PnL magnitude, both
          damped by sample size.{" "}
          <Link href="/methodology" className="text-accent hover:underline">
            Read the full methodology
          </Link>
          . It needs more resolved history to fully validate, so read
          it as directional rather than precise. Names are shown as-is
          from Polymarket. Click a wallet address to copy it, click a
          trader's name to view their Sirtio profile, or click "View
          on Polymarket" to see their public Polymarket profile.
        </p>
        <p className="text-body mb-10">
          This list currently shows the top {scoredTraders.length} traders
          who meet the minimum requirements for a Sirtio Score. That
          number moves day to day. A trader can be excluded because
          they have no resolved positions in the last 90 days, or
          because their trading activity looks automated, which we
          filter out before scoring. They stay part of Polymarket's
          tracked pool and may show up here once they qualify.
        </p>

        {traders.length === 0 ? (
          <p className="text-body">
            No trader data yet -- run the pipeline to populate data.
          </p>
        ) : (
          <div className="bg-surface rounded-lg px-4 sm:px-6 pt-2">
            <div className="grid grid-cols-[28px_1fr_90px] sm:grid-cols-[40px_340px_1fr_90px_1fr] gap-3 sm:gap-6 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Trader</span>
              <span className="text-center">Sirtio Score</span>
              <span className="hidden sm:block text-center">Change (24hr)</span>
              <span className="hidden sm:block text-center">Resolved Bets (Last 90D)</span>
            </div>
            {scoredTraders.map((t, i) => (
              <div key={t.wallet}
                className="grid grid-cols-[28px_1fr_90px] sm:grid-cols-[40px_340px_1fr_90px_1fr] items-center gap-3 sm:gap-6 py-4 border-b border-hairline"
              >
                <span className="font-mono text-muted text-sm">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <Link href={`/trader/${t.wallet}`}
                    className="text-parchment hover:text-accent transition-colors"
                  >
                    {getDisplayName(t.username, t.wallet)}
                  </Link>
                  <div className="mt-1 flex items-center gap-2">
                    <CopyableWallet wallet={t.wallet} />
                    <a href={polymarketProfileUrl(t.wallet)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted hover:text-accent transition-colors"
                    >
                      · View on Polymarket
                    </a>
                  </div>
                </div>
                <div className="text-center">
                  <span className="font-mono text-xl text-accent">
                    {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                  </span>
                  {scoreTier(t.z_score) && (
                    <p className="text-xs text-muted mt-0.5">
                      {scoreTier(t.z_score)}
                    </p>
                  )}
                </div>
                <div className="hidden sm:flex justify-center">
                  <RankMove currentRank={i + 1} prevRank={t.prev_rank} />
                </div>
                <span className="hidden sm:block font-mono text-base text-parchment text-center">
                  {t.position_count}
                </span>
              </div>
            ))}
            <div className="pb-2" />
          </div>
        )}
      </section>
    </div>
  );
}
