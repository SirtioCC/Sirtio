"""
Main pipeline: fetch from both sources, store a timestamped snapshot.

Storage: Supabase Postgres (free tier). The pipeline connects over the
network using a connection string from the DATABASE_URL environment
variable, so nothing is committed back to the repo and the future
website can query the same live database directly.
"""
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

import fetch_kalshi
import fetch_polymarket
import fetch_polymarket_leaderboard
import fetch_polymarket_closed_positions
import fetch_polymarket_activity
import realized_pnl

SCHEMA = """
CREATE TABLE IF NOT EXISTS market_snapshots (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    slug TEXT,
    title TEXT,
    category TEXT,
    yes_price_cents DOUBLE PRECISION,
    no_price_cents DOUBLE PRECISION,
    volume DOUBLE PRECISION,
    open_interest DOUBLE PRECISION,
    status TEXT,
    close_time TEXT,
    result TEXT,
    fetched_at TIMESTAMPTZ NOT NULL
);
-- market_snapshots already existed before slug was added -- CREATE TABLE
-- IF NOT EXISTS above is a no-op against it, so add the column explicitly.
ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE INDEX IF NOT EXISTS idx_source_extid ON market_snapshots(source, external_id);
CREATE INDEX IF NOT EXISTS idx_fetched_at ON market_snapshots(fetched_at);

CREATE TABLE IF NOT EXISTS trader_leaderboard_snapshots (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'polymarket',
    rank INTEGER,
    wallet TEXT NOT NULL,
    username TEXT,
    volume DOUBLE PRECISION,
    pnl DOUBLE PRECISION,
    fetched_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet ON trader_leaderboard_snapshots(wallet);
CREATE INDEX IF NOT EXISTS idx_leaderboard_fetched_at ON trader_leaderboard_snapshots(fetched_at);

CREATE TABLE IF NOT EXISTS trader_closed_positions_snapshots (
    id BIGSERIAL PRIMARY KEY,
    wallet TEXT NOT NULL,
    condition_id TEXT,
    market_title TEXT,
    outcome TEXT,
    avg_price DOUBLE PRECISION,
    cur_price DOUBLE PRECISION,
    total_bought DOUBLE PRECISION,
    realized_pnl DOUBLE PRECISION,
    percent_return_approx DOUBLE PRECISION,
    closed_at TIMESTAMPTZ,
    end_date TEXT,
    fetched_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_closed_positions_wallet ON trader_closed_positions_snapshots(wallet);
CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_positions_wallet_condition
    ON trader_closed_positions_snapshots(wallet, condition_id);

CREATE TABLE IF NOT EXISTS trader_realized_pnl_events (
    id BIGSERIAL PRIMARY KEY,
    wallet TEXT NOT NULL,
    condition_id TEXT,
    asset TEXT NOT NULL,
    market_title TEXT,
    outcome TEXT,
    event_type TEXT NOT NULL,
    price DOUBLE PRECISION,
    size DOUBLE PRECISION,
    avg_cost DOUBLE PRECISION,
    realized_pnl DOUBLE PRECISION,
    closed_at TIMESTAMPTZ,
    transaction_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_realized_pnl_wallet ON trader_realized_pnl_events(wallet);
CREATE INDEX IF NOT EXISTS idx_realized_pnl_closed_at ON trader_realized_pnl_events(closed_at);
-- transaction_hash uniquely identifies a real TRADE_SELL/REDEEM event.
-- FORCE_CLOSE_RESOLVED rows (which have no real transaction) use a
-- deterministic synthetic hash instead of a fetch-time value -- so a
-- rerun updates the same row (refreshed closed_at/pnl) instead of
-- inserting a new duplicate every single pipeline run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_realized_pnl_wallet_asset_txhash
    ON trader_realized_pnl_events(wallet, asset, transaction_hash);
"""

INSERT_SQL = """
INSERT INTO market_snapshots
(source, external_id, slug, title, category, yes_price_cents, no_price_cents,
 volume, open_interest, status, close_time, result, fetched_at)
VALUES (%(source)s, %(external_id)s, %(slug)s, %(title)s, %(category)s, %(yes_price_cents)s,
        %(no_price_cents)s, %(volume)s, %(open_interest)s, %(status)s,
        %(close_time)s, %(result)s, %(fetched_at)s)
"""

