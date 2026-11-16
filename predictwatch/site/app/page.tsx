import Link from "next/link";
import Nav from "@/components/Nav";
import MarginTicker from "@/components/MarginTicker";
import { getLeaderboard, getHeroStats } from "@/lib/queries";
import { getDisplayName } from "@/lib/format";
import { isIndexableTrader, INDEXABLE_TRADER_LIMIT } from "@/lib/seo";
import { MIN_POSITIONS_FOR_RANKING } from "@/lib/tiers";
// Was force-dynamic (fresh Supabase query on every single request) --
// switched to a 5-minute revalidation window, same fix already applied
// to leaderboard/page.tsx and trader/[wallet]/page.tsx after those hit
// Supabase's free-tier egress cap. This is the site's actual entry
// point, so it was serving a fresh DB round-trip (getLeaderboard,
// getHeroStats, plus getLastRefresh via the shared Nav) to every single
// visitor and crawler -- the single largest remaining egress source.
export const revalidate = 300;

export default async function Home() {
  const [leaderboard, stats] = await Promise.all([
    getLeaderboard(100),
    getHeroStats(),
  ]);

  // Sidebar shows the first 10; the plain-HTML list below links every
  // top trader whose page is offered to search engines (lib/seo.ts).
  const topTen = leaderboard.slice(0, 10);
  const topTraders = leaderboard.filter(isIndexableTrader);

  return (
    <div className="min-h-screen">
      <Nav />
      <MarginTicker />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <div className="grid lg:grid-cols-[1fr_320px] gap-12 items-start">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent mb-6">
              Polymarket
            </p>
            <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl sm:text-5xl md:text-6xl leading-[1.1] sm:leading-[1.05] max-w-3xl text-parchment">
              Find the traders who actually know what they&apos;re doing.
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

          {topTen.length > 0 && (
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
                {topTen.map((t) => (
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
                Sirtio Score damps scores built on small sample sizes,
                but a short track record can still look better than
                it should.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12 border-t border-hairline">
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
          Why raw profit is a poor measure of skill
        </h2>
        <div className="space-y-4 text-sm text-body leading-relaxed">
          <p>
            Polymarket publishes a public leaderboard that ranks traders by
            profit. Profit is easy to count, but it hides how the money was
            made. A trader who placed three bets and won one large long shot
            can show the same total as a trader who made hundreds of small,
            well-priced trades across many kinds of markets. The first result
            may be luck. The second is much more likely to be skill. A list
            sorted only by dollars cannot tell them apart.
          </p>
          <p>
            Sirtio Score is built to fix that. It reads each wallet&apos;s
            realized PnL, which means only closed positions with a final
            result, over the last 30 days. It then estimates how much real
            edge sits behind those results. Traders with a short history are
            pulled back toward the pool average, so a few lucky trades cannot
            produce a top score. Traders with a long, consistent record are
            judged mostly on their own numbers.
          </p>
          <p>
            The score runs from 0 to 100. A score of 50 means break-even
            performance. Higher scores show a stronger, better-supported edge.
            A trader needs at least {MIN_POSITIONS_FOR_RANKING} resolved
            positions in the window to be ranked at all. Wallets below that
            line get a provisional score on their own profile page, but they
            do not appear on the leaderboard. Data refreshes about once a day.
          </p>
        </div>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-12 mb-6">
          How to use Sirtio
        </h2>
        <div className="space-y-4 text-sm text-body leading-relaxed">
          <p>
            Start with the{" "}
            <Link href="/leaderboard" className="text-accent hover:underline">
              leaderboard
            </Link>
            , which ranks tracked Polymarket wallets by Sirtio Score. Open any
            trader to see their resolved positions, best and worst trades,
            average return per position, and a plain-language summary of how
            their record compares with the rest of the tracked pool. If a high
            score rests on one trade, the profile says so.
          </p>
          <p>
            Read the{" "}
            <Link href="/methodology" className="text-accent hover:underline">
              methodology
            </Link>{" "}
            for the full description of the model, the tier system from Elite
            to Poor, and a dated list of changes. Sirtio is analytics, not
            advice. The score is a directional guide to who looks skilled, and
            past results do not promise future returns.
          </p>
        </div>
      </section>

      {topTraders.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12 border-t border-hairline">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-2">
            Top {Math.min(topTraders.length, INDEXABLE_TRADER_LIMIT)} Polymarket traders by Sirtio Score
          </h2>
          <p className="text-sm text-muted mb-6 max-w-2xl">
            Each profile lists the trader&apos;s resolved positions, realized
            PnL, and score history.
          </p>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {topTraders.map((t, i) => (
              <li
                key={t.wallet}
                className="flex items-center justify-between gap-3 py-2 border-b border-hairline"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-muted w-6 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Link
                    href={`/trader/${t.wallet}`}
                    className="text-sm text-parchment hover:text-accent transition-colors truncate"
                  >
                    {getDisplayName(t.username, t.wallet)}
                  </Link>
                </span>
                <span className="font-mono text-sm text-signal-yes shrink-0">
                  {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="max-w-6xl mx-auto px-6 py-12 text-sm text-muted">
        This is analytics, not betting advice. Sirtio Score is
        directional, not financial guidance.
      </footer>
    </div>
  );
}
