import sql from "./db";
import { cache } from "react";

export type LeaderboardTrader = {
  rank: number | null;
  wallet: string;
  username: string | null;
  volume: number;
  realized_pnl_90d: number | null;
  position_count: number;
  avg_edge_pct: number | null;
  z_score: number | null;
  pm_score: number | null;
  prev_rank: number | null;
};

export type HeroStats = {
  total_positions: number;
  total_traders: number;
};

/**
 * PM Score, redefined 2026-08-13 around realized PnL only -- win rate
 * and the older calibration-edge component were both dropped. Real
 * users on Reddit independently flagged the exact problem we'd found
 * ourselves: "Polymarket's settlement and redemption mechanics decouple
 * realized outcomes from position state, so naive [win/loss] aggregation
 * misrepresents trader performance." Any metric requiring a binary
 * won/lost classification per position inherits that unreliability,
 * no matter how the formula around it is shaped -- so this version
 * avoids classifying positions as won/lost at all, building entirely
 * from realized_pnl (a continuous dollar/percent value), which is
 * always well-defined regardless of settlement/redemption timing.
 *
 * TWO components, 50/50:
 *  - avg_edge_pct: mean percent return per resolved position (quality
 *    of each trade)
 *  - realized_pnl_90d: total dollar PnL, sign-preserving log-compressed
 *    so a handful of extreme wallets (real observed range: -$49.5M to
 *    +$16.1M) don't blow out the scale for everyone else (magnitude of
 *    demonstrated success)
 * Both damped by sample size, same as before -- a trader with one huge
 * lucky trade still gets crushed by a tiny position count (verified:
 * 1 position, +$5M, 500% edge scores 3.1, not close to the top).
 * Breakeven (0% edge, $0 total) scores exactly 50, same clean midpoint
 * property as the previous formula.
 *
 * DATA SOURCE, updated 2026-08-13: now built from
 * trader_realized_pnl_events (the trade-level ledger), not
 * trader_closed_positions_snapshots. The closed-positions table only
 * reliably captures WINS -- Polymarket's /closed-positions endpoint
 * has no concept of a position sold early at a loss, or a losing
 * position simply abandoned (worth $0, nothing to explicitly close).
 * Verified via a real wallet: 33/33 winning positions and $1.09M
 * summed from /closed-positions, against a real max around $349K for
 * the same wallet. The ledger fixes both gaps -- see
 * fetch_polymarket_activity.py and realized_pnl.py for the full
 * mechanism (trade-level BUY/SELL/REDEEM walk plus a force-close step
 * for abandoned-but-resolved positions).
 *
 * Aggregation is two-level: PER-POSITION first (grouping every ledger
 * event for the same wallet+condition_id together, since a partial
 * sell followed by a later full sell/redeem produces MULTIPLE ledger
 * rows for what is really one position), THEN per-wallet. This keeps
 * position_count meaning "distinct positions traded," not "raw ledger
 * events," and keeps avg_edge_pct a true per-position return rather
 * than being skewed toward wallets who happened to exit in more pieces.
 */
/**
 * Sirtio Score v2, 2026-08-14 -- Bayesian-shrunk, risk-adjusted mean
 * return, replacing the old live-SQL edge+magnitude+multiplier formula.
 * Computed ONCE PER PIPELINE RUN in Python (see sirtio_score.py),
 * against the full 90-day realized-PnL ledger, and stored in
 * trader_sirtio_scores -- this function just reads the precomputed
 * result, it does not compute the score itself. See sirtio_score.py
 * for the full derivation (empirical Bayes shrinkage + a Bayesian
 * analog of a Sharpe ratio / t-statistic, squashed to 0-100 via a
 * logistic curve). Tier cutoffs are fixed on that 0-100 score -- see
 * lib/tiers.ts.
 */
