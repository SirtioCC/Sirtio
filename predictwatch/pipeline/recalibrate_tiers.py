"""
Scheduled, guarded recalibration of SCORE_TIER_CUTOFFS.elite in
site/lib/tiers.ts -- automates the manual exercise done by hand on
2026-09-08 (see that date's block in tiers.ts) so a stale Elite cutoff
doesn't require another ad-hoc investigation next time the tracked
population grows.

WHY THIS SHAPE: tiers.ts used to read cutoffs live via a per-request
Supabase query (getScoreTierCutoffs(), removed -- see the history at
the top of tiers.ts and the connection-pool-wedging incident noted in
site/lib/db.ts's comment, where that query was one of several
contributing to 2026-08-27's wedged-connections outage). Two independent
reasons killed it: percentile-of-population queries guarantee a fixed
"top N%" Elite no matter how the pool actually performs (the ORIGINAL
sin this file exists to avoid repeating), and a live query per page
render is exactly the kind of Supabase-egress/connection-pool cost this
codebase has been burned by more than once. So this does NOT reintroduce
a live query -- it recalibrates the COMPILE-TIME constant on a schedule
instead, and proposes the change as a PR rather than committing it
unattended, since it changes what every visitor sees as "Elite" on a
schedule with nobody watching a specific run.

METHOD (mirrors the 2026-09-08 manual recalibration): among wallets
currently scoring at least SCORE_TIER_CUTOFFS.great, find the single
largest gap in the sorted score distribution and set elite to the score
just above it -- Elite means "in today's distinct top cluster," not a
fixed percentage of the population (seeing find_elite_cutoff's docstring
for the guardrails that keep this from reacting to noise).
"""
import os
import re
import sys
from datetime import datetime, timezone

import psycopg2

MIN_TOTAL_POPULATION = 50  # below this, the whole scored pool is too small/noisy to recalibrate against
MIN_GAP = 2.0  # points -- how big a break has to be to count as a real cluster boundary, not continuum noise
MIN_CLUSTER = 3  # the resulting Elite tier must have at least this many wallets
MAX_STEP = 5.0  # max points a single scheduled run may move the cutoff, either direction
MIN_CHANGE = 0.5  # below this, treat as noise/rounding -- not worth a PR
SEARCH_CEILING = 99.9  # never pin the cutoff to literally 100

TIERS_TS_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "site", "lib", "tiers.ts")
)

AUTO_BLOCK_START = "// --- AUTO-RECALIBRATED (recalibrate_tiers.py) ---"
AUTO_BLOCK_END = "// --- END AUTO-RECALIBRATED ---"


def find_elite_cutoff(scores_desc, search_floor, current_elite,
                       min_gap=MIN_GAP, min_cluster=MIN_CLUSTER, max_step=MAX_STEP,
                       min_change=MIN_CHANGE):
    """
    scores_desc: every currently-scored wallet's sirtio_score (any order).
    search_floor: only wallets scoring at least this are candidates --
    today, SCORE_TIER_CUTOFFS.great, so the search stays scoped to "the
    already-good pool," matching how the 08-27/09-08 cutoffs were
    reasoned about by hand.

    Returns (new_cutoff, reason). new_cutoff == current_elite whenever
    no qualifying change is found -- every guardrail failure is a
    "keep the current value" outcome, never an error, since a
    scheduled job with nobody watching should default to doing nothing
    over guessing:
      - not enough candidates above search_floor to detect a cluster
      - the largest gap found is smaller than min_gap (no real break,
        just the dense continuum this whole recalibration exists to
        avoid cutting through)
      - (implicitly) the resulting cluster has fewer than min_cluster
        wallets -- enforced by where the search starts, so it can never
        even consider a too-small cluster
      - the resulting move is smaller than min_change -- a 0.1-point
        wobble isn't worth a PR
    max_step then clamps whatever raw target survives the above to at
    most `max_step` points away from the current cutoff, so one noisy
    week can't swing the site's Elite bar drastically; a genuine,
    sustained trend still gets there over a few scheduled runs.
    """
    candidates = sorted((s for s in scores_desc if s >= search_floor), reverse=True)
    if len(candidates) < min_cluster + 1:
        return current_elite, (
            f"only {len(candidates)} wallet(s) scoring >= {search_floor} "
            f"(need >= {min_cluster + 1} to detect a cluster) -- keeping {current_elite}"
        )

    best_gap = 0.0
    best_cutoff = None
    # i is the index of the last wallet INSIDE the candidate cluster;
    # starting at min_cluster - 1 guarantees that cluster has at least
    # min_cluster wallets in it, for every gap this loop considers.
    for i in range(min_cluster - 1, len(candidates) - 1):
        gap = candidates[i] - candidates[i + 1]
        if gap > best_gap:
            best_gap = gap
            best_cutoff = candidates[i]

    if best_cutoff is None or best_gap < min_gap:
        return current_elite, (
            f"largest gap among {len(candidates)} candidates >= {search_floor} "
            f"was {best_gap:.1f} pt(s) (need >= {min_gap}) -- no clear cluster break, keeping {current_elite}"
        )

    raw_target = min(best_cutoff, SEARCH_CEILING)
    step = raw_target - current_elite
    if step > max_step:
        new_cutoff = current_elite + max_step
    elif step < -max_step:
        new_cutoff = current_elite - max_step
    else:
        new_cutoff = raw_target
    new_cutoff = round(new_cutoff, 1)

    if abs(new_cutoff - current_elite) < min_change:
        return current_elite, (
            f"gap-based target {raw_target} (stepped to {new_cutoff}) is within {min_change} pt of "
            f"current cutoff {current_elite} -- treating as noise, no change"
        )

    return new_cutoff, (
        f"{len(candidates)} candidates >= {search_floor}; largest gap {best_gap:.1f} pt(s) "
        f"at score {best_cutoff} (target {raw_target}, stepped to {new_cutoff} from "
        f"current {current_elite} under the {max_step}-pt max-step guardrail)"
    )


