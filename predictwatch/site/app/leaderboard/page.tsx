import Link from "next/link";
import Nav from "@/components/Nav";
import CopyableWallet from "@/components/CopyableWallet";
import { getLeaderboard } from "@/lib/queries";
import { getDisplayName, polymarketProfileUrl } from "@/lib/format";

function formatVolume(v: number | null) {
  if (!v) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default async function LeaderboardPage() {
  const traders = await getLeaderboard(25);

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-parchment mb-2">
          Trader leaderboard
        </h1>
        <p className="text-muted mb-2">
          Polymarket only -- Kalshi doesn't expose public trader data.
        </p>
        <p className="text-xs text-muted mb-10">
          PM Score is a first-pass formula (win rate, edge, consistency,
          damped by sample size) --{" "}
          <Link href="/methodology" className="text-accent hover:underline">
            read the full methodology
          </Link>
          . It needs more resolved history to validate -- read it as
          directional, not precise. Names are shown as-is from
          Polymarket; click a wallet address to copy it, or a
          trader's name to view their public Polymarket profile.
        </p>

        {traders.length === 0 ? (
          <p className="text-muted">
            No trader data yet -- run the pipeline to populate data.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-[40px_1fr_100px_100px_100px] gap-6 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
              <span>#</span>
              <span>Trader</span>
              <span className="text-right">PM Score</span>
              <span className="text-right">Win rate</span>
              <span className="text-right">Volume</span>
            </div>
            {traders.map((t) => (
              <div
                key={t.wallet}
                className="grid grid-cols-[40px_1fr_100px_100px_100px] items-center gap-6 py-4 border-b border-hairline"
              >
                <span className="font-mono text-muted text-sm">
                  {String(t.rank).padStart(2, "0")}
                </span>
                <div>
                  
                    <a href={polymarketProfileUrl(t.wallet)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-parchment hover:text-accent transition-colors"
                  >
                    {getDisplayName(t.username, t.wallet)}
                  </a>
                  <div className="mt-1 flex items-center gap-2">
                    <CopyableWallet wallet={t.wallet} />
                    <span className="text-xs text-muted">
                      . {t.position_count} positions
                    </span>
                  </div>
                </div>
                <span className="font-mono text-sm text-signal-yes text-right">
                  {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                </span>
                <span className="font-mono text-sm text-muted text-right">
                  {t.win_rate !== null ? `${(t.win_rate * 100).toFixed(0)}%` : "--"}
                </span>
                <span className="font-mono text-sm text-muted text-right">
                  {formatVolume(t.volume)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

