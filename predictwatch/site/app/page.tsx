import Link from "next/link";
import Nav from "@/components/Nav";
import ProbabilityBar from "@/components/ProbabilityBar";
import { getTopMarkets, getLeaderboard, getHeroStats } from "@/lib/queries";
import { getDisplayName, marketSourceUrl } from "@/lib/format";

function formatVolume(v: number | null) {
  if (!v) return "$0";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Exception: the hero "Volume tracked" total is large enough (billions)
// that the full number collides with the adjacent stat in the hero row
// layout -- abbreviated specifically for that one figure, everywhere
// else on the site shows full numbers.
function formatVolumeAbbreviated(v: number | null) {
  if (!v) return "$0";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default async function Home() {
  const [markets, leaderboard, stats] = await Promise.all([
    getTopMarkets(6),
    getLeaderboard(10),
    getHeroStats(),
  ]);

  return (
    <div className="min-h-screen">
      <Nav />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <div className="grid lg:grid-cols-[1fr_320px] gap-12 items-start">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent mb-6">
              Kalshi · Polymarket
            </p>
            <h1 className="font-[family-name:var(--font-title)] font-bold text-5xl md:text-6xl leading-[1.05] max-w-3xl text-parchment">
              Is this trader{" "}
              <span className="italic text-accent">actually good</span>, or did
              they get lucky?
            </h1>
            <p className="mt-6 text-lg text-muted max-w-xl">
              Every prediction-market leaderboard ranks by raw dollars, so
              one lucky bet looks the same as real skill. Sirtio Score
              doesn't fall for it. We statistically discount luck and
              reward consistency, so the traders on top actually earned it.
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
                    {formatVolumeAbbreviated(stats.total_volume)}
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
          </div>

          {leaderboard.length > 0 && (
            <div className="border border-hairline rounded-lg p-5">
              <div className="flex items-baseline justify-between mb-4">
                <p className="font-mono text-xs uppercase tracking-widest text-muted">
                  Top Traders
                </p>
                <Link href="/leaderboard" className="text-xs text-accent hover:underline">
                  Full leaderboard --&gt;
                </Link>
              </div>
              <div>
                {leaderboard.map((t) => (
                  <div
                    key={t.wallet}
                    className="flex items-center justify-between gap-3 py-2.5 border-b border-hairline last:border-b-0"
                  >
                    <Link href={`/trader/${t.wallet}`}
                      className="text-sm text-parchment hover:text-accent transition-colors truncate"
                    >
                      {getDisplayName(t.username, t.wallet)}
                    </Link>
                    <span className="font-mono text-sm text-signal-yes shrink-0">
                      {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted/70 mt-4 leading-relaxed">
                The Sirtio Score formula does a good job filtering out
                bot accounts, but nothing is perfect.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-hairline">
        <div className="flex items-baseline justify-between mb-8">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment">
            Most Active Markets
          </h2>
          <Link href="/markets" className="text-sm text-accent hover:underline">
            View all --&gt;
          </Link>
        </div>
        <div className="space-y-1">
          {markets.map((m) => (
            <div
              key={`${m.source}-${m.external_id}`}
              className="grid grid-cols-[1fr_70px] sm:grid-cols-[1fr_200px_90px] items-center gap-3 sm:gap-6 py-4 border-b border-hairline"
            >
              <div>
                <p className="text-parchment">{m.title}</p>
                <p className="text-xs text-muted mt-1 uppercase tracking-wide">
                  {m.source} · {formatVolume(m.volume)} vol
                  {marketSourceUrl(m.source, m.external_id, m.slug, m.title) && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={marketSourceUrl(m.source, m.external_id, m.slug, m.title)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline normal-case tracking-normal"
                      >
                        {m.source === "kalshi" ? "Search on Kalshi" : "View market"}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="hidden sm:block">
                <ProbabilityBar yesPriceCents={m.yes_price_cents} hidePrice />
              </div>
              <span className="font-mono text-sm tabular-nums text-parchment text-right">
                {m.yes_price_cents !== null ? `${Math.min(100, Math.max(0, m.yes_price_cents)).toFixed(0)}¢` : "--"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-12 text-sm text-muted">
        This is analytics, not betting advice. Sirtio Score is
        directional, not financial guidance.
      </footer>
    </div>
  );
}
