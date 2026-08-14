import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import { getLeaderboard } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";

// Sirtio Score is built so 50 represents a truly break-even trader
// (0% avg edge, $0 realized PnL) at full sample size -- see
// methodology's formula section. Sample-size damping only ever pulls
// a score DOWN from there, never up, so these bands are read directly
// against the final (already-damped) score shown on the page.
function scoreTier(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 80) return "Elite";
  if (score >= 65) return "Great";
  if (score >= 55) return "Good";
  if (score >= 45) return "Break even";
  if (score >= 25) return "Below average";
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
            <div className="grid grid-cols-[40px_1fr_150px_140px] gap-6 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Trader</span>
              <span className="text-right">Sirtio Score</span>
              <span className="text-right">Predictions (Last 90D)</span>
            </div>
            {traders.map((t, i) => (
              <div key={t.wallet}
                className="grid grid-cols-[40px_1fr_150px_140px] items-center gap-6 py-4 border-b border-hairline"
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
                <div className="text-right">
                  <span className="font-mono text-sm text-signal-yes">
                    {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                  </span>
                  {scoreTier(t.pm_score) && (
                    <p className="text-xs text-muted mt-0.5">
                      {scoreTier(t.pm_score)}
                    </p>
                  )}
                </div>
                <span className="font-mono text-sm text-muted text-right">
                  {t.position_count}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
