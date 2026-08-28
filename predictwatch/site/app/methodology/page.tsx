import Link from "next/link";
import Nav from "@/components/Nav";
import { SCORE_TIER_CUTOFFS } from "@/lib/tiers";

// Tier rows for the methodology page's Tiers table, derived from
// SCORE_TIER_CUTOFFS (lib/tiers.ts) rather than a second hardcoded copy
// of the cutoffs -- if those numbers ever change, this table updates
// with them instead of silently drifting out of sync. Descriptions
// reuse the same wording as each tier's verdict text on the trader page
// (see traderSummary() in app/trader/[wallet]/page.tsx) so the site
// describes each tier the same way everywhere it appears.
const TIER_ROWS = [
  { name: "Elite", min: SCORE_TIER_CUTOFFS.elite, max: 100,
    description: "Ranks among the most skilled traders we track." },
  { name: "Great", min: SCORE_TIER_CUTOFFS.great, max: SCORE_TIER_CUTOFFS.elite - 1,
    description: "Has consistently outperformed the average tracked trader." },
  { name: "Good", min: SCORE_TIER_CUTOFFS.good, max: SCORE_TIER_CUTOFFS.great - 1,
    description: "Shows a real edge over the average tracked trader, though a more moderate one." },
  { name: "Break even", min: SCORE_TIER_CUTOFFS.breakEven, max: SCORE_TIER_CUTOFFS.good - 1,
    description: "Performs about in line with the average tracked trader. 50 is exact break-even." },
  { name: "Below average", min: SCORE_TIER_CUTOFFS.belowAverage, max: SCORE_TIER_CUTOFFS.breakEven - 1,
    description: "Has underperformed the average tracked trader over the window." },
  { name: "Poor", min: 0, max: SCORE_TIER_CUTOFFS.belowAverage - 1,
    description: "Has clearly underperformed the rest of the tracked pool." },
] as const;

export const metadata = {
  title: "Methodology",
  description:
    "How Sirtio Score works: a statistical model that separates real trading skill from lucky one-off bets, built on realized PnL and Bayesian shrinkage.",
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
      "How Sirtio Score works: a statistical model that separates real trading skill from lucky one-off bets, built on realized PnL and Bayesian shrinkage.",
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
          The Short Version
        </h2>
        <ul className="space-y-3 text-sm text-body leading-relaxed">
          <li className="flex gap-3">
            <span className="text-accent mt-1">-</span>
            <span>Only traders on Polymarket's own public Monthly top-100 leaderboard get tracked. We're not scanning every wallet on the platform.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent mt-1">-</span>
            <span>The score is computed from each wallet's last 90 days of <strong className="text-parchment">realized PnL</strong> -- actual closed-position dollars, not "win rate," which is easy to game and hard to define cleanly on Polymarket.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent mt-1">-</span>
            <span>A trader's raw average return gets blended toward the pool average, weighted by how much history they actually have. Three lucky trades won't outscore a long, consistent track record.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent mt-1">-</span>
            <span><strong className="text-parchment">50 is break-even.</strong> Above is a real, demonstrated edge; below isn't. <Link href="#tiers" className="text-accent hover:underline">Tiers</Link> (Elite down to Poor) are fixed points on that scale, not a guaranteed top-5%-gets-a-trophy ranking -- Elite can sit empty if nobody's earned it yet.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent mt-1">-</span>
            <span>Data refreshes roughly once a day. Exact formula, weights, and constants are kept private; the shape of the model is fully described below.</span>
          </li>
        </ul>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          The Model, In Plain Terms
        </h2>
        <p className="text-sm text-body leading-relaxed">
          Sirtio Score uses a statistical technique for estimating true
          skill from a limited, noisy sample. Each trader's raw average
          return gets blended toward the tracked pool's average,
          weighted by how much real history exists on that wallet -- a
          few lucky trades get pulled back toward average, while a
          long, consistent record gets judged mostly on its own
          numbers. The final score is how far that blended estimate
          sits from break-even, relative to how confident the model
          actually is in it. We keep the exact formula, weights, and
          constants private; what's above is the real shape of it, not
          a simplified stand-in.
        </p>

        <h2 id="tiers" className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6 scroll-mt-24">
          Tiers
        </h2>
        <p className="text-sm text-body leading-relaxed mb-6">
          Every trader with a computed Sirtio Score lands in one of six
          tiers, fixed at points along the 0-100 scale -- not a forced
          top-5%-gets-a-trophy ranking. A tier can sit empty if nobody in
          the current pool has actually earned it, or hold most of the
          pool if that's genuinely where performance clusters.
        </p>
        <div className="space-y-2">
          {TIER_ROWS.map((tier) => (
            <div key={tier.name}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 bg-surface-raised border border-accent/40 rounded-lg px-5 py-3"
            >
              <span className="font-[family-name:var(--font-title)] font-bold text-accent w-36 shrink-0">
                {tier.name}
              </span>
              <span className="font-mono text-xs text-muted w-16 shrink-0">
                {tier.min}-{tier.max}
              </span>
              <span className="text-sm text-body">{tier.description}</span>
            </div>
          ))}
        </div>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          Recent Changes
        </h2>
        <p className="text-sm text-body leading-relaxed">
          <strong className="text-parchment">Aug 26, 2026:</strong>{" "}
          fixed a bug where a losing position that got redeemed on
          Polymarket (settled for $0) was being counted as a win. Some
          traders' realized PnL dropped as a result -- correctly.{" "}
          <strong className="text-parchment">Aug 27, 2026:</strong>{" "}
          that fix surfaced a separate issue in the scoring math that
          was compressing every trader's score, so the top-ranked
          wallet on the site was reading well below what the data
          actually supported. Both are fixed; scores reflect real
          performance again, and tiers moved from a forced top-5%
          ranking to the fixed cutoffs described above.
        </p>

        <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mt-20 mb-6">
          What This Doesn't Do Yet
        </h2>
        <ul className="space-y-4 text-sm text-body leading-relaxed">
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Still young.</strong>{" "}
              This model has only been running against real data for a
              short time, and we're actively watching how it behaves.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Polymarket only.</strong>{" "}
              No cross-platform comparison.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-no mt-1">-</span>
            <span>
              <strong className="text-parchment">Directional, not precise.</strong>{" "}
              Read Sirtio Score as a sign one trader looks more skilled
              than another, not a confident ranking to the decimal.
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
