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
          model requires classifying a position as won or lost.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          The model
        </h2>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Sirtio Score is built on a statistical technique used across
          fields that face the same underlying problem: estimating
          someone's true skill from a limited, noisy sample. A handful
          of trades can look great by chance; a large, consistent track
          record is much harder to fake.
        </p>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Rather than scoring a trader's raw average return directly,
          the model blends it with what's typical across the whole
          tracked pool -- weighted by how much real history exists for
          that specific wallet. A trader with only a few resolved
          positions gets pulled closer to the pool average; a trader
          with a long, consistent record gets judged much more on
          their own numbers. The score is then based on how far that
          blended estimate sits from average, relative to how
          confident the model actually is in that estimate --
          rewarding traders who are both profitable and consistent,
          not just traders who got lucky once.
        </p>
        <p className="text-sm text-muted leading-relaxed">
          We're intentionally not publishing the exact formula, weights,
          or constants behind this -- see below. What's above is the
          real shape of how it works, not a simplification hiding
          something different underneath.
        </p>

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
          A trader who's statistically indistinguishable from the
          average tracked trader -- given how much history exists on
          them -- scores exactly{" "}
          <strong className="text-parchment">50</strong>. Scores above
          that reflect a trader the model is increasingly confident is
          outperforming; scores below reflect the opposite. Tier labels
          on the leaderboard (Elite, Great, Good, and so on) are set
          from the real distribution of scores across currently tracked
          traders, not fixed round numbers -- they get re-checked as
          more history accumulates.
        </p>

        <p className="text-xs text-muted leading-relaxed mb-12">
          The exact thresholds are still early -- this model has only
          been running against real data for a short time. As more
          resolved positions accumulate across more traders, the tier
          cutoffs get revisited against the real, current distribution
          rather than left as a first guess.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          What this doesn't do yet
        </h2>
        <ul className="space-y-4 text-sm text-muted leading-relaxed">
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Still young.</strong>{" "}
              The model started running against real data recently.
              Its behavior gets watched and re-checked as more history
              accumulates, the same way the score's tier cutoffs do.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Formula not public.</strong>{" "}
              We've described the real shape of the model above, but
              the exact formula, weights, and constants are kept
              private. That's a deliberate choice, not an attempt to
              seem more sophisticated than we are -- we'd rather be
              transparent about how it works in principle and protect
              the specifics.
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
