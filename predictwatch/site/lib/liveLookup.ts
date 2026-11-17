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
// Data API v2. v1 (/closed-positions) was retired and returns HTTP 410
// -- that was the real cause of the "Polymarket did not respond" page on
// the first live deploy (2026-11-16). The pipeline's own fetchers were
// already on v2 (/v2/activity, /v2/leaderboard).
const POSITIONS_URL = "https://data-api.polymarket.com/v2/positions";
const LEADERBOARD_URL = "https://data-api.polymarket.com/v2/leaderboard";
const ACTIVITY_URL = "https://data-api.polymarket.com/v2/activity";
const PAGE_LIMIT = 1000; // v2 max first-page size
// 3 pages = up to 3,000 positions, the same line as the pipeline's
// BOT_POSITION_CAP. Past this the wallet is almost certainly a bot and
// is flagged partial rather than silently scored on a truncated sample.
const MAX_PAGES = 3;
const CACHE_SECONDS = 1800;

export const FULL_WALLET_RE = /^0x[a-f0-9]{40}$/;

// /v2/positions?status=CLOSED row (fields used here only).
type ClosedPosition = {
  condition_id?: string;
  avg_price?: number;
  total_size?: number; // shares
  realized_pnl?: number;
  last_event_at?: number; // epoch seconds
  title?: string;
  outcome?: string;
  event_slug?: string;
};

type V2Page = { data?: ClosedPosition[]; pagination?: { has_more?: boolean; next_cursor?: string | null } };

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
  partial: boolean; // hit MAX_PAGES, or a later page failed
  positions: LivePosition[]; // most recent first, capped for display
  poolComputedAt: string;
  profile: LiveProfile;
};

/**
 * Context that is not part of the score. Added 2026-11-16 after a live
 * lookup of an all-time #14 trader ($7.5M PnL) rendered "$0" and "--"
 * because the wallet had not traded since June -- correct for a 30-day
 * score, but it read as a bug. All fields are best-effort: a failed call
 * leaves them null and never fails the page.
 */
export type LiveProfile = {
  username: string | null;
  allTimeRank: number | null;
  allTimePnl: number | null;
  lastActivityAt: string | null;
};

type LeaderboardUser = { data?: { user_name?: string; rank_pnl?: number; pnl?: number } | null };
type ActivityPage = { data?: { timestamp?: number; name?: string }[] };

async function fetchProfile(wallet: string): Promise<LiveProfile> {
  const [lb, act] = await Promise.allSettled([
    fetchPage<LeaderboardUser>(`${LEADERBOARD_URL}?time_period=all&user=${wallet}`),
    fetchPage<ActivityPage>(`${ACTIVITY_URL}?user=${wallet}&limit=1`),
  ]);
  const u = lb.status === "fulfilled" ? lb.value.data ?? null : null;
  const last = act.status === "fulfilled" ? act.value.data?.[0] ?? null : null;
  return {
    username: u?.user_name || last?.name || null,
    allTimeRank: u?.rank_pnl ?? null,
    allTimePnl: u?.pnl ?? null,
    lastActivityAt: last?.timestamp ? new Date(last.timestamp * 1000).toISOString() : null,
  };
}

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

// Same browser User-Agent the pipeline fetchers send. Polymarket's edge
// rejects or throttles some requests with a bare server User-Agent.
const HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 8000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One page, with retries. First live failure (2026-11-16): a second
 * lookup in a row failed the whole page on one bad response. Retries
 * cover 429 / 5xx / network errors / timeouts; a 4xx other than 429 is
 * a real error and is not retried.
 */
async function fetchPage<T = V2Page>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        next: { revalidate: CACHE_SECONDS },
        headers: HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        return (await res.json()) as T;
      }
      lastErr = new Error(`Polymarket v2/positions HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 700 * attempt);
    } catch (err) {
      lastErr = err;
      await sleep(700 * attempt);
    }
  }
  throw lastErr;
}

async function fetchClosedPositions(wallet: string): Promise<{ items: ClosedPosition[]; partial: boolean }> {
  // `start` filters on last_event_at server-side, so only the 30-day
  // window comes back -- no client-side early-stop needed. The cursor
  // does not carry `start`/`end`, so they are re-sent on every page.
  const start = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
  const items: ClosedPosition[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    // TIMESTAMP DESC (newest first), not the CLOSED default of
    // REALIZED_PNL: if a bot wallet gets cut off at MAX_PAGES, the sample
    // is its most recent trades, not its most profitable ones.
    const params = new URLSearchParams({
      user: wallet, status: "CLOSED", start: String(start),
      sort_by: "TIMESTAMP", sort_direction: "DESC",
    });
    if (cursor) params.set("cursor", cursor);
    else params.set("limit", String(PAGE_LIMIT));

    let body: V2Page;
    try {
      body = await fetchPage(`${POSITIONS_URL}?${params}`);
    } catch (err) {
      // Page 1 failing means we have nothing: let the caller show the
      // error. A later page failing still leaves a real sample, so score
      // it and mark it partial instead of throwing it all away.
      if (page === 0) throw err;
      console.error("liveLookup: later page failed, scoring partial", wallet, page, err);
      return { items, partial: true };
    }
    items.push(...(body.data ?? []));
    cursor = body.pagination?.has_more ? body.pagination.next_cursor ?? null : null;
    if (!cursor) return { items, partial: false };
  }
  return { items, partial: true };
}

/**
 * Scores one wallet live. Returns null only if the population stats are
 * missing (pipeline never ran). Throws if Polymarket is unreachable --
 * the page catches that and shows a retry message.
 */
export async function liveLookup(wallet: string): Promise<LiveLookupResult | null> {
  const [pop, { items, partial }, profile] = await Promise.all([
    getPopulationStats(),
    fetchClosedPositions(wallet),
    fetchProfile(wallet),
  ]);
  if (!pop) return null;

  // Group by condition_id: the pipeline scores at the market level
  // (GROUP BY wallet, condition_id), so a wallet that held both sides of
  // one market counts as one position, not two.
  const byMarket = new Map<string, { pnl: number; cost: number }>();
  let realizedPnl30d = 0;
  const positions: LivePosition[] = [];

  for (const p of items) {
    const pnl = Number(p.realized_pnl ?? 0);
    // Cost basis in dollars = avg_price * total_size (shares). Matches
    // the pipeline's SUM(avg_cost * size), and reproduces Polymarket's own
    // percent_realized_pnl exactly (checked on a live row 2026-11-16).
    const cost = Number(p.avg_price ?? 0) * Number(p.total_size ?? 0);
    realizedPnl30d += pnl;

    const key = p.condition_id ?? `${p.title}-${p.last_event_at}`;
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
        closedAt: p.last_event_at ? new Date(p.last_event_at * 1000).toISOString() : "",
        url: p.event_slug ? `https://polymarket.com/event/${p.event_slug}` : null,
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
    profile,
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
