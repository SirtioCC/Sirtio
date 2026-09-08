"""Tests for recalibrate_tiers.py's pure gap-detection and file-editing
logic -- no database needed, both operate on plain data/strings."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from recalibrate_tiers import (
    AUTO_BLOCK_START,
    apply_new_elite_cutoff,
    find_elite_cutoff,
    read_current_cutoffs,
)

SAMPLE_TIERS_TS = """// some history comment
// more history

export const SCORE_TIER_CUTOFFS = {
  elite: 96,
  great: 75,
  good: 60,
  breakEven: 40,
  belowAverage: 25,
} as const;

export function scoreTier(score) {}
"""


class FindEliteCutoffTest(unittest.TestCase):
    def test_finds_clear_structural_gap(self):
        # Mirrors the real 2026-09-08 shape: a tight top cluster, then a
        # real gap, then a dense continuum below.
        scores = [99.6, 99.4, 99.3, 99.0, 99.0, 98.5, 97.9, 97.7, 97.5,
                  96.9, 96.5, 96.4, 96.1,
                  92.6, 92.3, 91.7, 90.7, 90.6, 90.1, 90.0, 89.8]
        new_cutoff, reason = find_elite_cutoff(
            scores, search_floor=75.0, current_elite=90.0, max_step=10.0
        )
        self.assertEqual(new_cutoff, 96.1)
        self.assertIn("gap", reason)

    def test_no_change_when_no_real_gap(self):
        # A smooth continuum with only sub-min_gap differences between
        # consecutive scores -- should not manufacture a cutoff.
        scores = [90.0 - 0.5 * i for i in range(20)]  # 90.0, 89.5, 89.0, ...
        new_cutoff, reason = find_elite_cutoff(scores, search_floor=75.0, current_elite=90.0)
        self.assertEqual(new_cutoff, 90.0)
        self.assertIn("no clear cluster break", reason)

    def test_not_enough_candidates_keeps_current(self):
        scores = [99.0, 98.0, 76.0, 60.0]  # only 3 candidates >= 75, need >= 4 (min_cluster=3)
        new_cutoff, reason = find_elite_cutoff(scores, search_floor=75.0, current_elite=90.0)
        self.assertEqual(new_cutoff, 90.0)
        self.assertIn("need >=", reason)

    def test_max_step_clamps_large_upward_jump(self):
        scores = [99.9] * 5 + [80.0 - 0.5 * i for i in range(20)]
        new_cutoff, reason = find_elite_cutoff(
            scores, search_floor=75.0, current_elite=90.0, max_step=3.0
        )
        self.assertEqual(new_cutoff, 93.0)  # 90 + max_step, not the raw ~99.9 target

    def test_max_step_clamps_large_downward_jump(self):
        # Real gap sits well below the current cutoff -- should ease
        # down by at most max_step, not jump straight there.
        scores = [79.0] * 5 + [60.0 - 0.5 * i for i in range(20)]
        new_cutoff, reason = find_elite_cutoff(
            scores, search_floor=59.0, current_elite=90.0, max_step=3.0
        )
        self.assertEqual(new_cutoff, 87.0)  # 90 - max_step

    def test_trivial_change_ignored(self):
        # Gap-based target lands 0.1 pt from the current cutoff --
        # not worth a PR, should report no change.
        scores = [96.1] * 5 + [92.6 - 0.5 * i for i in range(20)]
        new_cutoff, reason = find_elite_cutoff(scores, search_floor=75.0, current_elite=96.0)
        self.assertEqual(new_cutoff, 96.0)
        self.assertIn("noise", reason)

    def test_result_never_smaller_than_min_cluster(self):
        # Largest gap sits right at the top (between rank 1 and rank 2)
        # -- with min_cluster=3, that gap must be ignored even though
        # it's the biggest one in the data.
        scores = [99.9, 80.0, 79.5, 79.0, 78.5, 78.0]
        new_cutoff, reason = find_elite_cutoff(
            scores, search_floor=75.0, current_elite=90.0, min_cluster=3
        )
        # The only gap the search is allowed to consider (cluster size
        # >= 3) is far smaller than the 99.9/80.0 gap, and likely below
        # min_gap -- either way it must not pick a 1-wallet cluster.
        self.assertNotEqual(new_cutoff, 99.9)


class ReadCurrentCutoffsTest(unittest.TestCase):
    def test_parses_all_fields(self):
        cutoffs = read_current_cutoffs(SAMPLE_TIERS_TS)
        self.assertEqual(
            cutoffs,
            {"elite": 96.0, "great": 75.0, "good": 60.0, "breakEven": 40.0, "belowAverage": 25.0},
        )


class ApplyNewEliteCutoffTest(unittest.TestCase):
    def test_updates_value_and_inserts_marker_block(self):
        new_text = apply_new_elite_cutoff(SAMPLE_TIERS_TS, 97.5, "test reason", 200)
        cutoffs = read_current_cutoffs(new_text)
        self.assertEqual(cutoffs["elite"], 97.5)
        self.assertIn("AUTO-RECALIBRATED", new_text)
        self.assertIn("test reason", new_text)
        self.assertIn("200", new_text)
        # Untouched fields stay untouched.
        self.assertEqual(cutoffs["great"], 75.0)

    def test_rerunning_replaces_rather_than_duplicates_marker_block(self):
        once = apply_new_elite_cutoff(SAMPLE_TIERS_TS, 97.5, "first reason", 200)
        twice = apply_new_elite_cutoff(once, 95.0, "second reason", 210)
        self.assertEqual(twice.count(AUTO_BLOCK_START), 1)
        self.assertNotIn("first reason", twice)
        self.assertIn("second reason", twice)
        self.assertEqual(read_current_cutoffs(twice)["elite"], 95.0)

    def test_other_tier_cutoffs_and_code_untouched(self):
        new_text = apply_new_elite_cutoff(SAMPLE_TIERS_TS, 97.5, "test reason", 200)
        self.assertIn("export function scoreTier(score) {}", new_text)
        self.assertIn("good: 60,", new_text)
        self.assertIn("breakEven: 40,", new_text)
        self.assertIn("belowAverage: 25,", new_text)


if __name__ == "__main__":
    unittest.main()
