/**
 * Live wallet lookup -- scores ANY Polymarket wallet on request, without
 * writing anything to Supabase.
 *
 * Why: the pipeline only stores wallets that have entered Polymarket's
 * top 100 (storing every wallet would blow past the Supabase storage
 * budget). Before this, any other wallet hit a dead-end "No data for
 * this wallet yet" page. Now the trader page falls back to this module:
 * pull the wallet's last 30 days of closed positions straight from
 * Polymarket's public Data API, score it in memory against the CURRENT
 * tracked-pool population stats, render, and discard.
 *
 * Only one Supabase read happens: the latest sirtio_score_population_stats
 * row (mu/sigma2/tau2/k). Using the pool's own stats means a live score is
 * on the same scale as every leaderboard score -- a 72 here means what a
 * 72 means on the leaderboard. The wallet itself does NOT join the pool,
 * so a lookup can never move anyone else's score.
 *
 * Caching: Polymarket responses use Next's fetch data cache (30 min per
 * wallet/page). That is Vercel's cache, not Supabase storage, and it is
 * what keeps a shared link or repeated lookups from hammering Polymarket.
 *
 * Math MUST stay in sync with pipeline/sirtio_score.py. If you change a
 * constant or formula there, change it here too.
 */
import sql from "./db";

// --- mirrored from pipeline/sirtio_score.py ---
const MIN_POSITION_COST_BASIS = 25.0;
const MAX_ABS_PCT_RETURN = 1000.0;
const MIN_TRADER_VARIANCE = 100.0;
const PRIOR_VARIANCE_DF = 15;
const WINDOW_DAYS = 30;

// --- live-lookup limits ---
const CLOSED_POSITIONS_URL = "https://data-api.polymarket.com/closed-positions";
const PAGE_LIMIT = 50; // API max for this endpoint
// 20 pages = up to 1,000 positions. Keeps a lookup to a few seconds and
// bounds Polymarket calls per request. A wallet past this is almost
// certainly a bot (pipeline's own BOT_POSITION_CAP is 3,000) and gets
// flagged as partial rather than silently scored on a truncated sample.
const MAX_PAGES = 20;
const CACHE_SECONDS = 1800;

export const FULL_WALLET_RE = /^0x[a-f0-9]{40}$/;

type ClosedPosition = {
  conditionId?: string;
  avgPrice?: number;
  totalBought?: number;
  realizedPnl?: number;
  timestamp?: number;
  title?: string;
  outcome?: string;
  slug?: string;
  eventSlug?: string;
};

export type LivePosition = {
  title: string;
  outcome: string | null;
  realizedPnl: number;
  costBasis: number;
  pctReturn: number | null;
  closedAt: string;
  url: string | null;
};

export type LiveLookupResult = {
  wallet: string;
  score: number | null; // null when no qualifying positions
  positionCount: number; // positions that count toward the score
  totalPositions: number; // all closed positions in the window
  realizedPnl30d: number;
  avgEdgePct: number | null;
  shrunkEdgePct: number | null;
  partial: boolean; // hit MAX_PAGES before the 30-day cutoff
  positions: LivePosition[]; // most recent first, capped for display
  poolComputedAt: string;
};

type PopStats = { mu: number; sigma2: number; tau2: number; k: number; computed_at: string };

async function getPopulationStats(): Promise<PopStats | null> {
  const rows = await sql<PopStats[]>`
    SELECT mu, sigma2, tau2, k, computed_at
    FROM sirtio_score_population_stats
    ORDER BY computed_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    mu: Number(r.mu),
    sigma2: Number(r.sigma2),
    tau2: Number(r.tau2),
    k: Number(r.k),
    computed_at: new Date(r.computed_at).toISOString(),
  };
}

async function fetchClosedPositions(wallet: string): Promise<{ items: ClosedPosition[]; partial: boolean }> {
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
  const items: ClosedPosition[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      user: wallet,
      limit: String(PAGE_LIMIT),
      offset: String(page * PAGE_LIMIT),
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    });
    const res = await fetch(`${CLOSED_POSITIONS_URL}?${params}`, {
      next: { revalidate: CACHE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Polymarket closed-positions ${res.status}`);
    const batch = (await res.json()) as ClosedPosition[];
    if (!Array.isArray(batch) || batch.length === 0) return { items, partial: false };

    for (const p of batch) {
      // Sorted newest-first: the first too-old row means everything after
      // it is older too (same early-stop as the pipeline fetcher).
      if (p.timestamp != null && p.timestamp < cutoff) return { items, partial: false };
      items.push(p);
    }
    if (batch.length < PAGE_LIMIT) return { items, partial: false };
  }
  return { items, partial: true };
}

