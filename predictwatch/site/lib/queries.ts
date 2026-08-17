import sql from "./db";
import { cache } from "react";

export type Market = {
  source: string;
  external_id: string;
  slug: string | null;
  title: string;
  category: string | null;
  yes_price_cents: number | null;
  no_price_cents: number | null;
  volume: number | null;
  open_interest: number | null;
  status: string | null;
  close_time: string | null;
  result: string | null;
  fetched_at: string;
};

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
  total_markets: number;
  total_volume: number;
  total_traders: number;
  last_updated: string | null;
};

export async function getTopMarkets(limit = 20): Promise<Market[]> {
  const rows = await sql<Market[]>`
    SELECT DISTINCT ON (source, external_id)
      source, external_id, slug, title, category, yes_price_cents, no_price_cents,
      volume, open_interest, status, close_time, result, fetched_at
    FROM market_snapshots
    ORDER BY source, external_id, fetched_at DESC
  `;
  return rows
    .filter((r) => r.status === "open" || r.status === "active")
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit);
}

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
 * logistic curve). z_score is the underlying statistic tier cutoffs
 * are set against -- see scoreTier() in the leaderboard page.
 */
export async function getFollowedTraders(wallets: string[]): Promise<LeaderboardTrader[]> {
  if (wallets.length === 0) return [];
  const rows = await sql<LeaderboardTrader[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    latest_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      ORDER BY wallet, computed_at DESC
    ),
    ranked AS (
      SELECT
        l.wallet,
        ROW_NUMBER() OVER (ORDER BY s.sirtio_score DESC NULLS LAST, l.rank ASC) AS rank
      FROM latest_leaderboard l
      LEFT JOIN latest_scores s ON s.wallet = l.wallet
    ),
    latest_username AS (
      SELECT DISTINCT ON (wallet) wallet, username
      FROM trader_leaderboard_snapshots
      WHERE wallet = ANY(${wallets})
      ORDER BY wallet, fetched_at DESC
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
    FROM latest_username u
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
  const rows = await sql<LeaderboardTrader[]>`
    WITH latest_leaderboard_time AS (
      SELECT MAX(fetched_at) AS t FROM trader_leaderboard_snapshots
    ),
    latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT t FROM latest_leaderboard_time) - INTERVAL '1 minute'
    ),
    latest_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      ORDER BY wallet, computed_at DESC
    ),
    -- "Yesterday's" snapshot for the leaderboard-mover arrows. A 6-hour
    -- gap from the latest fetch is used to skip past same-day/manual
    -- reruns and land on the prior day's daily scheduled run. On the
    -- very first day this feature runs (or if there's genuinely no
    -- older snapshot yet), this comes back empty and every trader
    -- correctly falls back to "NEW" below, rather than a fake number.
    previous_leaderboard_time AS (
      SELECT MAX(fetched_at) AS t FROM trader_leaderboard_snapshots
      WHERE fetched_at < (SELECT t FROM latest_leaderboard_time) - INTERVAL '6 hours'
    ),
    previous_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT t FROM previous_leaderboard_time) - INTERVAL '1 minute'
        AND fetched_at <= (SELECT t FROM previous_leaderboard_time)
    ),
    previous_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      WHERE computed_at <= (SELECT t FROM previous_leaderboard_time) + INTERVAL '2 hours'
      ORDER BY wallet, computed_at DESC
    ),
    -- Same ordering as the final SELECT below (score DESC, NULLS LAST),
    -- so a previous rank means the same thing as today's rank.
    previous_ranked AS (
      SELECT
        l.wallet,
        ROW_NUMBER() OVER (ORDER BY s.sirtio_score DESC NULLS LAST, l.rank ASC) AS prev_rank
      FROM previous_leaderboard l
      LEFT JOIN previous_scores s ON s.wallet = l.wallet
    )
    SELECT
      l.rank,
      l.wallet,
      l.username,
      l.volume,
      COALESCE(s.realized_pnl_90d, 0) AS realized_pnl_90d,
      COALESCE(s.position_count, 0) AS position_count,
      s.avg_edge_pct,
      s.z_score,
      s.sirtio_score AS pm_score,
      p.prev_rank
    FROM latest_leaderboard l
    LEFT JOIN latest_scores s ON s.wallet = l.wallet
    LEFT JOIN previous_ranked p ON p.wallet = l.wallet
    ORDER BY s.sirtio_score DESC NULLS LAST, l.rank ASC
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

export async function getHeroStats(): Promise<HeroStats> {
  const [row] = await sql<HeroStats[]>`
    SELECT
      (SELECT COUNT(DISTINCT (source, external_id)) FROM market_snapshots) AS total_markets,
      (SELECT COALESCE(SUM(volume), 0) FROM (
        SELECT DISTINCT ON (source, external_id) volume
        FROM market_snapshots ORDER BY source, external_id, fetched_at DESC
      ) t) AS total_volume,
      (SELECT COUNT(DISTINCT wallet) FROM trader_leaderboard_snapshots) AS total_traders,
      (SELECT MAX(fetched_at) FROM market_snapshots) AS last_updated
  `;
  return {
    ...row,
    total_markets: Number(row.total_markets),
    total_traders: Number(row.total_traders),
  };
}

export type TraderDetail = {
  wallet: string;
  username: string | null;
  rank: number | null;
  volume: number | null;
  realized_pnl_90d: number | null;
  position_count: number;
  avg_edge_pct: number | null;
  z_score: number | null;
  pm_score: number | null;
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
  const rows = await sql<TraderDetail[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    latest_scores AS (
      SELECT DISTINCT ON (wallet) *
      FROM trader_sirtio_scores
      ORDER BY wallet, computed_at DESC
    ),
    scored AS (
      SELECT
        l.wallet,
        l.username,
        l.rank AS polymarket_rank,
        l.volume,
        COALESCE(s.realized_pnl_90d, 0) AS realized_pnl_90d,
        COALESCE(s.position_count, 0) AS position_count,
        s.avg_edge_pct,
        s.z_score,
        s.sirtio_score AS pm_score
      FROM latest_leaderboard l
      LEFT JOIN latest_scores s ON s.wallet = l.wallet
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (ORDER BY pm_score DESC NULLS LAST, polymarket_rank ASC) AS rank
      FROM scored
    )
    SELECT wallet, username, rank, volume, realized_pnl_90d, position_count, avg_edge_pct, z_score, pm_score
    FROM ranked
    WHERE wallet = ${wallet}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    avg_edge_pct: r.avg_edge_pct !== null ? Number(r.avg_edge_pct) : null,
    z_score: r.z_score !== null ? Number(r.z_score) : null,
    pm_score: r.pm_score !== null ? Number(r.pm_score) : null,
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

export const resolveWallet = cache(async (input: string): Promise<string | null> => {
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{10,}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const rows = await sql<{ wallet: string }[]>`
    SELECT wallet FROM trader_leaderboard_snapshots
    WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
      AND LOWER(username) = LOWER(${trimmed})
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].wallet : null;
});

/**
 * Backs the site-wide "Data last refreshed" indicator, added 2026-08-16.
 * Deliberately reads pipeline_runs (a real per-run outcome record) and
 * NOT MAX(fetched_at) on any individual table -- every stage in
 * run_pipeline.py's run() already catches its own exceptions and
 * continues (a Kalshi failure shouldn't block Polymarket, etc.), so a
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
