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
 */
export async function getLeaderboard(limit = 25): Promise<LeaderboardTrader[]> {
  const rows = await sql<LeaderboardTrader[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    position_stats AS (
      SELECT
        wallet,
        COUNT(*) AS position_count,
        AVG(percent_return_approx) AS avg_edge_pct,
        SUM(realized_pnl) AS realized_pnl_90d
      FROM trader_closed_positions_snapshots
      WHERE realized_pnl IS NOT NULL AND realized_pnl != 0
        AND closed_at IS NOT NULL
        AND closed_at >= (NOW() - INTERVAL '90 days')
      GROUP BY wallet
    )
    SELECT
      l.rank,
      l.wallet,
      l.username,
      l.volume,
      COALESCE(p.realized_pnl_90d, 0) AS realized_pnl_90d,
      COALESCE(p.position_count, 0) AS position_count,
      p.avg_edge_pct,
      CASE
        WHEN p.position_count IS NULL OR p.position_count = 0 THEN NULL
        ELSE ROUND(
          (
            (
              (LEAST(GREATEST((COALESCE(p.avg_edge_pct, 0) + 100) / 200.0, 0), 1) * 50)
              + (LEAST(GREATEST(
                  (SIGN(COALESCE(p.realized_pnl_90d, 0)) * LN(1 + ABS(COALESCE(p.realized_pnl_90d, 0))) + 20) / 40.0,
                  0), 1) * 50)
            )
            * LEAST(p.position_count / 30.0, 1.0)
          )::numeric,
          1
        )
      END AS pm_score
    FROM latest_leaderboard l
    LEFT JOIN position_stats p ON p.wallet = l.wallet
    ORDER BY pm_score DESC NULLS LAST, l.rank ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    ...r,
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
    position_stats AS (
      SELECT
        wallet,
        COUNT(*) AS position_count,
        AVG(percent_return_approx) AS avg_edge_pct,
        SUM(realized_pnl) AS realized_pnl_90d
      FROM trader_closed_positions_snapshots
      WHERE realized_pnl IS NOT NULL AND realized_pnl != 0
        AND closed_at IS NOT NULL
        AND closed_at >= (NOW() - INTERVAL '90 days')
      GROUP BY wallet
    ),
    scored AS (
      SELECT
        l.wallet,
        l.username,
        l.rank AS polymarket_rank,
        l.volume,
        COALESCE(p.realized_pnl_90d, 0) AS realized_pnl_90d,
        COALESCE(p.position_count, 0) AS position_count,
        p.avg_edge_pct,
        CASE
          WHEN p.position_count IS NULL OR p.position_count = 0 THEN NULL
          ELSE ROUND(
            (
              (
                (LEAST(GREATEST((COALESCE(p.avg_edge_pct, 0) + 100) / 200.0, 0), 1) * 50)
                + (LEAST(GREATEST(
                    (SIGN(COALESCE(p.realized_pnl_90d, 0)) * LN(1 + ABS(COALESCE(p.realized_pnl_90d, 0))) + 20) / 40.0,
                    0), 1) * 50)
              )
              * LEAST(p.position_count / 30.0, 1.0)
            )::numeric,
            1
          )
        END AS pm_score
      FROM latest_leaderboard l
      LEFT JOIN position_stats p ON p.wallet = l.wallet
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (ORDER BY pm_score DESC NULLS LAST, polymarket_rank ASC) AS rank
      FROM scored
    )
    SELECT wallet, username, rank, volume, realized_pnl_90d, position_count, avg_edge_pct, pm_score
    FROM ranked
    WHERE wallet = ${wallet}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, pm_score: r.pm_score !== null ? Number(r.pm_score) : null };
}

export async function getTraderPositions(wallet: string): Promise<TraderPosition[]> {
  return sql<TraderPosition[]>`
    SELECT condition_id, market_title, outcome, avg_price, cur_price,
           total_bought, realized_pnl, percent_return_approx, closed_at, end_date
    FROM trader_closed_positions_snapshots
    WHERE wallet = ${wallet}
      AND realized_pnl IS NOT NULL AND realized_pnl != 0
      AND closed_at IS NOT NULL
      AND closed_at >= (NOW() - INTERVAL '90 days')
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