/**
 * Scores one wallet live. Returns null only if the population stats are
 * missing (pipeline never ran). Throws if Polymarket is unreachable --
 * the page catches that and shows a retry message.
 */
export async function liveLookup(wallet: string): Promise<LiveLookupResult | null> {
  const [pop, { items, partial }] = await Promise.all([
    getPopulationStats(),
    fetchClosedPositions(wallet),
  ]);
  if (!pop) return null;

  // Group by condition_id: the pipeline scores at the market level
  // (GROUP BY wallet, condition_id), so a wallet that held both sides of
  // one market counts as one position, not two.
  const byMarket = new Map<string, { pnl: number; cost: number }>();
  let realizedPnl30d = 0;
  const positions: LivePosition[] = [];

  for (const p of items) {
    const pnl = Number(p.realizedPnl ?? 0);
    // totalBought is shares; cost basis in dollars = avgPrice * shares.
    // Matches the pipeline's SUM(avg_cost * size).
    const cost = Number(p.avgPrice ?? 0) * Number(p.totalBought ?? 0);
    realizedPnl30d += pnl;

    const key = p.conditionId ?? `${p.title}-${p.timestamp}`;
    const agg = byMarket.get(key) ?? { pnl: 0, cost: 0 };
    agg.pnl += pnl;
    agg.cost += cost;
    byMarket.set(key, agg);

    if (positions.length < 50) {
      positions.push({
        title: p.title ?? "Unknown market",
        outcome: p.outcome ?? null,
        realizedPnl: pnl,
        costBasis: cost,
        pctReturn: cost > 0 ? (pnl / cost) * 100 : null,
        closedAt: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : "",
        url: p.eventSlug ? `https://polymarket.com/event/${p.eventSlug}` : null,
      });
    }
  }

  // Sufficient statistics, same filters as fetch_position_returns().
  let n = 0;
  let sum = 0;
  let sumsq = 0;
  for (const { pnl, cost } of byMarket.values()) {
    if (cost < MIN_POSITION_COST_BASIS) continue;
    const r = (pnl / cost) * 100;
    if (Math.abs(r) > MAX_ABS_PCT_RETURN) continue;
    n += 1;
    sum += r;
    sumsq += r * r;
  }

  const base = {
    wallet,
    positionCount: n,
    totalPositions: byMarket.size,
    realizedPnl30d,
    partial,
    positions,
    poolComputedAt: pop.computed_at,
  };

  if (n === 0) {
    return { ...base, score: null, avgEdgePct: null, shrunkEdgePct: null };
  }

  // Same per-trader math as compute_scores(), with the pool's mu/sigma2/
  // tau2/k held fixed.
  const rBar = sum / n;
  const dfSample = n - 1;
  const sampleVar = dfSample > 0 ? Math.max((sumsq - (sum * sum) / n) / dfSample, 0) : 0;
  let sigmaI2 = (dfSample * sampleVar + PRIOR_VARIANCE_DF * pop.sigma2) / (dfSample + PRIOR_VARIANCE_DF);
  sigmaI2 = Math.max(sigmaI2, MIN_TRADER_VARIANCE);

  let w: number;
  let omega2: number;
  if (pop.tau2 > 0) {
    const prec = n / sigmaI2 + 1 / pop.tau2;
    w = n / sigmaI2 / prec;
    omega2 = 1 / prec;
  } else {
    w = 0;
    omega2 = sigmaI2 / n;
  }
  const theta = w * rBar + (1 - w) * pop.mu;
  const omega = omega2 > 0 ? Math.sqrt(omega2) : 1e-9;
  const z = theta / omega;
  const score = Math.round((100 / (1 + Math.exp(-pop.k * z))) * 10) / 10;

  return { ...base, score, avgEdgePct: rBar, shrunkEdgePct: theta };
}
