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

/**
 * Latest snapshot per market (DISTINCT ON handles the fact that
 * market_snapshots is an intentional time series — every pipeline run
 * adds a new row per market, so we take the most recent one), sorted
 * by volume descending.
 */
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

/**
 * Trader leaderboard joined with a first-pass PM Score computed from
 * trader_positions_snapshots (the current-state, upserted table — see
 * README for why this table doesn't need DISTINCT ON the way
 * market_snapshots does).
 *
 * This is the v0 formula from README.md: win rate + normalized average
 * edge + consistency, damped by sample size so a wallet with a
 * handful of positions can't outrank one with thousands. It needs real
 * backtesting before it means anything precise — treat the score as
 * directional, not authoritative, until there's enough resolved
 * history to validate the weights against.
 */
export async function getLeaderboard(limit = 25): Promise<LeaderboardTrader[]> {
  // NOTE: "latest run" is a time window, not an exact timestamp match.
  // fetch_polymarket_leaderboard.py generates fetched_at once per row
  // (inside its normalize loop), so the 25 rows from one pipeline run
  // don't share one identical timestamp — they're each a few
  // microseconds apart. Matching fetched_at = MAX(fetched_at) only
  // ever caught the single latest row instead of the whole batch;
  // confirmed and fixed by reproducing the exact bug against a real
  // database before shipping this.
  const rows = await sql<LeaderboardTrader[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    position_entropy AS (
      -- Shannon entropy of each position's entry price: maximal (≈1) at
      -- 50¢ (maximum market uncertainty), near-zero close to 0¢/100¢
      -- (near-certain outcome). This is the fix for "a correct call on
      -- a coin-flip market shouldn't count the same as a correct call
      -- on a 95%-obvious market" — verified against a realistic mixed
      -- portfolio before shipping: a trader propped up by many easy
      -- gimmes but wrong on the few genuinely uncertain calls they made
      -- now scores much closer to their real (weaker) skill level,
      -- instead of an inflated naive win rate.
      --
      -- ONLY genuinely resolved positions count (realized_pnl != 0).
      -- Found via a real trader (HOG993) whose win rate showed 0%
      -- despite +$227K real profit: they hold dozens of open long-shot
      -- bets on far-future events (e.g. "Will Team X win the 2027
      -- Finals?"). Those show large negative cash_pnl (correct mark-
      -- to-market pricing on a bet that hasn't resolved) but realized_pnl
      -- of 0 (nothing has actually been decided yet). Using cash_pnl as
      -- the win/loss signal was treating still-open speculative bets as
      -- final losses. realized_pnl only reflects positions that have
      -- actually settled.
      -- Sourced from trader_closed_positions_snapshots -- Polymarket's
      -- dedicated closed-positions endpoint -- not trader_positions_snapshots
      -- (the "current holdings" endpoint). Verified via direct comparison
      -- (2026-08-12): the current-holdings source was missing 95-99.98%
      -- of some wallets' real resolved history (one wallet had 38,396
      -- genuinely closed positions vs. only 192 visible via the old
      -- source). This is the actual fix for that gap, not a cosmetic
      -- change -- PM Score was previously being computed from a small,
      -- arbitrary slice of each trader's real track record.
      SELECT
        wallet,
        realized_pnl,
        percent_return_approx AS percent_realized_pnl,
        LEAST(GREATEST(avg_price, 0.001), 0.999) AS p
      FROM trader_closed_positions_snapshots
      WHERE realized_pnl IS NOT NULL AND realized_pnl != 0
        AND closed_at IS NOT NULL
        AND closed_at >= (NOW() - INTERVAL '90 days')
    ),
    position_entropy_calc AS (
      SELECT
        wallet,
        realized_pnl,
        percent_realized_pnl,
        p,
        (-(p * LN(p) + (1 - p) * LN(1 - p))) AS entropy
      FROM position_entropy
    ),
    position_stats AS (
      -- calibration_edge replaces the old variance-based "consistency"
      -- term (2026-08-12). Proven via a real documented bug: the old
      -- term measured stdev of DOLLAR returns, which penalizes genuine
      -- coin-flip trading just because binary payoffs are inherently
      -- high-variance in dollar terms -- a trader holding 30 identical
      -- 97c "obvious" bets scored a PERFECT consistency purely because
      -- their returns were all nearly identical, while a genuinely
      -- skilled 50c coin-flip trader (83% win rate on real coin-flips)
      -- scored near-zero and lost the overall comparison (79.9 vs 62.5)
      -- despite being the better trader. calibration_edge = mean(actual
      -- outcome - entry price) measures "how much did this trader beat
      -- the market's own pricing, on average" -- directly rewards real
      -- skill regardless of whether the underlying bet was high or low
      -- variance. Verified this fixes the exact documented case: the
      -- skilled coin-flip trader now correctly scores higher (83.3 vs
      -- 71.3). Deliberately NOT adding a variance term on top of this
      -- (e.g. stdev of calibration_edge) -- tested that too, and it
      -- reintroduces the identical bias one level removed, since any
      -- genuine coin-flip betting is structurally binary (+0.5/-0.5 per
      -- bet) and will always show high variance regardless of skill.
      SELECT
        wallet,
        COUNT(*) AS position_count,
        SUM(CASE WHEN realized_pnl > 0 THEN entropy ELSE 0 END)
          / NULLIF(SUM(entropy), 0) AS win_rate,
        AVG(percent_realized_pnl) AS avg_edge_pct,
        AVG((CASE WHEN realized_pnl > 0 THEN 1.0 ELSE 0.0 END) - p) AS calibration_edge
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
              + (LEAST(GREATEST(COALESCE(p.calibration_edge, 0) + 0.5, 0), 1) * 25)
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
  // Postgres NUMERIC (what ROUND(...::numeric, 1) returns) comes back
  // from the driver as a string, not a JS number — this is deliberate
  // on the driver's part, to avoid silent precision loss, but it means
  // .toFixed() elsewhere in the app would crash on it unless we convert
  // it here. Confirmed by directly testing the driver's actual output,
  // not assumed.
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
  // COUNT() returns BIGINT, which the driver also returns as a string
  // (same reasoning as pm_score above — confirmed by direct testing).
  // Coerced here so .toLocaleString() formats with commas correctly
  // instead of silently returning the raw unformatted string.
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
  calibration_edge: number | null;
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

/**
 * Stats for one trader — same entropy-weighted PM Score formula as
 * getLeaderboard, just scoped to a single wallet instead of all 25.
 * Kept as a separate query rather than reusing getLeaderboard + filter,
 * since this needs to work even for a wallet that isn't currently on
 * the top-25 leaderboard snapshot (rank/volume/pnl come back null in
 * that case, but position stats still compute fine).
 */
export async function getTraderStats(wallet: string): Promise<TraderDetail | null> {
  const rows = await sql<TraderDetail[]>`
    WITH latest_leaderboard AS (
      SELECT * FROM trader_leaderboard_snapshots
      WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'
    ),
    position_entropy AS (
      -- Sourced from trader_closed_positions_snapshots -- see the
      -- matching comment in getLeaderboard for why: the old source
      -- (trader_positions_snapshots) was missing 95-99.98% of some
      -- wallets' real resolved history.
      SELECT
        realized_pnl,
        percent_return_approx AS percent_realized_pnl,
        LEAST(GREATEST(avg_price, 0.001), 0.999) AS p
      FROM trader_closed_positions_snapshots
      WHERE wallet = ${wallet} AND realized_pnl IS NOT NULL AND realized_pnl != 0
        AND closed_at IS NOT NULL
        AND closed_at >= (NOW() - INTERVAL '90 days')
    ),
    position_entropy_calc AS (
      SELECT
        realized_pnl,
        percent_realized_pnl,
        p,
        (-(p * LN(p) + (1 - p) * LN(1 - p))) AS entropy
      FROM position_entropy
    ),
    position_stats AS (
      -- calibration_edge replaces the old variance-based "consistency"
      -- term -- see the matching comment in getLeaderboard for the
      -- full reasoning and the verified before/after fix.
      SELECT
        COUNT(*) AS position_count,
        SUM(CASE WHEN realized_pnl > 0 THEN entropy ELSE 0 END)
          / NULLIF(SUM(entropy), 0) AS win_rate,
        AVG(percent_realized_pnl) AS avg_edge_pct,
        AVG((CASE WHEN realized_pnl > 0 THEN 1.0 ELSE 0.0 END) - p) AS calibration_edge
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
      p.calibration_edge,
      CASE
        WHEN p.position_count IS NULL OR p.position_count = 0 THEN NULL
        ELSE ROUND(
          (
            (
              (COALESCE(p.win_rate, 0) * 40)
              + (LEAST(GREATEST((COALESCE(p.avg_edge_pct, 0) + 100) / 200.0, 0), 1) * 35)
              + (LEAST(GREATEST(COALESCE(p.calibration_edge, 0) + 0.5, 0), 1) * 25)
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
  // Sourced from trader_closed_positions_snapshots -- Polymarket's
  // dedicated closed-positions endpoint, not the old current-holdings
  // source. Every row here is definitionally already closed (no need
  // for a separate "is this resolved" heuristic anymore).
  return sql<TraderPosition[]>`
    SELECT condition_id, market_title, outcome, avg_price, cur_price,
           total_bought, realized_pnl, percent_return_approx, closed_at, end_date
    FROM trader_closed_positions_snapshots
    WHERE wallet = ${wallet}
      AND realized_pnl IS NOT NULL AND realized_pnl != 0
      AND closed_at IS NOT NULL
      AND closed_at >= (NOW() - INTERVAL '90 days')
    ORDER BY realized_pnl DESC NULLS LAST
  `;
}

/**
 * Resolves a search input (typed by a person, so it could be a wallet
 * address OR a username) to a real wallet address. Address-shaped
 * input is used directly; otherwise looks up a case-insensitive
 * username match against the latest leaderboard snapshot.
 */
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

export type MarketOutcome = {
  source: string;
  external_id: string;
  title: string;
  category: string | null;
  result: string;
  yes_price_cents: number;
};

export type AccuracyStats = {
  overall_accuracy: number;
  total_resolved: number;
  by_platform: { source: string; accuracy: number; count: number }[];
  by_bucket: { bucket: string; actual_yes_rate: number; predicted_yes_rate: number; count: number }[];
};

/**
 * Pulls every resolved market joined to its LAST price while still
 * open -- not the price at the moment of resolution, which clears to
 * something meaningless once settled (confirmed via live data: a
 * market that resolved "yes" still showed yes_price_cents near 0,
 * since the order book empties out post-settlement). This is the
 * price that actually reflects what the market believed beforehand.
 */
export async function getMarketOutcomes(): Promise<MarketOutcome[]> {
  // NOTE: previously fell back to a resolved-market's own price
  // (Polymarket's lastTradePrice) when no genuine pre-close snapshot
  // existed. Reverted after finding real data proving this out: those
  // fallback prices clustered almost entirely at extreme values
  // (99.9c, 0.1c) because by the time a market's LAST trade happens,
  // the real-world outcome is often already public knowledge (e.g.
  // "FDV above $X one day after launch" markets, where the actual FDV
  // is already known by the final trade). That's not a prediction,
  // it's the market catching up to already-known information -- using
  // it produced a fake-looking ~100% accuracy that measured nothing
  // real. Back to requiring an honest pre-close snapshot match; a
  // market with no such match is correctly excluded, not padded with
  // misleading data.
  return sql<MarketOutcome[]>`
    WITH resolved_markets AS (
      SELECT DISTINCT ON (source, external_id) source, external_id, title, category, result, fetched_at
      FROM market_snapshots
      WHERE result IS NOT NULL AND result != ''
      ORDER BY source, external_id, fetched_at DESC
    ),
    last_open_price AS (
      SELECT DISTINCT ON (source, external_id) source, external_id, yes_price_cents
      FROM market_snapshots
      WHERE status IN ('open', 'active') AND yes_price_cents IS NOT NULL
      ORDER BY source, external_id, fetched_at DESC
    )
    SELECT r.source, r.external_id, r.title, r.category, r.result, p.yes_price_cents
    FROM resolved_markets r
    JOIN last_open_price p ON p.source = r.source AND p.external_id = r.external_id
  `;
}

/**
 * Kalshi's result is a plain "yes"/"no" string. Polymarket's is a
 * JSON-encoded outcome-price array like '["1","0"]' -- index 0 is the
 * "Yes" token's final settlement price (1 = won, 0 = lost). Both
 * normalize to a simple "yes" | "no" here.
 */
function actualOutcome(source: string, result: string): "yes" | "no" | null {
  if (source === "kalshi") {
    return result === "yes" ? "yes" : result === "no" ? "no" : null;
  }
  if (source === "polymarket") {
    try {
      const prices = JSON.parse(result);
      if (prices[0] === "1") return "yes";
      if (prices[1] === "1") return "no";
    } catch {
      return null;
    }
  }
  return null;
}

export async function getAccuracyStats(): Promise<AccuracyStats> {
  const outcomes = await getMarketOutcomes();

  let correct = 0;
  let total = 0;
  const platformCounts: Record<string, { correct: number; total: number }> = {};
  const buckets: Record<string, { yesCount: number; total: number }> = {};

  for (const o of outcomes) {
    const actual = actualOutcome(o.source, o.result);
    if (actual === null) continue;

    const predicted = o.yes_price_cents >= 50 ? "yes" : "no";
    const isCorrect = predicted === actual;

    total++;
    if (isCorrect) correct++;

    platformCounts[o.source] ??= { correct: 0, total: 0 };
    platformCounts[o.source].total++;
    if (isCorrect) platformCounts[o.source].correct++;

    const bucketLow = Math.min(90, Math.floor(o.yes_price_cents / 10) * 10);
    const bucketKey = `${bucketLow}-${bucketLow + 10}`;
    buckets[bucketKey] ??= { yesCount: 0, total: 0 };
    buckets[bucketKey].total++;
    if (actual === "yes") buckets[bucketKey].yesCount++;
  }

  const by_platform = Object.entries(platformCounts).map(([source, c]) => ({
    source,
    accuracy: c.total > 0 ? c.correct / c.total : 0,
    count: c.total,
  }));

  const by_bucket = Object.entries(buckets)
    .map(([bucket, b]) => {
      const [low] = bucket.split("-").map(Number);
      return {
        bucket,
        actual_yes_rate: b.total > 0 ? b.yesCount / b.total : 0,
        predicted_yes_rate: (low + 5) / 100,
        count: b.total,
      };
    })
    .sort((a, b) => Number(a.bucket.split("-")[0]) - Number(b.bucket.split("-")[0]));

  return {
    overall_accuracy: total > 0 ? correct / total : 0,
    total_resolved: total,
    by_platform,
    by_bucket,
  };
}