export async function getFollowedTraders(wallets: string[]): Promise<LeaderboardTrader[]> {
  if (wallets.length === 0) return [];
  // Sourced from all_wallets, same 2026-08-24 fix as getLeaderboard --
  // a followed trader used to disappear from this list the moment they
  // fell off Polymarket's current top-100 monthly pull, since the old
  // latest_leaderboard CTE only ever contained that current cohort.
  // Someone follows a wallet specifically to keep tabs on it, so it
  // being followed can't be allowed to silently stop resolving. rank
  // is computed the same way as getLeaderboard, over ALL discovered
  // wallets, so a followed trader's rank number here matches what
  // they'd see on the main leaderboard page.
  const rows = await sql<LeaderboardTrader[]>`
    WITH all_wallets AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_leaderboard_snapshots
      ORDER BY wallet, fetched_at DESC
    ),
    latest_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      ORDER BY wallet, computed_at DESC
    ),
    ranked AS (
      SELECT
        w.wallet,
        ROW_NUMBER() OVER (ORDER BY s.sirtio_score DESC NULLS LAST, w.wallet ASC) AS rank
      FROM all_wallets w
      LEFT JOIN latest_scores s ON s.wallet = w.wallet
    ),
    followed_wallets AS (
      SELECT wallet, username
      FROM all_wallets
      WHERE wallet = ANY(${wallets})
    )
    SELECT
      r.rank,
      u.wallet,
      u.username,
      NULL::float8 AS volume,
      s.realized_pnl_90d,
      COALESCE(s.position_count, 0) AS position_count,
      s.avg_edge_pct,
      s.z_score,
      s.sirtio_score AS pm_score
    FROM followed_wallets u
    LEFT JOIN latest_scores s ON s.wallet = u.wallet
    LEFT JOIN ranked r ON r.wallet = u.wallet
    ORDER BY s.sirtio_score DESC NULLS LAST
  `;
  return rows.map((r) => ({
    ...r,
    avg_edge_pct: r.avg_edge_pct !== null ? Number(r.avg_edge_pct) : null,
    z_score: r.z_score !== null ? Number(r.z_score) : null,
    pm_score: r.pm_score !== null ? Number(r.pm_score) : null,
    prev_rank: null,
  }));
}

