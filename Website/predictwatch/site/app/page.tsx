import Link from "next/link";
import Nav from "@/components/Nav";
import ProbabilityBar from "@/components/ProbabilityBar";
import { getTopMarkets, getLeaderboard, getHeroStats } from "@/lib/queries";
import { getDisplayName } from "@/lib/format";

function formatVolume(v: number | null) {
  if (!v) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default async function Home() {
  const [markets, leaderboard, stats] = await Promise.all([
    getTopMarkets(6),
    getLeaderboard(5),
    getHeroStats(),
  ]);

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <p className="font-mono text-xs uppercase tracking-widest text-accent mb-6">
          Kalshi · Polymarket
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-5xl md:text-6xl leading-[1.05] max-w-3xl text-parchment">
          Is this trader{" "}
          <span className="italic text-accent">actually good</span>, or did
          they get lucky?
        </h1>
        <p className="mt-6 text-lg text-muted max-w-xl">
          Every prediction-market leaderboard ranks by raw dollars. We rank by
          skill — win rate, consistency, and edge, weighted by how much
          history actually backs it up.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/leaderboard"
            className="px-5 py-3 bg-accent text-ink font-medium rounded-md hover:opacity-90 transition-opacity"
          >
            See the leaderboard
          </Link>
          <Link
            href="/markets"
            className="px-5 py-3 border border-hairline text-parchment rounded-md hover:border-muted transition-colors"
          >
            Browse markets
          </Link>
        </div>

        {stats && (
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-xl border-t border-hairline pt-8">
            <div>
              <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
                {stats.total_markets.toLocaleString()}
              </p>
              <p className="text-sm text-muted mt-1">Markets tracked</p>
            </div>
            <div>
              <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
                {formatVolume(stats.total_volume)}
              </p>
              <p className="text-sm text-muted mt-1">Volume tracked</p>
            </div>
            <div>
              <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
                {stats.total_traders}
              </p>
              <p className="text-sm text-muted mt-1">Traders watched</p>
            </div>
          </div>
        )}
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-hairline">
        <div className="flex items-baseline justify-between mb-8">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment">
            Most active markets
          </h2>
          <Link href="/markets" className="text-sm text-accent hover:underline">
            View all →
          </Link>
        </div>
        <div className="space-y-1">
          {markets.map((m) => (
            <div
              key={`${m.source}-${m.external_id}`}
              className="grid grid-cols-[1fr_auto_140px] items-center gap-6 py-4 border-b border-hairline"
            >
              <div>
                <p className="text-parchment">{m.title}</p>
                <p className="text-xs text-muted mt-1 uppercase tracking-wide">
                  {m.source} · {formatVolume(m.volume)} vol
                </p>
              </div>
              <ProbabilityBar yesPriceCents={m.yes_price_cents} />
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-hairline">
        <div className="flex items-baseline justify-between mb-8">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment">
            Top traders by skill
          </h2>
          <Link href="/leaderboard" className="text-sm text-accent hover:underline">
            Full leaderboard →
          </Link>
        </div>
        <div className="space-y-1">
          {leaderboard.map((t) => (
            <div
              key={t.wallet}
              className="grid grid-cols-[40px_1fr_100px_100px] items-center gap-6 py-4 border-b border-hairline"
            >
              <span className="font-mono text-muted text-sm">
                {String(t.rank).padStart(2, "0")}
              </span>
              <div>
                <p className="text-parchment">
                  {getDisplayName(t.username, t.wallet)}
                </p>
                <p className="text-xs text-muted mt-1">
                  {t.position_count} positions
                </p>
              </div>
              <span className="font-mono text-sm text-signal-yes">
                {t.pm_score !== null ? t.pm_score.toFixed(1) : "—"}
              </span>
              <span className="font-mono text-sm text-muted text-right">
                {formatVolume(t.pnl)} pnl
              </span>
            </div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-12 text-sm text-muted">
        Analytics, not betting advice. PM Score is directional, not
        financial guidance.
      </footer>
    </div>
  );
}