def read_current_cutoffs(tiers_ts_text):
    """Parses the live numeric values out of SCORE_TIER_CUTOFFS so this
    script never operates on a stale hardcoded copy of `great`/`elite`
    if a human hand-edits tiers.ts between scheduled runs."""
    match = re.search(
        r"export const SCORE_TIER_CUTOFFS = \{(.*?)\} as const;", tiers_ts_text, re.DOTALL
    )
    if not match:
        raise ValueError("Could not find SCORE_TIER_CUTOFFS block in tiers.ts")
    block = match.group(1)
    cutoffs = {}
    for name in ("elite", "great", "good", "breakEven", "belowAverage"):
        field_match = re.search(rf"{name}:\s*([\d.]+)", block)
        if not field_match:
            raise ValueError(f"Could not find {name!r} in SCORE_TIER_CUTOFFS block")
        cutoffs[name] = float(field_match.group(1))
    return cutoffs


def apply_new_elite_cutoff(tiers_ts_text, new_cutoff, reason, population_size):
    """Rewrites the `elite:` value inside SCORE_TIER_CUTOFFS and
    replaces (or inserts, on the first-ever auto run) a single marked
    comment block explaining the current value. The marker means each
    scheduled run overwrites the PREVIOUS auto-generated rationale
    rather than appending a new one every week forever -- the
    hand-written history above the marker (2026-08-27, 2026-09-08) stays
    untouched as permanent context; only the "why is it this number
    right now" note churns."""
    block_match = re.search(
        r"export const SCORE_TIER_CUTOFFS = \{(.*?)\} as const;", tiers_ts_text, re.DOTALL
    )
    if not block_match:
        raise ValueError("Could not find SCORE_TIER_CUTOFFS block in tiers.ts")
    block = block_match.group(1)
    new_block = re.sub(r"elite:\s*[\d.]+", f"elite: {new_cutoff}", block, count=1)
    new_text = (
        tiers_ts_text[: block_match.start(1)] + new_block + tiers_ts_text[block_match.end(1) :]
    )

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    auto_comment = (
        f"{AUTO_BLOCK_START}\n"
        f"// {today}: elite -> {new_cutoff}. {reason}. Population: {population_size} "
        f"currently-scored wallet(s). Rewritten by the next scheduled run -- edit\n"
        f"// SCORE_TIER_CUTOFFS.elite by hand if you need to override it immediately;\n"
        f"// the dated history above this marker is permanent context, not touched here.\n"
        f"{AUTO_BLOCK_END}"
    )

    existing_auto = re.search(
        re.escape(AUTO_BLOCK_START) + r".*?" + re.escape(AUTO_BLOCK_END), new_text, re.DOTALL
    )
    if existing_auto:
        new_text = new_text[: existing_auto.start()] + auto_comment + new_text[existing_auto.end() :]
    else:
        anchor = "export const SCORE_TIER_CUTOFFS = {"
        idx = new_text.index(anchor)
        new_text = new_text[:idx] + auto_comment + "\n" + new_text[idx:]

    return new_text


def fetch_latest_scores(conn):
    """Every wallet's most recent sirtio_score -- same 'latest row per
    wallet' shape the site itself reads (see site/lib/queries.ts)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (wallet) sirtio_score
            FROM trader_sirtio_scores
            WHERE sirtio_score IS NOT NULL
            ORDER BY wallet, computed_at DESC
            """
        )
        return [float(row[0]) for row in cur.fetchall()]


def main():
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(database_url)
    try:
        scores = fetch_latest_scores(conn)
    finally:
        conn.close()

    if len(scores) < MIN_TOTAL_POPULATION:
        print(
            f"Only {len(scores)} scored wallet(s), below MIN_TOTAL_POPULATION="
            f"{MIN_TOTAL_POPULATION} -- skipping recalibration this run."
        )
        return

    with open(TIERS_TS_PATH, "r") as f:
        tiers_ts_text = f.read()

    cutoffs = read_current_cutoffs(tiers_ts_text)
    new_elite, reason = find_elite_cutoff(scores, cutoffs["great"], cutoffs["elite"])

    print(f"Current elite cutoff: {cutoffs['elite']}")
    print(f"Population: {len(scores)} scored wallets")
    print(f"Recalibration result: {reason}")

    if new_elite == cutoffs["elite"]:
        print("No change -- leaving tiers.ts as-is.")
        return

    new_text = apply_new_elite_cutoff(tiers_ts_text, new_elite, reason, len(scores))
    with open(TIERS_TS_PATH, "w") as f:
        f.write(new_text)
    print(f"Updated elite cutoff: {cutoffs['elite']} -> {new_elite}")


if __name__ == "__main__":
    sys.exit(main())