export async function getLeaderboard(limit = 25): Promise<LeaderboardTrader[]> {
  // Sourced from all_wallets (every wallet Sirtio has ever discovered,
  // last-known row per wallet), not latest_leaderboard (only wallets in
  // Polymarket's current top-100 monthly pull) -- 2026-08-24 fix. Under
  // the old latest_leaderboard source, a wallet with a top Sirtio Score
  // (e.g. Flipadelphia at 99.9) would silently disappear from this page
  // the moment Polymarket's own rolling 30-day list dropped them, even
  // though trader_sirtio_scores still had their full 90-day score sitting
  // untouched in Supabase -- their individual trader page kept working
  // (getTraderStats already resolves from all_wallets, 2026-08-18 fix)
  // but the leaderboard listing didn't match. This makes the two
  // consistent: this leaderboard is now a persistent ranking of every
  // discovered trader by Sirtio Score, not a re-ranking of whoever
  // currently happens to be on Polymarket's own list.
  //
  // `rank` is computed here via ROW_NUMBER() over sirtio_score, same
  // pattern as getTraderStats -- the old l.rank column (Polymarket's own
  // rank) doesn't mean anything once we're ranking wallets that aren't
  // on Polymarket's current list at all. wallet is a deterministic
  // tiebreaker for wallets with no score yet (NULLS LAST) or identical
  // scores.
  // prev_rank, rewritten 2026-08-25: previously read from
  // trader_daily_ranks, a table the pipeline only ever wrote a row into
  // for wallets that were part of THAT run's Polymarket top-100 pull
  // (confirmed live against production: trader_daily_ranks' latest
  // snapshot_date is a 100% exact-match subset of
  // trader_leaderboard_snapshots' freshest fetch -- zero wallets in one
  // but not the other). That meant any wallet ranked here via
  // all_wallets but NOT currently on Polymarket's own list -- e.g.
  // Flipadelphia, currently #2 by Sirtio Score -- could never get a
  // prev_rank and permanently showed "NEW," even after being tracked
  // and scored for weeks. ~90+ of the ~215 wallets Sirtio has ever
  // scored were affected the same way, not just this one wallet.
  //
  // Rebuilt to rank ALL discovered wallets by their trader_sirtio_scores
  // history -- same source and same ROW_NUMBER pattern as `rank` above
  // -- just reconstructed as of a past point in time instead of now, so
  // prev_rank and rank are always apples-to-apples. previous_score_time
  // keeps the old 6-hour-gap heuristic (skips past same-day/manual
  // reruns, lands on a distinctly prior run). A wallet with no score row
  // at or before that time -- a genuinely new wallet, not just one
  // absent from Polymarket's current list -- is excluded from
  // previous_ranked entirely, so it still correctly shows "NEW"; that
  // part of the original behavior is preserved, just scoped to the
  // right condition now. No more separate try/catch query either --
  // trader_sirtio_scores is core to every other function in this file
  // and always exists, unlike trader_daily_ranks.
  const rows = await sql<LeaderboardTrader[]>`
    WITH all_wallets AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_leaderboard_snapshots
      ORDER BY wallet, fetched_at DESC
    ),
    latest_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      ORDER BY wallet, computed_at DESC
    ),
    ranked AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY s.sirtio_score DESC NULLS LAST, w.wallet ASC) AS rank,
        w.wallet,
        w.username,
        w.volume,
        COALESCE(s.realized_pnl_90d, 0) AS realized_pnl_90d,
        COALESCE(s.position_count, 0) AS position_count,
        s.avg_edge_pct,
        s.z_score,
        s.sirtio_score AS pm_score
      FROM all_wallets w
      LEFT JOIN latest_scores s ON s.wallet = w.wallet
    ),
    latest_score_time AS (
      SELECT MAX(computed_at) AS t FROM trader_sirtio_scores
    ),
    previous_score_time AS (
      SELECT MAX(computed_at) AS t FROM trader_sirtio_scores
      WHERE computed_at < (SELECT t FROM latest_score_time) - INTERVAL '6 hours'
    ),
    previous_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      WHERE computed_at <= (SELECT t FROM previous_score_time)
      ORDER BY wallet, computed_at DESC
    ),
    previous_ranked AS (
      SELECT
        wallet,
        ROW_NUMBER() OVER (ORDER BY sirtio_score DESC NULLS LAST, wallet ASC) AS prev_rank
      FROM previous_scores
      WHERE sirtio_score IS NOT NULL
    )
    SELECT r.*, p.prev_rank
    FROM ranked r
    LEFT JOIN previous_ranked p ON p.wallet = r.wallet
    ORDER BY r.rank ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    ...r,
    avg_edge_pct: r.avg_edge_pct !== null ? Number(r.avg_edge_pct) : null,
    z_score: r.z_score !== null ? Number(r.z_score) : null,
    pm_score: r.pm_score !== null ? Number(r.pm_score) : null,
    prev_rank: r.prev_rank !== null ? Number(r.prev_rank) : null,
  }));
}

// Tier cutoffs moved to lib/tiers.ts as fixed constants on the 0-100
// score, 2026-08-27 -- no longer a live query, see that file for why.

export async function getHeroStats(): Promise<HeroStats> {
  // total_positions sums each wallet's position_count from their most
  // recent trader_sirtio_scores row (one row per wallet, latest
  // computed_at) -- trader_sirtio_scores is append-only (a new row per
  // wallet every pipeline run), so a plain SUM would double-count a
  // wallet's positions once for every run it's been scored in. The
  // DISTINCT ON subquery picks only each wallet's latest row first.
  const [row] = await sql<HeroStats[]>`
    SELECT
      (SELECT COALESCE(SUM(position_count), 0) FROM (
        SELECT DISTINCT ON (wallet) position_count
        FROM trader_sirtio_scores
        ORDER BY wallet, computed_at DESC
      ) latest_scores) AS total_positions,
      (SELECT COUNT(DISTINCT wallet) FROM trader_leaderboard_snapshots) AS total_traders
  `;
  return {
    total_positions: Number(row.total_positions),
    total_traders: Number(row.total_traders),
  };
}

export type TraderDetail = {
  wallet: string;
  username: string | null;
  rank: number | null;
  volume: number | null;
  realized_pnl_90d: number | null;
  // open_fraction, added 2026-08-28: share of this wallet's total
  // (open + closed) cost basis that's still sitting in unresolved open
  // positions -- see trader_sirtio_scores.open_fraction / sirtio_score.py
  // for the full reasoning. A high value means avg_edge_pct/pm_score
  // below are based on a minority of this trader's real book.
  open_fraction: number | null;
  position_count: number;
  avg_edge_pct: number | null;
  z_score: number | null;
  pm_score: number | null;
  is_tracked: boolean;
};

export type TraderPosition = {
  condition_id: string | null;
  market_title: string | null;
  outcome: string | null;
  avg_price: number | null;
  cur_price: number | null;
  total_bought: number | null;
  realized_pnl: number | null;
  percent_return_approx: number | null;
  closed_at: string | null;
  end_date: string | null;
};

export const getTraderStats = cache(async (wallet: string): Promise<TraderDetail | null> => {
  // Resolves ANY wallet Sirtio has ever seen, not just ones on Polymarket's
  // current top-100 monthly leaderboard -- 2026-08-18 fix. A wallet that
  // falls off that leaderboard used to make this whole query return zero
  // rows (it only ever selected FROM the current-cohort CTE), which
  // 404'd the trader's page even though their score/position history was
  // still sitting untouched in Supabase. Followed traders especially
  // can't be allowed to just vanish. `all_wallets` (their last-known row,
  // regardless of freshness) is now always the resolution source.
  //
  // rank is ALSO computed over all_wallets, not just the current
  // Polymarket cohort -- 2026-08-24 fix, same pattern as
  // getLeaderboard/getFollowedTraders. Previously this page showed
  // "Not on Polymarket's current monthly leaderboard" for any wallet
  // outside the current top-100, even a top-scored one (e.g.
  // Flipadelphia at 99.9) -- inconsistent with the main leaderboard,
  // which now ranks that same wallet. rank comes back null here only
  // for a wallet with no Sirtio Score at all, matching the leaderboard's
  // own no-score case.
  //
  // is_tracked, added 2026-08-25: the pipeline's activity-fetch wallet
  // list is now Sirtio's own top-100-by-score UNION followed wallets
  // (see run_pipeline.py) -- a wallet ranked outside that top 100 with
  // no followers stops getting new trade/redeem activity fetched at
  // all, so its position ledger silently freezes at whatever it was
  // the day it fell out (confirmed live: Flipadelphia's ledger froze
  // exactly on the day he fell off Polymarket's OWN top-100, the old
  // tracking criterion). Rank alone -- checked at page-render time --
  // is a same-day-accurate proxy for "is the pipeline currently
  // fetching this wallet's activity," since the pipeline computes that
  // same top-100-by-score set at the start of each run. is_tracked ==
  // false means the trader page should hide "All Positions" rather
  // than show a table that looks live but silently stopped updating.
  const rows = await sql<Omit<TraderDetail, "is_tracked">[]>`
    WITH all_wallets AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_leaderboard_snapshots
      ORDER BY wallet, fetched_at DESC
    ),
    latest_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      ORDER BY wallet, computed_at DESC
    ),
    ranked AS (
      SELECT
        w.wallet,
        ROW_NUMBER() OVER (ORDER BY s.sirtio_score DESC NULLS LAST, w.wallet ASC) AS rank
      FROM all_wallets w
      LEFT JOIN latest_scores s ON s.wallet = w.wallet
      WHERE s.sirtio_score IS NOT NULL
    )
    SELECT
      w.wallet,
      w.username,
      r.rank,
      w.volume,
      COALESCE(s.realized_pnl_90d, 0) AS realized_pnl_90d,
      s.open_fraction,
      COALESCE(s.position_count, 0) AS position_count,
      s.avg_edge_pct,
      s.z_score,
      s.sirtio_score AS pm_score,
      (
        (r.rank IS NOT NULL AND r.rank <= 100)
        OR EXISTS (SELECT 1 FROM follows f WHERE f.wallet = w.wallet)
      ) AS is_tracked
    FROM all_wallets w
    LEFT JOIN latest_scores s ON s.wallet = w.wallet
    LEFT JOIN ranked r ON r.wallet = w.wallet
    WHERE w.wallet = ${wallet}
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as TraderDetail;
  return {
    ...r,
    avg_edge_pct: r.avg_edge_pct !== null ? Number(r.avg_edge_pct) : null,
    z_score: r.z_score !== null ? Number(r.z_score) : null,
    pm_score: r.pm_score !== null ? Number(r.pm_score) : null,
    open_fraction: r.open_fraction !== null ? Number(r.open_fraction) : null,
    is_tracked: Boolean(r.is_tracked),
  };
});

