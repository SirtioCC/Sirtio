# PredictWatch (working name)

A full prediction-market analytics suite — market data, trader
leaderboards, category trends, and daily content — across Kalshi and
Polymarket. The differentiator on top: **a trader skill score (PM
Score)** that answers "is this trader actually good, or did they get
lucky?" instead of just ranking by raw dollar PnL like every other
leaderboard out there. That's the thing competitors don't have, not
the whole product. Free tier: leaderboards, market data, daily
writeups — built for traffic and SEO. Paid tier: depth (full trader
histories, alerts, category breakdowns). Framed as analytics/
intelligence, deliberately not "betting advice" — see the regulatory
note below for why that framing matters.

## What the dashboard actually shows (full suite, not just PM Score)

**Market analytics** (cross-platform, from `market_snapshots`):
- Trending/most-active markets, biggest 24h probability swings
- Category-level views (elections, Fed decisions, sports, crypto)
- Kalshi-vs-Polymarket price gaps on equivalent markets
- Market accuracy leaderboard, once markets resolve (which
  categories/platforms are best-calibrated)

**Trader analytics** (Polymarket-only — see scope note below):
- Leaderboard by volume, by raw PnL, by win rate
- **PM Score** — the skill-adjusted ranking (the differentiator)
- Individual trader profile pages: position history, category
  breakdown, holding time, position sizing
- Trader comparison view (A vs. B, side by side)

**Content layer:**
- Daily auto-generated recap (movers, new markets, notable gaps)
- Evergreen category pages
- Per-trader SEO pages once PM Score exists

