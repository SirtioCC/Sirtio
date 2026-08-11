import sql from "./db";

export type Market = {
  source: string;
  external_id: string;
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
  pnl: number;
  position_count: number;
  win_rate: number | null;
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
      source, external_id, title, category, yes_price_cents, no_price_cents,
      volume, open_interest, status, close_time, result, fetched_at
    FROM market_snapshots
    ORDER BY source, external_id, fetched_at DESC
  `;
  return rows
    .filter((r) => r.status === "open" || r.status === "active")
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit);
}

export async function getLeaderboard(limit = 25): Promise<LeaderboardTrader[]> {
  const rows = await sql<LeaderboardTrader[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    position_entropy AS (
      SELECT
        wallet,
        cash_pnl,
        percent_realized_pnl,
        LEAST(GREATEST(avg_price, 0.001), 0.999) AS p
      FROM trader_positions_snapshots
    ),
    position_entropy_calc AS (
      SELECT
        wallet,
        cash_pnl,
        percent_realized_pnl,
        (-(p * LN(p) + (1 - p) * LN(1 - p))) AS entropy
      FROM position_entropy
    ),
    position_stats AS (
      SELECT
        wallet,
        COUNT(*) AS position_count,
        SUM(CASE WHEN cash_pnl > 0 THEN entropy ELSE 0 END)
          / NULLIF(SUM(entropy), 0) AS win_rate,
        AVG(percent_realized_pnl) AS avg_edge_pct,
        STDDEV(percent_realized_pnl) AS pnl_stddev
      FROM position_entropy_calc
      GROUP BY wallet
    )
    SELECT
      l.rank,
      l.wallet,
      l.username,
      l.volume,
      l.pnl,
      COALESCE(p.position_count, 0) AS position_count,
      p.win_rate,
      p.avg_edge_pct,
      CASE
        WHEN p.position_count IS NULL OR p.position_count = 0 THEN NULL
        ELSE ROUND(
          (
            (
              (COALESCE(p.win_rate, 0) * 40)
              + (LEAST(GREATEST((COALESCE(p.avg_edge_pct, 0) + 100) / 200.0, 0), 1) * 35)
              + (LEAST(GREATEST(
                  1 - (COALESCE(p.pnl_stddev, 0) / (ABS(COALESCE(p.avg_edge_pct, 0)) + 1)),
                  0), 1) * 25)
            )
            * LEAST(p.position_count / 30.0, 1.0)
          )::numeric,
          1
        )
      END AS pm_score
    FROM latest_leaderboard l
    LEFT JOIN position_stats p ON p.wallet = l.wallet
    ORDER BY l.rank ASC
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