/**
 * Same data-source swap as getLeaderboard/getTraderStats, 2026-08-13 --
 * the "All positions" list on a trader's page has to match the score
 * shown above it on the same page. Rendering this from
 * trader_closed_positions_snapshots while the score comes from the
 * ledger would show two different position counts/PnL figures on the
 * same page for the same wallet, which is worse than either being
 * wrong alone. cur_price/total_bought/end_date aren't rendered by the
 * trader page (confirmed against app/trader/[wallet]/page.tsx) so
 * those come back NULL rather than being derived from data the ledger
 * doesn't naturally have (there's no "current price" concept for a
 * position built from discrete realized trade/redeem events).
 */
export async function getTraderPositions(wallet: string): Promise<TraderPosition[]> {
  return sql<TraderPosition[]>`
    WITH per_position AS (
      SELECT
        condition_id,
        MAX(market_title) AS market_title,
        MAX(outcome) AS outcome,
        SUM(avg_cost * size) / NULLIF(SUM(size), 0) AS avg_price,
        SUM(realized_pnl) AS realized_pnl,
        SUM(avg_cost * size) AS position_cost_basis,
        MAX(closed_at) AS closed_at
      FROM trader_realized_pnl_events
      WHERE wallet = ${wallet}
        AND closed_at IS NOT NULL
        AND closed_at >= (NOW() - INTERVAL '90 days')
      GROUP BY condition_id
      HAVING SUM(realized_pnl) != 0
    )
    SELECT
      condition_id,
      market_title,
      outcome,
      avg_price,
      NULL::double precision AS cur_price,
      NULL::double precision AS total_bought,
      realized_pnl,
      CASE WHEN position_cost_basis > 0 THEN (realized_pnl / position_cost_basis) * 100 END AS percent_return_approx,
      closed_at,
      NULL::text AS end_date
    FROM per_position
    ORDER BY closed_at DESC NULLS LAST
  `;
}