**Personal tools** (later, once there's a logged-in layer):
watchlists, saved traders, custom alerts.

PM Score is one card on a trader's profile page, not the whole site.

## Why this can be near-zero-cost

- **Data**: Kalshi's Trade API and Polymarket's Gamma API are both
  fully public for read-only market data — no API key, no cost.
- **Pipeline**: runs on GitHub Actions (free for scheduled jobs).
- **Storage**: Supabase Postgres, free tier (500MB database, more
  than enough for a long while of market snapshots).
- **Site** (later): Next.js on Vercel's free tier, querying the same
  Supabase database live.
- **Only real cost**: a domain name (~$12/year).

## Repo layout

```
pipeline/
  fetch_kalshi.py                  - pulls open markets from Kalshi's public API
  fetch_polymarket.py              - pulls active markets from Polymarket's Gamma API
  fetch_polymarket_leaderboard.py  - pulls Polymarket's public trader leaderboard
  run_pipeline.py                   - runs all three, normalizes, saves to Supabase
.github/workflows/
  fetch-data.yml                    - runs the pipeline every 4 hours, for free
```

**Two datasets, two different analytics products:**
- `market_snapshots` — market-level prices/volume/category/outcome
  from both Kalshi and Polymarket. This builds the **market accuracy
  leaderboard** ("election markets are well-calibrated, celebrity
  markets aren't") once enough markets have resolved.
- `trader_leaderboard_snapshots` — Polymarket's public top-trader
  rankings by rank/wallet/username/volume/PnL, snapshotted over time.
  This builds a **trader leaderboard/watchlist** ("this wallet has
  been consistently profitable over N months").

**Important scope note — read this before writing any content copy:**
the trader leaderboard and any trader skill score are **Polymarket-only**.
Kalshi accounts aren't public, so there's no equivalent trader-level
data available from Kalshi — a cross-platform trader leaderboard, or
any "Kalshi vs. Polymarket: whose traders are better" content, is
**not buildable** with public data. Don't write that headline. The
`market_snapshots` accuracy leaderboard is the only piece that's
genuinely cross-platform. Also worth flagging: `trader_leaderboard_snapshots`
only captures whoever is in Polymarket's top-25 at fetch time — a
snapshot, not a full history of every trader who's ever traded.

**Verified 2026-08-10:** I pulled live data from all three endpoints
(my sandbox can't hit them directly, so I went through search/fetch
instead) and found the real field names differ from what most
third-party docs show — Kalshi returns prices as decimal-dollar
strings like `yes_bid_dollars: "0.1570"` rather than plain integer
cents, and volume/open interest come back as `volume_fp` /
`open_interest_fp`. Polymarket's market fields matched expectations
closely (`question`, `outcomePrices`, `volume`, `liquidity` — the
last two as numeric strings; there's no top-level `category` field).
The leaderboard endpoint returned `rank`, `proxyWallet`, `userName`,
`vol`, `pnl` exactly as expected. All three normalizers have been
corrected and tested against real captured samples. Still worth
running locally once yourself, since API shapes do drift over time.

## One-time Supabase setup (free)

1. Create a free account at supabase.com and a new project.
2. In the project, go to **Project Settings → Database → Connection
   string**. Use the **Transaction pooler** URI (port 6543) — it's
   built for short-lived connections like a scheduled script, unlike
   the direct connection which is meant for persistent connections.
3. Copy that URI — it looks like
   `postgresql://postgres.xxxx:[PASSWORD]@aws-...pooler.supabase.com:6543/postgres`.
   You'll need it in two places below.

## Running locally

```bash
cd pipeline
pip install -r requirements.txt
export DATABASE_URL="postgresql://...your Supabase connection string..."
python run_pipeline.py
```

The script creates the `market_snapshots` table automatically on
first run, then inserts a new snapshot each time it's called.

## Setting up the free automated pipeline

1. Push this repo to GitHub (public repo keeps Actions fully free).
2. In the GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**. Name it `DATABASE_URL`, paste the same
   Supabase connection string.
3. GitHub Actions will run `fetch-data.yml` on the built-in schedule
   (every 4 hours) — no other setup needed.
4. Every run writes straight into Supabase. This is your growing
   historical dataset — the thing that becomes the accuracy
   leaderboard once markets start resolving — and it's already in a
   database the future website can query live, no extra migration
   needed.

## Content plan (Phase 2)

- **Daily post**: biggest probability swings, new markets, one
  interesting cross-platform price gap. Can be generated straight
  from Supabase with a template — script this once the pipeline has
  a few days of data to work with.
- **Evergreen category pages** (elections, Fed decisions, sports,
  crypto): auto-updating, built for recurring search traffic.
- **Per-trader pages** (`/trader/0x...`), one per wallet tracked in
  `trader_leaderboard_snapshots` — each becomes its own indexable
  page once the PM Score exists. This is a proven SEO pattern (same
  shape as per-stock or per-player pages elsewhere) but needs the
  scoring model in place first — don't build empty pages.

## Tool plan (Phase 3 — the actual moat)

Two products, both compounding value the longer the pipeline runs,
both requiring history that can't be faked or cloned overnight:

### 1. Market accuracy leaderboard (cross-platform)
Once markets in `market_snapshots` start resolving (the `result`
field gets populated), compute accuracy by category/platform/
time-to-close. This is the one piece that genuinely compares Kalshi
and Polymarket against each other.

### 2. Trader skill score (Polymarket-only)
The core insight worth keeping from outside feedback: **rank traders
by skill, not by raw dollar PnL.** A wallet with one $2M lucky bet
and a wallet with a smaller but consistent edge look identical on a
plain leaderboard — that's not useful, and it's also not hard to
build something better, given what `trader_positions_snapshots`
already gives us per position: `realized_pnl`, `percent_realized_pnl`,
`avg_price` vs `cur_price`, and market metadata (category, end date).

**First-pass scoring formula (v0 — a starting point, not final):**
```
For each wallet, using its resolved positions only:

  win_rate           = wins / total_resolved_positions
  sample_size_factor = min(1.0, total_resolved_positions / 30)
                        # damps scores built on too few trades —
                        # this is the survivorship-bias guard:
                        # a wallet with 3 resolved bets shouldn't
                        # outrank one with 300
  avg_edge           = mean(percent_realized_pnl across positions)
  consistency        = 1 - stdev(percent_realized_pnl) / (abs(mean) + 1)
                        # rewards steady edge over one huge outlier

  raw_score = (win_rate * 40) + (normalized(avg_edge) * 35)
              + (consistency * 25)

  PM_Score = raw_score * sample_size_factor   # 0-100
```
This needs real backtesting against accumulated data before it means
anything — the weights above are a reasonable starting guess, not a
validated model. Treat this as Phase 3 R&D, not a feature to ship
blind. Calibration by category (a wallet that's sharp on sports
markets but bad on politics) is a natural v1 extension once there's
enough resolved history per category to make that split meaningful.

### Monetization shape (realistic version)
- **Free**: leaderboards, PM Score summary per wallet, daily content.
- **Paid ($15-20/mo range)**: full position history per wallet,
  category-level breakdowns, alerts on leaderboard wallets' new
  trades, watchlists.
- **Treat revenue projections as a ceiling, not a plan** — conversion
  from free to paid on a brand-new site is unproven until real users
  show up; don't build a business plan around clean multiplication
  (e.g. "500 users × $19 = $9,500/mo") before there's a funnel to
  measure.
- **Deprioritized for now**: affiliate/referral revenue (unconfirmed
  whether either platform even offers this, and both are actively
  fighting state gambling-law suits — see below — so they may not
  want the association) and institutional data-resale tiers (not
  realistic until the pipeline has uptime guarantees and much deeper
  history than a solo GitHub Actions cron job provides).

### Regulatory note (why "analytics," not "betting advice")
As of Aug 2026, a federal judge ruled Utah can enforce its anti-
gambling law against Kalshi specifically; Kalshi is appealing, and
outcomes have gone both ways across other states (blocked in some,
allowed in others). The legal footing under prediction markets is
genuinely unsettled. Keep the site framed as data/analytics about
public information, not as trading or betting advice — and if a
future paid tier ever resells raw data, read Polymarket's and
Kalshi's current ToS in full first; I couldn't confirm explicit
resale/commercial-reuse terms from public pages alone.

**Honest caveat on the positions data:** I confirmed the schema
against Polymarket's official OpenAPI spec and a published example
response, but couldn't get a live 200 from this specific endpoint
through my sandbox (400 errors — likely anti-bot protection on this
route specifically; `/leaderboard` and `/markets` both worked fine
for comparison). Run `python fetch_polymarket_positions.py` locally
by itself first to confirm it returns real data before relying on
the full pipeline.

## Next steps

1. Run the pipeline locally, confirm real data comes back cleanly.
2. Push to GitHub, confirm the Action runs on schedule.
3. Let it accumulate data for a couple weeks while we build the
   Next.js site on top of it.
