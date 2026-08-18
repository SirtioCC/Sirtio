import Link from "next/link";
import Nav from "@/components/Nav";
import { getLeaderboard, getHeroStats } from "@/lib/queries";
import { getDisplayName } from "@/lib/format";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [leaderboard, stats] = await Promise.all([
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
            <p className="mt-4 text-sm text-muted/70 max-w-xl leading-relaxed">
              Not a $200/year copy-trade tool for whale hunters. Sirtio is
              for the casual trader who just wants to know who's actually
              good, so you can decide for yourself who to tail.
            </p>
            <div className="mt-10 flex gap-4">
              <Link
                href="/leaderboard"
                className="px-5 py-3 bg-accent text-ink font-medium rounded-md hover:opacity-90 transition-opacity"
              >
                See the leaderboard
              </Link>
            </div>

            {stats && (
              <div className="mt-16 grid grid-cols-2 gap-8 max-w-xl border-t border-hairline pt-8">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
                    {stats.total_positions.toLocaleString()}
                  </p>
                  <p className="text-sm text-muted mt-1">Positions analyzed</p>
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
            <div className="border border-accent/40 rounded-lg p-5">
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

      <footer className="max-w-6xl mx-auto px-6 py-12 text-sm text-muted">
        This is analytics, not betting advice. Sirtio Score is
        directional, not financial guidance.
      </footer>
    </div>
  );
}
