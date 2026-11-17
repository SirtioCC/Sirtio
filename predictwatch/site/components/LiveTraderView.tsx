import Link from "next/link";
import CopyableWallet from "@/components/CopyableWallet";
import FollowButton from "@/components/FollowButton";
import { polymarketProfileUrl, truncateWallet } from "@/lib/format";
import { scoreTier, MIN_POSITIONS_FOR_RANKING } from "@/lib/tiers";
import type { LiveLookupResult } from "@/lib/liveLookup";

function money(v: number): string {
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null): string {
  if (v === null) return "--";
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

/**
 * Trader page for a wallet that is NOT in the tracked pool. Same visual
 * language as the stored trader page, minus everything that needs saved
 * history (rank, 24h change, score-over-time, tracking-start dates).
 */
export default function LiveTraderView({ result }: { result: LiveLookupResult }) {
  const { wallet, score, positionCount, totalPositions, realizedPnl30d, partial } = result;
  const provisional = positionCount < MIN_POSITIONS_FOR_RANKING;
  const tier = !provisional ? scoreTier(score) : null;

  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <Link href="/leaderboard" className="text-sm text-accent hover:underline">
        --&gt; Back to leaderboard
      </Link>

      <div className="mt-6 flex items-start justify-between gap-8 flex-wrap">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl text-parchment">
              {truncateWallet(wallet)}
            </h1>
            <FollowButton wallet={wallet} />
          </div>
          <div className="flex items-center gap-3">
            <CopyableWallet wallet={wallet} />
            <a href={polymarketProfileUrl(wallet)} target="_blank" rel="noopener noreferrer"
              className="text-xs text-accent hover:underline">
              View on Polymarket
            </a>
          </div>
        </div>

        {tier && (
          <Link href="/methodology#tiers"
            className="bg-surface-raised border border-accent/40 hover:border-accent transition-colors rounded-lg px-6 py-3 text-center"
          >
            <p className="font-mono text-xs uppercase tracking-wide text-muted mb-1">Tier</p>
            <p className="font-[family-name:var(--font-title)] font-bold text-2xl text-accent">{tier}</p>
          </Link>
        )}
      </div>

      <div className="mt-6 max-w-3xl rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-parchment">
        <span className="font-mono text-xs uppercase tracking-wide text-accent mr-2">Live lookup</span>
        This wallet is not in Sirtio&apos;s tracked pool, so this score was
        calculated just now from Polymarket&apos;s public data and is not saved.
        It uses the same formula and the same population baseline as the
        leaderboard, but there is no rank, no history, and no 24h change.
        Follow this wallet to start tracking it.
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
        <div className="bg-surface-raised border border-accent/40 rounded-lg p-5 text-center">
          <p className="font-mono text-xs uppercase tracking-wide text-muted">Sirtio score</p>
          <p className="font-mono text-3xl text-accent">{score !== null ? score.toFixed(1) : "--"}</p>
          {provisional && score !== null && (
            <p className="text-xs text-muted mt-1">
              Provisional -- needs {MIN_POSITIONS_FOR_RANKING}+ resolved positions
            </p>
          )}
        </div>
        <div className="bg-surface-raised border border-accent/40 rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Avg edge (per position)</p>
          <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">{pct(result.avgEdgePct)}</p>
        </div>
        <div className="bg-surface-raised border border-accent/40 rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Realized PnL (30d)</p>
          <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">{money(realizedPnl30d)}</p>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted max-w-3xl">
        {positionCount} of {totalPositions} resolved positions in the last 30
        days count toward the score (positions under $25 or with extreme
        returns are excluded, same as the leaderboard).
        {partial && " This wallet has more than 1,000 resolved positions in 30 days, so only the most recent 1,000 were checked. High-volume wallets like this are often bots."}
        {" "}Population baseline from{" "}
        {new Date(result.poolComputedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
      </p>

      {score === null && (
        <p className="mt-6 text-sm text-parchment max-w-3xl">
          No qualifying resolved positions in the last 30 days, so there is
          nothing to score yet.
        </p>
      )}

      {result.positions.length > 0 && (
        <div className="mt-10 max-w-3xl">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-4">
            Recent resolved positions
          </h2>
          <ul className="divide-y divide-hairline border border-hairline rounded-lg">
            {result.positions.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      className="text-parchment hover:text-accent truncate block">{p.title}</a>
                  ) : (
                    <span className="text-parchment truncate block">{p.title}</span>
                  )}
                  <span className="text-xs text-muted">
                    {p.outcome ?? ""}{p.closedAt && ` · ${new Date(p.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  </span>
                </div>
                <div className="text-right shrink-0 font-mono">
                  <p className={p.realizedPnl >= 0 ? "text-accent" : "text-parchment"}>{money(p.realizedPnl)}</p>
                  <p className="text-xs text-muted">{pct(p.pctReturn)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
