import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import { getLeaderboard } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";

export const metadata = {
  title: "Trader Leaderboard",
  description:
    "The top Polymarket traders ranked by Sirtio Score -- a statistical model built to separate real trading skill from lucky one-off bets, using realized PnL and Bayesian shrinkage.",
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

export default async function LeaderboardPage() {
  const traders = await getLeaderboard(100);

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-parchment mb-2">
          Trader leaderboard
        </h1>
        <p className="text-muted mb-2">
          Polymarket only -- Kalshi doesn't expose public trader data.
          This leaderboard draws from Polymarket's own public
          "Monthly" leaderboard (top 100 traders by profit over the
          last 30 days) -- not every Polymarket trader, and not an
          all-time ranking. Once we have that pool of 100 wallets, we
          independently score each one using their 90-day realized
          PnL history to compute Sirtio Score, which is a different
          window than the monthly pull used to find them.
        </p>
        <p className="text-muted/70 mb-10">
          Sirtio Score is built entirely from realized PnL -- average edge
          per position and total realized PnL magnitude, both damped
          by sample size --{" "}
          <Link href="/methodology" className="text-accent hover:underline">
            read the full methodology
          </Link>
          . It needs more resolved history to validate -- read it as
          directional, not precise. Names are shown as-is from
          Polymarket; click a wallet address to copy it, a trader's
          name to view their Sirtio profile, or "View on
          Polymarket" to see their public Polymarket profile.
        </p>

        {traders.length === 0 ? (
          <p className="text-muted">
            No trader data yet -- run the pipeline to populate data.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-[28px_1fr_90px] sm:grid-cols-[40px_360px_1fr_1fr] gap-3 sm:gap-6 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Trader</span>
              <span className="text-center">Sirtio Score</span>
              <span className="hidden sm:block text-center">Resolved Bets (Last 90D)</span>
            </div>
            {traders
              .filter((t) => t.pm_score !== null || t.position_count > 0)
              .map((t, i) => (
              <div key={t.wallet}
                className="grid grid-cols-[28px_1fr_90px] sm:grid-cols-[40px_360px_1fr_1fr] items-center gap-3 sm:gap-6 py-4 border-b border-hairline"
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
                  <span className="font-mono text-sm text-signal-yes">
                    {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                  </span>
                  {scoreTier(t.z_score) && (
                    <p className="text-xs text-muted mt-0.5">
                      {scoreTier(t.z_score)}
                    </p>
                  )}
                </div>
                <span className="hidden sm:block font-mono text-sm text-muted text-center">
                  {t.position_count}
                </span>
              </div>
            ))}
            {traders.some((t) => t.pm_score === null && t.position_count === 0) && (
              <p className="text-xs text-muted/70 leading-relaxed mt-6 pt-6 border-t border-hairline">
                Every trader beyond this rank does not currently meet
                the minimum requirements for a Sirtio Score. This can
                happen for a few reasons -- no resolved positions in
                the last 90 days, or trading activity consistent with
                automated/bot behavior, which we filter out before
                scoring. They remain part of Polymarket's tracked pool
                and may appear here once they qualify.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
