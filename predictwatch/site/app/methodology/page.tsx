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