/**
 * Backs the "All Positions" window label on the trader page, added
 * 2026-08-26. A wallet that Sirtio only started tracking recently has
 * NOT had a full 90-day window fetched, even though getTraderPositions
 * filters on closed_at >= NOW() - 90 days -- a real position that
 * resolved before Sirtio started watching this wallet (e.g. an old
 * settled bet) will never appear, no matter how the closed_at filter
 * is written, because the ledger row for it was never fetched at all.
 * Labeling the table "Last 90 Days" in that case overstates coverage.
 *
 * Returns the earliest fetched_at Sirtio has EVER recorded for this
 * wallet's realized-PnL ledger, with NO closed_at filter -- this is
 * about when WE started watching the wallet, not which positions are
 * shown in the 90-day table above it.
 */
export async function getPositionsTrackingStart(wallet: string): Promise<string | null> {
  const rows = await sql<{ tracking_started_at: string | null }[]>`
    SELECT MIN(fetched_at) AS tracking_started_at
    FROM trader_realized_pnl_events
    WHERE wallet = ${wallet}
  `;
  return rows.length > 0 ? rows[0].tracking_started_at : null;
}

export const resolveWallet = cache(async (input: string): Promise<string | null> => {
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{10,}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  // Matches against each wallet's most recently known username, not just
  // usernames on today's current leaderboard fetch -- 2026-08-18 fix, same
  // reasoning as getTraderStats above. Without this, a username-based
  // trader page (e.g. someone typing a known trader's name) would 404 the
  // moment that trader fell off Polymarket's current monthly leaderboard,
  // even though getTraderStats itself now resolves that wallet fine once
  // given the raw address.
  const rows = await sql<{ wallet: string }[]>`
    SELECT wallet FROM (
      SELECT DISTINCT ON (wallet) wallet, username
      FROM trader_leaderboard_snapshots
      ORDER BY wallet, fetched_at DESC
    ) w
    WHERE LOWER(username) = LOWER(${trimmed})
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].wallet : null;
});

/**
 * Backs the site-wide "Data last refreshed" indicator, added 2026-08-16.
 * Deliberately reads pipeline_runs (a real per-run outcome record) and
 * NOT MAX(fetched_at) on any individual table -- every stage in
 * run_pipeline.py's run() already catches its own exceptions and
 * continues (a failure in one stage shouldn't block the others), so a
 * given table's fetched_at can look fresh even on a run where some
 * other stage failed. status='success' is only written by
 * run_pipeline.py once EVERY stage completes cleanly -- a 'running' or
 * 'failed' row is intentionally excluded here, so this always reflects
 * the last run the site can actually trust as complete. Wrapped in
 * cache() like getTraderStats/resolveWallet above, since this will
 * likely get called once per page render from a shared layout-level
 * component -- avoids a duplicate query if anything else on the same
 * page also happens to call it within one render pass.
 */
export const getLastRefresh = cache(async (): Promise<string | null> => {
  // Wrapped in try/catch, added 2026-08-16 after a build-time crash:
  // this renders inside Nav, which is now on every page, so a slow or
  // unreachable DB connection during Vercel's BUILD step (not just
  // runtime) can fail the entire page's static generation -- confirmed
  // live via a "canceling statement due to statement timeout" error
  // that killed the whole /methodology build even though that page's
  // actual content has nothing to do with the database. A freshness
  // badge failing to load should never be able to take down a page
  // build. Falling back to null renders nothing (same as "no
  // successful run recorded yet" -- see DataFreshnessClient.tsx),
  // which is the correct degrade: worst case the badge is briefly
  // missing, not the whole site failing to deploy.
  try {
    const rows = await sql<{ completed_at: string }[]>`
      SELECT completed_at
      FROM pipeline_runs
      WHERE status = 'success'
      ORDER BY completed_at DESC
      LIMIT 1
    `;
    return rows.length > 0 ? rows[0].completed_at : null;
  } catch (e) {
    console.error("getLastRefresh failed, degrading gracefully:", e);
    return null;
  }
});

export type RecentSettlement = {
  wallet: string;
  username: string | null;
  market_title: string | null;
  realized_pnl: number;
  closed_at: string;
};

// Cost-basis floor matching sirtio_score.py's MIN_POSITION_COST_BASIS --
// same reasoning: a few-dollar position can show a huge percent swing
// on a tiny real amount, which reads as noise here rather than the
// "real trading activity" signal this ticker exists to show.
const MIN_TICKER_COST_BASIS = 25;

/**
 * Backs the homepage margin ticker (added 2026-08-28). Real settled
 * positions across ALL tracked wallets, most recent first -- same
 * per-position aggregation as getTraderPositions (a partial sell
 * followed by a full exit is one position, not two ledger rows), just
 * without the wallet filter. 14-day window is generous headroom over
 * the daily pipeline cadence; confirmed live this comfortably clears
 * thousands of qualifying positions, so LIMIT is what actually bounds
 * this, not the window running dry.
 *
 * Deliberately ordered by recency, not by |realized_pnl| DESC -- a
 * "biggest wins" ticker would just repeat whichever few wallets trade
 * biggest, reproducing the same skew this site's Sirtio Score exists
 * to correct for. Recency instead reads as "the platform is actually
 * live," which is the whole point of filling this space.
 *
 * Wrapped in try/catch like getLastRefresh above -- this is decorative
 * homepage chrome, not core content, so a query failure should degrade
 * to "don't render the ticker," never take the page down with it.
 */
export async function getRecentSettlements(limit = 24): Promise<RecentSettlement[]> {
  try {
    const rows = await sql<(Omit<RecentSettlement, "realized_pnl"> & { realized_pnl: number | string })[]>`
      WITH per_position AS (
        SELECT
          wallet,
          condition_id,
          MAX(market_title) AS market_title,
          SUM(realized_pnl) AS realized_pnl,
          SUM(avg_cost * size) AS position_cost_basis,
          MAX(closed_at) AS closed_at
        FROM trader_realized_pnl_events
        WHERE closed_at IS NOT NULL
          AND closed_at >= (NOW() - INTERVAL '14 days')
        GROUP BY wallet, condition_id
        HAVING SUM(avg_cost * size) >= ${MIN_TICKER_COST_BASIS}
          AND SUM(realized_pnl) != 0
      ),
      latest_username AS (
        SELECT DISTINCT ON (wallet) wallet, username
        FROM trader_leaderboard_snapshots
        ORDER BY wallet, fetched_at DESC
      )
      SELECT p.wallet, u.username, p.market_title, p.realized_pnl, p.closed_at
      FROM per_position p
      LEFT JOIN latest_username u ON u.wallet = p.wallet
      ORDER BY p.closed_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ ...r, realized_pnl: Number(r.realized_pnl) }));
  } catch (e) {
    console.error("getRecentSettlements failed, degrading gracefully:", e);
    return [];
  }
}
