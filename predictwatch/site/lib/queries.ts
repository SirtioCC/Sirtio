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
        realized_pnl,
        percent_realized_pnl,
        LEAST(GREATEST(avg_price, 0.001), 0.999) AS p
      FROM trader_positions_snapshots
      WHERE realized_pnl IS NOT NULL AND realized_pnl != 0
        AND end_date IS NOT NULL
        AND end_date::timestamptz >= (NOW() - INTERVAL '90 days')
    ),
    position_entropy_calc AS (
      SELECT
        wallet,
        realized_pnl,
        percent_realized_pnl,
        (-(p * LN(p) + (1 - p) * LN(1 - p))) AS entropy
      FROM position_entropy
    ),
    position_stats AS (
      SELECT
        wallet,
        COUNT(*) AS position_count,
        SUM(CASE WHEN realized_pnl > 0 THEN entropy ELSE 0 END)
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
  pnl: number | null;
  position_count: number;
  win_rate: number | null;
  avg_edge_pct: number | null;
  pnl_stddev: number | null;
  pm_score: number | null;
};

export type TraderPosition = {
  condition_id: string | null;
  market_title: string | null;
  outcome: string | null;
  size: number | null;
  avg_price: number | null;
  cur_price: number | null;
  cash_pnl: number | null;
  realized_pnl: number | null;
  percent_realized_pnl: number | null;
  redeemable: boolean | null;
  end_date: string | null;
};

export async function getTraderStats(wallet: string): Promise<TraderDetail | null> {
  const rows = await sql<TraderDetail[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    position_entropy AS (
      SELECT
        realized_pnl,
        percent_realized_pnl,
        LEAST(GREATEST(avg_price, 0.001), 0.999) AS p
      FROM trader_positions_snapshots
      WHERE wallet = ${wallet} AND realized_pnl IS NOT NULL AND realized_pnl != 0
        AND end_date IS NOT NULL
        AND end_date::timestamptz >= (NOW() - INTERVAL '90 days')
    ),
    position_entropy_calc AS (
      SELECT
        realized_pnl,
        percent_realized_pnl,
        (-(p * LN(p) + (1 - p) * LN(1 - p))) AS entropy
      FROM position_entropy
    ),
    position_stats AS (
      SELECT
        COUNT(*) AS position_count,
        SUM(CASE WHEN realized_pnl > 0 THEN entropy ELSE 0 END)
          / NULLIF(SUM(entropy), 0) AS win_rate,
        AVG(percent_realized_pnl) AS avg_edge_pct,
        STDDEV(percent_realized_pnl) AS pnl_stddev
      FROM position_entropy_calc
    )
    SELECT
      ${wallet}::text AS wallet,
      l.username,
      l.rank,
      l.volume,
      l.pnl,
      COALESCE(p.position_count, 0) AS position_count,
      p.win_rate,
      p.avg_edge_pct,
      p.pnl_stddev,
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
    FROM position_stats p
    LEFT JOIN latest_leaderboard l ON l.wallet = ${wallet}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, pm_score: r.pm_score !== null ? Number(r.pm_score) : null };
}

export async function getTraderPositions(wallet: string): Promise<TraderPosition[]> {
  return sql<TraderPosition[]>`
    SELECT condition_id, market_title, outcome, size, avg_price, cur_price,
           cash_pnl, realized_pnl, percent_realized_pnl, redeemable, end_date
    FROM trader_positions_snapshots
    WHERE wallet = ${wallet}
      AND realized_pnl IS NOT NULL AND realized_pnl != 0
      AND end_date IS NOT NULL
      AND end_date::timestamptz >= (NOW() - INTERVAL '90 days')
    ORDER BY cash_pnl DESC NULLS LAST
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
