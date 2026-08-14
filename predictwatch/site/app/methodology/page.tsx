import Link from "next/link";
import Nav from "@/components/Nav";

export default function MethodologyPage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-3xl mx-auto px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-accent mb-6">
          Methodology
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl leading-tight text-parchment mb-8">
          Why we don't just rank by dollars
        </h1>
        <p className="text-lg text-muted leading-relaxed">
          Every other prediction-market leaderboard sorts by total profit.
          That rewards exactly one thing: having made money. It says
          nothing about whether that money came from real skill or from
          one enormous lucky bet. Sirtio Score is our attempt to separate
          the two.
        </p>

        <div className="mt-16 grid md:grid-cols-2 gap-6">
          <div className="border border-hairline rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-wide text-muted mb-3">
              Trader A
            </p>
            <p className="font-[family-name:var(--font-display)] text-3xl text-signal-yes mb-2">
              +$500,000
            </p>
            <p className="text-sm text-muted leading-relaxed">
              One long-shot bet on a single election market. Got it
              right. Total career trades: 3.
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-wide text-muted mb-3">
              Trader B
            </p>
            <p className="font-[family-name:var(--font-display)] text-3xl text-signal-yes mb-2">
              +$500,000
            </p>
            <p className="text-sm text-muted leading-relaxed">
              A steady 8% edge across 1,400 trades over a year, spanning
              a dozen categories.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted mt-6 leading-relaxed">
          Same profit. A raw-PnL leaderboard ranks them identically.
          Trader B is the one worth paying attention to -- Sirtio Score is
          built to tell them apart.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          Where this data comes from
        </h2>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Every trader on the leaderboard first had to appear on
          Polymarket's own public Monthly leaderboard -- their top 100
          traders ranked by profit over the trailing 30 days. We don't
          scan every wallet on Polymarket; we only see traders who
          Polymarket itself surfaces as recent top performers by that
          measure.
        </p>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Once we have those 100 wallets, we look at each one's own
          trading history -- specifically, resolved positions from the
          last 90 days -- and compute Sirtio Score from that, independent
          of how they ranked on Polymarket's monthly list. That means
          the two windows don't match exactly: a wallet could be a
          strong monthly performer but a weaker 90-day one, or vice
          versa within the pool.
        </p>
        <p className="text-sm text-muted leading-relaxed mb-4">
          We also filter out likely bot / market-making wallets before
          scoring. A wallet with an extreme number of resolved
          positions or trade events in the window isn't a human placing
          predictions -- it's almost certainly a script. Wallets that
          cross that line have their data collection cut off early
          rather than fully processed, so a "3,000+" style count for
          one of these wallets reflects that cutoff, not their true
          total.
        </p>
        <p className="text-sm text-muted leading-relaxed mb-4">
          A trader not appearing here doesn't mean they're not
          skilled -- it may just mean they didn't crack Polymarket's
          own top-100-by-monthly-profit cutoff. This leaderboard is a
          snapshot of the strongest recent performers among
          Polymarket's own top-ranked traders, not a comprehensive
          ranking of every trader on the platform.
        </p>
        <p className="text-sm text-muted leading-relaxed">
          Data refreshes once daily via our automated pipeline -- so
          rankings reflect the most recent daily snapshot, not
          real-time trading.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          Redefined around realized PnL only
        </h2>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Earlier versions of this score used a "win rate" component --
          counting how often a trader's positions resolved in their
          favor. We removed it entirely. The problem isn't the concept
          of measuring accuracy; it's that classifying any individual
          position as cleanly "won" or "lost" depends on Polymarket's
          settlement and redemption mechanics, which don't always
          cleanly track position state -- a position a trader exited
          early, or a market that resolved in an unusual way, can be
          miscounted. This is a well-documented, independently-observed
          problem in the prediction-market data community, not
          something we ran into alone.
        </p>
        <p className="text-sm text-muted leading-relaxed">
          Realized PnL sidesteps this entirely: it's a continuous dollar
          value that's always well-defined once a position closes,
          regardless of how or why it closed. Nothing in the current
          formula requires classifying a position as won or lost.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-8">
          Two ingredients
        </h2>

        <div className="space-y-8">
          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Average edge</p>
              <p className="font-mono text-sm text-accent">50%</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Mean percent return per resolved position, over the last
              90 days. This measures the quality of each individual
              trade -- did this position return more than it cost,
              proportionally -- independent of how large or small the
              position was.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Realized PnL magnitude</p>
              <p className="font-mono text-sm text-accent">50%</p>
            </div>
            <p className="text-sm text-muted leading-relaxed mb-3">
              Total dollar-realized PnL over the last 90 days, sign-
              preserving log-compressed. Real tracked wallets span an
              enormous range -- from -$49.5M to +$16.1M -- so a plain
              linear scale would let one extreme wallet dominate the
              entire leaderboard's spread. A signed log transform keeps
              the ordering intact (more profit still scores higher)
              while compressing the scale so mid-sized traders remain
              meaningfully differentiated too.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              This is the piece that directly honors "realized PnL" as
              the core signal, rather than just a normalized percentage
              -- a trader who's actually made real, substantial money
              scores meaningfully higher than one who hasn't, even at
              a similar average edge.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Sample-size damping</p>
              <p className="font-mono text-sm text-accent">multiplier</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Both components above get multiplied by
              min(positions / 30, 1) -- a trader with 1 resolved
              position and a huge lucky win still gets crushed down to
              a low score (verified: +$5M on a single trade with a
              500% edge scores 3.1, not close to the top), no matter
              how good that one trade looks. This is the direct fix
              for survivorship bias and one-hit wonders.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Rolling window</p>
              <p className="font-mono text-sm text-accent">last 90 days</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Only positions that resolved in the last 90 days count
              toward the score -- recent form only, since Polymarket's
              APIs don't reliably retain a trader's full historical
              record indefinitely.
            </p>
          </div>
        </div>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          The formula
        </h2>
        <div className="bg-surface border border-hairline rounded-lg p-6 font-mono text-xs text-muted leading-relaxed">
          <p className="text-center py-6">
            [ formula hidden for now -- coming soon ]
          </p>
        </div>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          How to read your score
        </h2>
        <p className="text-sm text-muted leading-relaxed mb-6">
          A breakeven trader -- 0% average edge, $0 total realized PnL --
          scores exactly <strong className="text-parchment">50</strong>,
          the same clean midpoint property the previous formula had.
          Verified against the same documented test case that motivated
          the original entropy-weighting fix: a trader holding 30
          identical "obvious" 97c wins (tiny edge, tiny total PnL) now
          scores <strong className="text-parchment">59.3</strong>, while
          a genuinely skilled trader who won 25 of 30 real coin-flip
          bets (real edge, real total PnL) scores{" "}
          <strong className="text-parchment">78.2</strong> -- still
          correctly favoring real skill, even with win rate removed
          from the formula entirely.
        </p>

        <p className="text-xs text-muted leading-relaxed mb-12">
          These specific numbers are illustrative, not validated
          thresholds -- they haven't been checked against the real
          distribution of actual Polymarket traders yet, since that
          requires more accumulated history than the site has today.
          Once there's enough data across enough traders, the better
          long-term approach is switching to percentile-based bands
          instead of any fixed formula-derived cutoffs.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          What this doesn't do yet
        </h2>
        <ul className="space-y-4 text-sm text-muted leading-relaxed">
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Not backtested.</strong>{" "}
              The weights above (50/50) are a reasonable starting
              point, not a validated model. They need to be checked
              against real outcomes over time before they should be
              treated as precise.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Polymarket only.</strong>{" "}
              Kalshi doesn't expose public trader data, so there's
              no cross-platform trader comparison -- only Polymarket
              wallets are scored.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Directional, not precise.</strong>{" "}
              Read Sirtio Score as "this trader looks more skilled than that
              one," not as a confident numeric ranking down to the
              decimal.
            </span>
          </li>
        </ul>

        <div className="mt-16 pt-8 border-t border-hairline">
          <Link href="/leaderboard" className="text-accent hover:underline">
            {String.fromCharCode(8592)} Back to the leaderboard
          </Link>
        </div>
      </section>
    </div>
  );
}
