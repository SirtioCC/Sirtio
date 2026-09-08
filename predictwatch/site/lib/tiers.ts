// Sirtio Score tiers, fixed on the 0-100 display score -- rewritten
// 2026-08-27, replacing the percentile-of-z_score cutoffs that used to
// live behind getScoreTierCutoffs() in lib/queries.ts (a live
// PERCENTILE_CONT query, removed entirely now that cutoffs are
// constants). Percentile tiering guaranteed a top 5% "Elite" no matter
// how the pool actually performed -- after REDEEM events (2026-08-26)
// dragged real scores down site-wide, that meant traders in the low
// 60s were reading as "Elite," which isn't meaningful against a scale
// where 50 is genuine break-even.
//
// Fixed cutoffs directly on raw z_score were considered and rejected:
// z is a real per-trader t-statistic, but empirically nowhere near
// standard-normal across the population (confirmed live 2026-08-27:
// range -755 to +23, stdev ~74 pre-fix), so canonical normal critical
// values on z don't mean what they'd mean in a textbook. The 0-100
// score is different -- it's specifically engineered (see
// compute_scores in pipeline/sirtio_score.py) so a logistic steepness
// k auto-recalibrates against the population's current z spread every
// pipeline run, keeping the score well-scaled regardless of how wild
// the underlying z distribution gets. z = 0 (a real 0% shrunk edge)
// stays hard-anchored to score 50 no matter what, so fixed cutoffs on
// the score have a stable meaning across time in a way fixed cutoffs
// on raw z never did.
//
// These specific numbers were checked against the live population
// (2026-08-27, after also raising sirtio_score.py's MIN_TRADER_VARIANCE
// floor -- see that file for why that fix has to land alongside this
// one) and produce a believable shape: ~1% Elite, ~6% Great, ~16% Good,
// ~64% Break even (the honest majority given how small most trader's
// n_i still is), ~4% Below average, ~9% Poor.
//
// elite RAISED 90 -> 96 on 2026-09-08. That 08-27 shape assumed a small,
// early tracked population; three weeks of leaderboard discovery grew
// it to 165+ real wallets, and the Elite count grew right along with it
// (1 -> 10+ -> 22) even AFTER fixing a separate real bug where
// compute_scores/compute_population_stats (pipeline/sirtio_score.py)
// were calibrated against wallet_score_stats' full, ever-growing cache
// instead of the currently-tracked set (see population_for_scoring) --
// that fix stopped the score from drifting on unchanged data, but did
// NOT reduce the Elite count, because the count was never inflated by
// noise. Verified directly against the raw ledger (trader_realized_
// pnl_events) for the top "Elite" wallets: real trades, $500-2,000+
// cost basis, buying in the $0.27-0.53 range and closing near
// resolution -- genuine, replicable edge, not a computation artifact.
// So the fix here isn't to the math, it's to a stale constant: with the
// population's real distribution now this much bigger, re-checking it
// (same exercise as 08-27) found 90 no longer sits on any real
// boundary -- it cuts through a dense, continuous run of scores
// (88-91) with no gap in sight. The scores DO have one clear structural
// break: a 13-wallet cluster from 96.1-99.6, then a real ~3.5-point
// gap down to 92.6 and a smooth continuum below that. 96 sits in that
// gap, so Elite means "in that distinct top cluster" again rather than
// an arbitrary point mid-continuum. Deliberately NOT re-derived as a
// fixed top-N% of today's population -- pinning to a percentage is the
// same mistake the pre-08-27 percentile scheme made (see top of file),
// just recomputed by hand instead of live SQL. This cutoff will need
// the same live re-check again as the tracked population keeps
// maturing; it is a snapshot-calibrated constant, not a self-updating
// one.
export const SCORE_TIER_CUTOFFS = {
  elite: 96,
  great: 75,
  good: 60,
  breakEven: 40,
  belowAverage: 25,
} as const;

// null (no score computed yet -- a wallet with no resolved positions)
// degrades to no tier shown, not a crash or a fake "Poor" label.
export function scoreTier(score: number | null): string | null {
  if (score === null) return null;
  if (score >= SCORE_TIER_CUTOFFS.elite) return "Elite";
  if (score >= SCORE_TIER_CUTOFFS.great) return "Great";
  if (score >= SCORE_TIER_CUTOFFS.good) return "Good";
  if (score >= SCORE_TIER_CUTOFFS.breakEven) return "Break even";
  if (score >= SCORE_TIER_CUTOFFS.belowAverage) return "Below average";
  return "Poor";
}
