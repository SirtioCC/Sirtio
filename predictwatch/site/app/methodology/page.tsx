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
          one enormous lucky bet. PM Score is our attempt to separate
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
          Trader B is the one worth paying attention to -- PM Score is
          built to tell them apart.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-8">
          Four ingredients
        </h2>

        <div className="space-y-8">
          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Win rate</p>
              <p className="font-mono text-sm text-accent">40%</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Not a simple count of wins. Each position is weighted by
              the market's uncertainty at the price the trader
              entered -- using Shannon entropy, maximal at a 50c
              coin-flip price and near-zero close to 0c or 100c. A
              trader who racks up an easy 90% win rate on obvious
              favorites, but is wrong most of the time on the few
              genuinely uncertain calls they make, ends up scored much
              closer to their real skill level instead of an inflated
              headline number.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Average edge</p>
              <p className="font-mono text-sm text-accent">35%</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Mean return per resolved position. A trader who wins
              small and loses big can have a good win rate and still be
              a bad bet -- average edge catches that. Normalized to a
              0-1 scale before weighting, so one extreme outlier trade
              can't single-handedly dominate the score.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Consistency</p>
              <p className="font-mono text-sm text-accent">25%</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Derived from the standard deviation of returns across all
              positions -- a lower spread scores higher. This is the
              piece that specifically penalizes Trader A above: a
              single huge swing looks bad here even if it happened to
              pay off.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Sample-size damping</p>
              <p className="font-mono text-sm text-accent">multiplier</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              The three scores above get multiplied by
              min(positions / 30, 1) -- a trader with 3 resolved
              positions can't outrank one with 300, no matter how
              clean those 3 look. This is the direct fix for
              survivorship bias: without it, small sample sizes would
              dominate the top of the board by chance alone.
            </p>
          </div>

          <div className="border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-parchment font-medium">Rolling window</p>
              <p className="font-mono text-sm text-accent">last 90 days</p>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Only positions that resolved in the last 90 days count
              toward the score. A deliberately conservative starting
              point -- recent form only, until there's enough real
              data flowing through the pipeline to trust widening it.
              This will likely expand over time as more history
              accumulates.
            </p>
          </div>
        </div>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          The formula
        </h2>
        <div className="bg-surface border border-hairline rounded-lg p-6 font-mono text-xs text-muted leading-relaxed overflow-x-auto">
          <pre>{`entropy(p) = -(p * ln(p) + (1-p) * ln(1-p))   // per position, p = entry price

win_rate = sum(entropy(p) for wins) / sum(entropy(p) for all positions)

score = (win_rate x 40)
      + (normalized_avg_edge x 35)
      + (consistency x 25)

PM Score = score x min(resolved_positions / 30, 1)`}</pre>
        </div>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          How to read your score
        </h2>
        <p className="text-sm text-muted leading-relaxed mb-6">
          A truly breakeven trader with zero real edge -- 50% weighted win
          rate, 0% average return -- doesn't score 50. They score{" "}
          <strong className="text-parchment">37.5</strong>. Here's why: in
          an efficient market, buying "Yes" at 60&cent; means winning 60% of
          the time by definition, not by skill. Weight that by entropy and
          average across a balanced set of trades, and a no-skill trader's
          win rate converges to 50% purely by symmetry -- so 20 of the 40
          win-rate points are "free," just for existing. The other two
          components punish that trader hard: 0% edge gets half credit
          (17.5 of 35), and consistency drops to <strong className="text-parchment">zero</strong>{" "}
          -- prediction-market payouts are inherently binary, so without a
          real, sizeable edge, the formula can't call anything
          "consistent." <strong className="text-parchment">37.5 is the
          mathematical floor for looking average.</strong> Real skill has
          to clear that bar, not just cross 50.
        </p>

        <div className="flex h-3 rounded-full overflow-hidden mb-3">
          <div className="bg-signal-no" style={{ width: "25%" }} />
          <div className="bg-hairline" style={{ width: "15%" }} />
          <div className="bg-accent" style={{ width: "20%" }} />
          <div className="bg-signal-yes opacity-60" style={{ width: "20%" }} />
          <div className="bg-signal-yes" style={{ width: "20%" }} />
        </div>
        <div className="grid grid-cols-5 gap-2 text-xs text-muted mb-12">
          <div>
            <p className="text-parchment font-medium">0-25</p>
            <p>Losing</p>
          </div>
          <div>
            <p className="text-parchment font-medium">25-40</p>
            <p>Around breakeven</p>
          </div>
          <div>
            <p className="text-parchment font-medium">40-60</p>
            <p>Real edge</p>
          </div>
          <div>
            <p className="text-parchment font-medium">60-80</p>
            <p>Strong</p>
          </div>
          <div>
            <p className="text-parchment font-medium">80-100</p>
            <p>Elite</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="border border-hairline rounded-lg p-5">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-parchment font-medium">Bad trader</p>
              <p className="font-mono text-xl text-signal-no">24.5</p>
            </div>
            <p className="text-xs text-muted font-mono">
              35% win rate &middot; -40% avg edge &middot; 60% stdev
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-parchment font-medium">Breakeven trader</p>
              <p className="font-mono text-xl text-muted">37.5</p>
            </div>
            <p className="text-xs text-muted font-mono">
              50% win rate &middot; 0% avg edge &middot; 80% stdev
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-parchment font-medium">Good trader</p>
              <p className="font-mono text-xl text-accent">59.7</p>
            </div>
            <p className="text-xs text-muted font-mono">
              60% win rate &middot; +30% avg edge &middot; 15% stdev
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-5">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-parchment font-medium">Elite trader</p>
              <p className="font-mono text-xl text-signal-yes">74.8</p>
            </div>
            <p className="text-xs text-muted font-mono">
              75% win rate &middot; +60% avg edge &middot; 20% stdev
            </p>
          </div>
        </div>

        <p className="text-xs text-muted leading-relaxed mb-12">
          These bands are derived analytically from the formula itself --
          they haven't been validated against the real distribution of
          actual Polymarket traders yet, since that requires more
          accumulated history than the site has today. Once there's
          enough data across enough traders, the better long-term approach
          is switching to percentile-based bands ("top 10% of tracked
          traders") instead of these fixed cutoffs, since that
          self-calibrates to reality instead of resting on assumed inputs.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          What this doesn't do yet
        </h2>
        <ul className="space-y-4 text-sm text-muted leading-relaxed">
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Not backtested.</strong>{" "}
              The weights above (40/35/25) are a reasonable starting
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
              <strong className="text-parchment">
                Entropy-weighting has one blind spot.
              </strong>{" "}
              If a trader's entire history sits at one price level --
              all obvious bets, or all coin-flips -- the weighting can't
              tell those portfolios apart on win rate alone, since
              weighting a uniform set of outcomes by a constant changes
              nothing. Average edge (the return-magnitude component)
              is what catches that case instead: an all-obvious-wins
              portfolio nets tiny returns, an all-coin-flip-wins
              portfolio nets large ones, even at an identical win rate.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">
                Consistency can still favor "safe" traders.
              </strong>{" "}
              Even with entropy-weighted win rate, the consistency
              component (25% weight) rewards low-variance returns --
              and genuine coin-flip betting is inherently higher
              variance than sticking to safe favorites, even when the
              trader is actually good at reading close calls. A steady
              stream of small, obvious wins can currently out-score a
              genuinely skilled coin-flip trader through this
              component. Properly fixing this likely means moving to
              a calibration-based score (e.g. Brier or log score)
              instead of a variance-based one -- a bigger change, not
              done yet.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Directional, not precise.</strong>{" "}
              Read PM Score as "this trader looks more skilled than that
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

