import Link from "next/link";
import Nav from "@/components/Nav";

export const metadata = {
  title: "Methodology",
  description:
    "How Sirtio Score works: why realized PnL beats win-rate leaderboards, how bot and market-maker wallets get filtered out, and how trader skill is separated from luck.",
};

export default function MethodologyPage() {
  // Article schema: this page is explanatory long-form content, not a
  // data listing (that's what the trader/leaderboard pages' Person/
  // ProfilePage schema is for). Article is the correct schema.org type
  // for "how this works" content and is what search engines look for
  // to potentially surface this as a rich result / knowledge snippet.
  const methodologyJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Profit Isn't Proof: How Sirtio Score Works",
    description:
      "How Sirtio Score works: why realized PnL beats win-rate leaderboards, how bot and market-maker wallets get filtered out, and how trader skill is separated from luck.",
    author: {
      "@type": "Organization",
      name: "Sirtio",
      url: "https://www.sirtio.com",
    },
    publisher: {
      "@type": "Organization",
      name: "Sirtio",
    },
    mainEntityOfPage: "https://www.sirtio.com/methodology",
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(methodologyJsonLd) }}
      />
      <section className="max-w-3xl mx-auto px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-accent mb-6">
          Methodology
        </p>
        <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl md:text-5xl leading-tight text-parchment mb-8">
          Profit Isn't Proof
        </h1>
        <p className="text-lg text-body leading-relaxed">
          Every other prediction-market leaderboard sorts by total profit.
          That rewards one thing: having made money. It doesn't tell you
          whether that money came from real skill or one enormous lucky
          bet. Sirtio Score is our attempt to tell the difference.
        </p>

        <div className="mt-16 grid md:grid-cols-2 gap-6">
          <div className="bg-surface-raised rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-wide text-muted mb-3">
              Trader A
            </p>
            <p className="font-[family-name:var(--font-display)] italic text-3xl text-signal-yes mb-2">
              +$500,000
            </p>
            <p className="text-sm text-body leading-relaxed">
              One long-shot bet on a single election market. Got it
              right. Total career trades: 3.
            </p>
          </div>
          <div className="bg-surface-raised rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-wide text-muted mb-3">
              Trader B
            </p>
            <p className="font-[family-name:var(--font-display)] italic text-3xl text-signal-yes mb-2">
              +$500,000
            </p>
            <p className="text-sm text-body leading-relaxed">
              A steady 8% edge across 1,400 trades over a year, spanning
              a dozen categories.
            </p>
          </div>
        </div>
        <p className="text-sm text-body mt-6 leading-relaxed">
          Same profit. A raw-PnL leaderboard ranks them the same.
          Trader B is the one worth paying attention to. Sirtio Score
          exists to tell them apart.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          Where This Data Comes From
        </h2>
        <p className="text-sm text-body leading-relaxed mb-4">
          Every trader on the leaderboard first has to appear on
          Polymarket's own public Monthly leaderboard, their top
          traders ranked by profit over the trailing 30 days. We don't
          scan every wallet on Polymarket. We only see traders
          Polymarket itself surfaces as recent top performers.
        </p>
        <p className="text-sm text-body leading-relaxed mb-4">
          Once a wallet shows up there, we look at its own trading
          history, specifically resolved positions from the last 90
          days, and compute Sirtio Score from that. That's
          independent of how it ranked on Polymarket's monthly list,
          so the two windows don't line up exactly. A wallet can be a
          strong monthly performer and a weaker 90-day one, or the
          other way around.
        </p>
        <p className="text-sm text-body leading-relaxed mb-4">
          We also filter out likely bot and market-making wallets
          before scoring. A wallet with an extreme number of resolved
          positions or trade events in the window isn't a human
          placing predictions. It's almost certainly a script. Wallets
          that cross that line have their data collection cut off
          early rather than fully processed, so a "3,000+" count for
          one of these wallets reflects that cutoff, not their true
          total.
        </p>
        <p className="text-sm text-body leading-relaxed mb-4">
          A trader missing from this list isn't necessarily unskilled.
          It may just mean they didn't crack Polymarket's own
          top-ranked cutoff at the time we checked. This leaderboard
          is a snapshot of the strongest recent performers among
          Polymarket's own top-ranked traders, not a full ranking of
          every trader on the platform.
        </p>
        <p className="text-sm text-body leading-relaxed">
          Data refreshes every 2 hours through our automated
          pipeline, so rankings reflect a recent snapshot, not
          real-time trading.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          Redefined Around Realized PnL Only
        </h2>
        <p className="text-sm text-body leading-relaxed mb-4">
          Earlier versions of this score used a "win rate" component
          that counted how often a trader's positions resolved in
          their favor. We removed it. The problem was never measuring
          accuracy itself. It's that classifying a position as cleanly
          "won" or "lost" depends on Polymarket's settlement and
          redemption mechanics, and those don't always track position
          state cleanly. A position a trader exited early, or a market
          that resolved in an unusual way, can get miscounted. This is
          a well-documented problem in the prediction-market data
          community. We didn't run into it alone.
        </p>
        <p className="text-sm text-body leading-relaxed">
          Realized PnL sidesteps that problem. It's a continuous
          dollar value that's always well-defined once a position
          closes, no matter how or why it closed. Nothing in the
          current model requires calling a position a win or a loss.
        </p>
        <p className="text-sm text-body leading-relaxed mt-4">
          That also means losses get captured with the same rigor as
          wins, and shown just as visibly, on every trader's page.
          Most prediction-market leaderboards effectively only show
          you winners. A redeemed win produces a clean, satisfying
          line item. A position sold early at a loss just looks like
          an ordinary trade, easy to miss among dozens of others.
          We've checked this directly against real wallets: a $1,834
          loss on an early tennis exit, a $2 test bet sitting next to
          a $50,000-plus position on the same wallet, partial sells
          that net to a loss even when the full position ended up
          profitable. Every trader page shows a Top 5 Wins and Top 5
          Losses breakdown so you see the losses too, not just the
          highlight reel.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          The Model
        </h2>
        <p className="text-sm text-body leading-relaxed mb-4">
          Sirtio Score is built on a statistical technique used across
          fields that face the same problem: estimating someone's true
          skill from a limited, noisy sample. A handful of trades can
          look great by chance. A large, consistent track record is
          much harder to fake.
        </p>
        <p className="text-sm text-body leading-relaxed mb-4">
          Instead of scoring a trader's raw average return directly,
          the model blends it with what's typical across the whole
          tracked pool, weighted by how much real history exists for
          that wallet. A trader with only a few resolved positions
          gets pulled closer to the pool average. A trader with a
          long, consistent record gets judged mostly on their own
          numbers. The score reflects how far that blended estimate
          sits from average, relative to how confident the model
          actually is in that estimate. That rewards traders who are
          both profitable and consistent, and it doesn't reward a
          trader who just got lucky once.
        </p>
        <p className="text-sm text-body leading-relaxed">
          We're keeping the exact formula, weights, and constants
          private. What's above is the real shape of how it works, not
          a simplified version hiding something different.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          How to Read Your Score
        </h2>
        <p className="text-sm text-body leading-relaxed mb-6">
          A trader who's statistically indistinguishable from the
          average tracked trader, given how much history exists on
          them, scores exactly{" "}
          <strong className="text-parchment">50</strong>. Scores above
          that mean the model is increasingly confident the trader is
          outperforming. Scores below mean the opposite. Tier labels
          on the leaderboard (Elite, Great, Good, and so on) are set
          from the real distribution of scores across currently
          tracked traders, not fixed round numbers. They get
          rechecked as more history builds up.
        </p>

        <p className="text-xs text-body leading-relaxed mb-12">
          The exact thresholds are still early. This model has only
          been running against real data for a short time. As more
          resolved positions build up across more traders, the tier
          cutoffs get checked again against the real, current
          distribution instead of staying a first guess.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          What This Doesn't Do Yet
        </h2>
        <ul className="space-y-4 text-sm text-body leading-relaxed">
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Still young.</strong>{" "}
              The model started running on real data recently. We're
              watching how it behaves and rechecking it as more
              history builds up, the same way the tier cutoffs get
              rechecked.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Formula not public.</strong>{" "}
              We've described the real shape of the model above, but
              we're keeping the exact formula, weights, and constants
              private. That's a deliberate choice, not an attempt to
              look more sophisticated than we are. We'd rather be
              honest about how it works in principle and keep the
              specifics to ourselves.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Polymarket only.</strong>{" "}
              There's no cross-platform comparison. Only Polymarket
              wallets get scored.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Directional, not precise.</strong>{" "}
              Read Sirtio Score as a sign that one trader looks more
              skilled than another, not as a confident ranking down to
              the decimal.
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