LEADERBOARD_INSERT_SQL = """
INSERT INTO trader_leaderboard_snapshots
(rank, wallet, username, volume, pnl, fetched_at)
VALUES (%(rank)s, %(wallet)s, %(username)s, %(volume)s, %(pnl)s, %(fetched_at)s)
"""

CLOSED_POSITIONS_INSERT_SQL = """
INSERT INTO trader_closed_positions_snapshots
(wallet, condition_id, market_title, outcome, avg_price, cur_price,
 total_bought, realized_pnl, percent_return_approx, closed_at, end_date, fetched_at)
VALUES (%(wallet)s, %(condition_id)s, %(market_title)s, %(outcome)s, %(avg_price)s,
        %(cur_price)s, %(total_bought)s, %(realized_pnl)s, %(percent_return_approx)s,
        %(closed_at)s, %(end_date)s, %(fetched_at)s)
ON CONFLICT (wallet, condition_id) DO UPDATE SET
    market_title = EXCLUDED.market_title,
    outcome = EXCLUDED.outcome,
    avg_price = EXCLUDED.avg_price,
    cur_price = EXCLUDED.cur_price,
    total_bought = EXCLUDED.total_bought,
    realized_pnl = EXCLUDED.realized_pnl,
    percent_return_approx = EXCLUDED.percent_return_approx,
    closed_at = EXCLUDED.closed_at,
    end_date = EXCLUDED.end_date,
    fetched_at = EXCLUDED.fetched_at
"""

REALIZED_PNL_INSERT_SQL = """
INSERT INTO trader_realized_pnl_events
(wallet, condition_id, asset, market_title, outcome, event_type, price,
 size, avg_cost, realized_pnl, closed_at, transaction_hash, fetched_at)
VALUES (%(wallet)s, %(condition_id)s, %(asset)s, %(market_title)s, %(outcome)s,
        %(event_type)s, %(price)s, %(size)s, %(avg_cost)s, %(realized_pnl)s,
        %(closed_at)s, %(transaction_hash)s, %(fetched_at)s)
ON CONFLICT (wallet, asset, transaction_hash) DO UPDATE SET
    market_title = EXCLUDED.market_title,
    outcome = EXCLUDED.outcome,
    event_type = EXCLUDED.event_type,
    price = EXCLUDED.price,
    size = EXCLUDED.size,
    avg_cost = EXCLUDED.avg_cost,
    realized_pnl = EXCLUDED.realized_pnl,
    closed_at = EXCLUDED.closed_at,
    fetched_at = EXCLUDED.fetched_at
"""


def get_connection():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: DATABASE_URL environment variable is not set.\n"
            "Get this from Supabase: Project Settings -> Database -> Connection string "
            "(use the 'Transaction' pooler URI, port 6543, for serverless-style "
            "connections like GitHub Actions).\n"
            "Set it locally with: export DATABASE_URL='postgresql://...'\n"
            "Set it in GitHub Actions as a repo secret named DATABASE_URL."
        )
        sys.exit(1)
    return psycopg2.connect(db_url)


