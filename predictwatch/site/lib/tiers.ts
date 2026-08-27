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
export const SCORE_TIER_CUTOFFS = {
  elite: 90,
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
