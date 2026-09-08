"""
Tests for sirtio_score.py's population bounding fix.

Background: re-running the pipeline against UNCHANGED underlying trade
data used to move traders between tiers anyway. Root cause: compute_
population_stats/compute_scores were fed the entire wallet_score_stats
cache, which only grows (a wallet's cache row is dropped only once ALL
its positions have aged out of the 90-day window -- see fetch_position_
returns), not just the currently-tracked wallet set. As more low-
position-count, no-longer-tracked wallets accumulated in that cache
across runs, they diluted std_z / collapsed tau2 (see compute_scores),
which steepened the score's logistic k and pushed unrelated, unchanged
traders' scores upward with zero new trading activity of their own --
confirmed live 2026-09-08 as one real Elite trader inflating to 10+
across repeated runs. population_for_scoring() fixes this by bounding
the population used for stats/k to all_wallets (leaderboard UNION
top-scored UNION followed -- itself bounded growth by construction, see
run_pipeline.py), not the raw cache.

These tests use compute_population_stats/compute_scores/
population_for_scoring directly with hand-built wallet_stats dicts, no
database needed -- both are pure functions of (n, sum_returns,
sumsq_returns) sufficient statistics.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sirtio_score import compute_population_stats, compute_scores, population_for_scoring


def wallet_stats(n, mean_return, variance=0.0, cost_per_position=100.0):
    """Build a wallet_score_stats-shaped dict with an exact sample mean/
    variance, so fixtures can be reasoned about directly instead of via
    a synthetic per-position list."""
    sum_returns = n * mean_return
    if n >= 2:
        sumsq_returns = variance * (n - 1) + (sum_returns ** 2) / n
    elif n == 1:
        sumsq_returns = (sum_returns ** 2) / n
    else:
        sumsq_returns = 0.0
    return {
        "n": n,
        "sum_returns": sum_returns,
        "sumsq_returns": sumsq_returns,
        "wallet_pnl": 0.0,
        "wallet_closed_cost": n * cost_per_position,
    }


def score_all(wallet_pool):
    mu, sigma2, tau2 = compute_population_stats(wallet_pool)
    results, k = compute_scores(wallet_pool, mu, sigma2, tau2)
    return {r["wallet"]: r["sirtio_score"] for r in results}, k


# A believable tracked population: one clear Elite performer, a spread
# of ordinary traders around break-even, and one clear laggard -- real
# variance in trader means, so tau2 > 0 and k calibrates normally.
TRACKED_WALLETS = {
    "elite_trader": wallet_stats(60, 40.0, 900.0),
    "good_trader": wallet_stats(40, 10.0, 900.0),
    "avg_trader_1": wallet_stats(30, 0.0, 900.0),
    "avg_trader_2": wallet_stats(30, 1.0, 900.0),
    "avg_trader_3": wallet_stats(30, -1.0, 900.0),
    "below_trader": wallet_stats(30, -10.0, 900.0),
    "poor_trader": wallet_stats(30, -20.0, 900.0),
}

ELITE_CUTOFF = 90  # mirrors site/lib/tiers.ts SCORE_TIER_CUTOFFS.elite


class PopulationForScoringTest(unittest.TestCase):
    def test_filters_to_tracked_wallets_only(self):
        cache = dict(TRACKED_WALLETS)
        cache["stale_untracked"] = wallet_stats(1, 0.0, 0.0)
        pool = population_for_scoring(cache, set(TRACKED_WALLETS))
        self.assertEqual(set(pool), set(TRACKED_WALLETS))

    def test_empty_all_wallets_falls_back_to_full_cache(self):
        # Documented fallback for the run where leaderboard/top-scored/
        # followed fetching all failed -- see run_pipeline.run().
        cache = dict(TRACKED_WALLETS)
        pool = population_for_scoring(cache, all_wallets=())
        self.assertEqual(pool, cache)


class ScoreStabilityUnderCacheGrowthTest(unittest.TestCase):
    """The regression this fix exists for: does re-running the scoring
    pipeline over unchanged tracked-trader data, as the wallet_score_
    stats cache accumulates more stale/untracked wallets over time,
    change anyone's score or tier?"""

    def setUp(self):
        self.all_wallets = set(TRACKED_WALLETS)
        # Simulates hundreds of wallets that were tracked at some past
        # point (so they got cached) but have since fallen out of the
        # leaderboard/top-scored/followed set -- exactly the kind of
        # row fetch_position_returns leaves in wallet_score_stats until
        # its positions fully age out of the 90-day window.
        self.stale_cache_growth = {
            f"stale_untracked_{i}": wallet_stats(1, 0.0, 0.0) for i in range(500)
        }

    def test_bounded_population_is_stable_as_cache_grows(self):
        cache_before = dict(TRACKED_WALLETS)
        cache_after = dict(TRACKED_WALLETS)
        cache_after.update(self.stale_cache_growth)

        pool_before = population_for_scoring(cache_before, self.all_wallets)
        pool_after = population_for_scoring(cache_after, self.all_wallets)
        self.assertEqual(pool_before, pool_after)

        scores_before, k_before = score_all(pool_before)
        scores_after, k_after = score_all(pool_after)

        self.assertEqual(scores_before, scores_after)
        self.assertEqual(k_before, k_after)
        # Sanity: the fixture actually produces an Elite trader, so this
        # test is exercising the tier boundary that was reported as
        # inflating, not an unrelated corner of the score range.
        self.assertGreaterEqual(scores_before["elite_trader"], ELITE_CUTOFF)

    def test_unbounded_population_would_have_drifted(self):
        """Documents the actual bug: feeding compute_population_stats/
        compute_scores the raw, unbounded cache (bypassing
        population_for_scoring) reproduces the reported symptom -- an
        unchanged Elite trader's score moving as unrelated stale wallets
        accumulate. If this assertion ever starts failing, it means the
        underlying compute_scores/compute_population_stats math stopped
        being population-size-sensitive and population_for_scoring's
        bounding may no longer be the load-bearing fix -- re-verify
        before removing it."""
        cache_before = dict(TRACKED_WALLETS)
        cache_after = dict(TRACKED_WALLETS)
        cache_after.update(self.stale_cache_growth)

        scores_before, _ = score_all(cache_before)
        scores_after, _ = score_all(cache_after)

        self.assertNotEqual(scores_before["elite_trader"], scores_after["elite_trader"])
        self.assertGreater(scores_after["elite_trader"], scores_before["elite_trader"])


if __name__ == "__main__":
    unittest.main()
