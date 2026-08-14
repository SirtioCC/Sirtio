import sql from "./db";

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
  rank: number;
  wallet: string;
  username: string | null;
  volume: number;
  realized_pnl_90d: number | null;
  position_count: number;
  avg_edge_pct: number | null;
  z_score: number | null;
  pm_score: number | null;
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
export async function getLeaderboard(limit = 25): Promise<LeaderboardTrader[]> {
  const rows = await sql<LeaderboardTrader[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
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
      s.sirtio_score AS pm_score
    FROM latest_leaderboard l
    LEFT JOIN trader_sirtio_scores s ON s.wallet = l.wallet
    ORDER BY s.sirtio_score DESC NULLS LAST, l.rank ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    ...r,
    avg_edge_pct: r.avg_edge_pct !== null ? Number(r.avg_edge_pct) : null,
    z_score: r.z_score !== null ? Number(r.z_score) : null,
    pm_score: r.pm_score !== null ? Number(r.pm_score) : null,
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

export async function getTraderStats(wallet: string): Promise<TraderDetail | null> {
  const rows = await sql<TraderDetail[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
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
      LEFT JOIN trader_sirtio_scores s ON s.wallet = l.wallet
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
}

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

export async function resolveWallet(input: string): Promise<string | null> {
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
}