def save_to_supabase(rows):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            psycopg2.extras.execute_batch(cur, INSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()


def save_leaderboard_to_supabase(rows):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            psycopg2.extras.execute_batch(cur, LEADERBOARD_INSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()


def save_closed_positions_to_supabase(rows):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            psycopg2.extras.execute_batch(cur, CLOSED_POSITIONS_INSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()


def save_realized_pnl_to_supabase(rows):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            psycopg2.extras.execute_batch(cur, REALIZED_PNL_INSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()


def run():
    all_rows = []

    try:
        kalshi_rows = fetch_kalshi.run()
        print(f"Kalshi: {len(kalshi_rows)} markets")
        all_rows.extend(kalshi_rows)
    except Exception as e:
        print(f"Kalshi fetch failed: {e}")

    try:
        poly_rows = fetch_polymarket.run()
        print(f"Polymarket: {len(poly_rows)} markets")
        all_rows.extend(poly_rows)
    except Exception as e:
        print(f"Polymarket fetch failed: {e}")

    if all_rows:
        save_to_supabase(all_rows)
        print(f"Saved {len(all_rows)} rows to Supabase")
    else:
        print("No rows fetched - nothing saved.")

    try:
        leaderboard_rows = fetch_polymarket_leaderboard.run()
        print(f"Polymarket leaderboard: {len(leaderboard_rows)} traders")
        if leaderboard_rows:
            save_leaderboard_to_supabase(leaderboard_rows)
            print(f"Saved {len(leaderboard_rows)} leaderboard rows to Supabase")
    except Exception as e:
        print(f"Polymarket leaderboard fetch failed: {e}")
        leaderboard_rows = []

    # NOTE: previously also fetched /positions ("current holdings") here
    # via fetch_polymarket_positions.run(wallets) into
    # trader_positions_snapshots. Removed 2026-08-13 -- that data was
    # never actually read by the site (nothing in site/lib/queries.ts
    # queries trader_positions_snapshots), and the endpoint has no
    # 90-day window or bot-position cap, so it was fetching a wallet's
    # entire position history every run regardless -- one wallet alone
    # hit 10,494 positions after dedup, capped only by a hardcoded
    # 300-page/150,000-row safety net. Pure wasted runtime for unused
    # data. trader_positions_snapshots itself is left alone in Supabase
    # (old data, harmless, just stops growing) rather than dropped.
    wallets = list({r["wallet"] for r in leaderboard_rows if r.get("wallet")})

    try:
        if wallets:
            print(f"Fetching closed positions for {len(wallets)} leaderboard wallets...")
            closed_rows, bot_wallets = fetch_polymarket_closed_positions.run(wallets)
            print(f"Polymarket closed positions: {len(closed_rows)} rows across {len(wallets)} wallets")
            if closed_rows:
                save_closed_positions_to_supabase(closed_rows)
                print(f"Saved {len(closed_rows)} closed position rows to Supabase")
    except Exception as e:
        print(f"Polymarket closed positions fetch failed: {e}")
        closed_rows, bot_wallets = [], set()

    # Bot filter: a wallet with an extreme resolved-position count in a
    # 90-day window isn't a human placing predictions -- it's almost
    # certainly a market-making / arbitrage script. These wallets were
    # dominating pipeline runtime (each one triggering huge pagination
    # above, and a huge full-history activity/ledger fetch below) without
    # representing the kind of trader this leaderboard is meant to
    # surface. bot_wallets comes straight from fetch_polymarket_closed_
    # positions.run() above, which now stops paginating a wallet the
    # moment its running count crosses BOT_POSITION_CAP, rather than
    # fetching everything first and judging afterward.
    if bot_wallets:
        print(f"Filtering out {len(bot_wallets)} likely-bot wallet(s) from the "
              f"activity fetch (exceeded resolved-position cap): {sorted(bot_wallets)}")
    activity_wallets = [w for w in wallets if w not in bot_wallets]

    # Trade-level realized PnL -- the actual fix for /closed-positions'
    # survivorship bias (see fetch_polymarket_activity.py and
    # realized_pnl.py for the full reasoning). This is what the site's
    # "90-day PnL" leaderboard column should be computed from, not the
    # closed-positions table above, which only reflects wins.
    try:
        if activity_wallets:
            print(f"Fetching full trade/redeem activity for {len(activity_wallets)} leaderboard wallets...")
            wallet_events, activity_bot_wallets = fetch_polymarket_activity.run(activity_wallets)
            if activity_bot_wallets:
                print(f"  {len(activity_bot_wallets)} additional wallet(s) hit the "
                      f"activity event cap (likely bot, caught here rather than by "
                      f"the closed-positions cap): {sorted(activity_bot_wallets)}")
            total_events = sum(len(v) for v in wallet_events.values())
            print(f"Polymarket activity: {total_events} trade/redeem events across {len(activity_wallets)} wallets")
            print("Building realized PnL ledger (including force-close of abandoned resolved positions)...")
            realized_rows = realized_pnl.run(wallet_events)
            print(f"Realized PnL: {len(realized_rows)} events across {len(activity_wallets)} wallets")
            if realized_rows:
                now = datetime.now(timezone.utc).isoformat()
                for r in realized_rows:
                    r["fetched_at"] = now
                save_realized_pnl_to_supabase(realized_rows)
                print(f"Saved {len(realized_rows)} realized PnL rows to Supabase")
    except Exception as e:
        print(f"Polymarket trade-level realized PnL fetch failed: {e}")


if __name__ == "__main__":
    run()