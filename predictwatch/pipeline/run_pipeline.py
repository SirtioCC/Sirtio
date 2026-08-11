"""
Main pipeline: fetch from both sources, store a timestamped snapshot.

Storage: Supabase Postgres (free tier). The pipeline connects over the
network using a connection string from the DATABASE_URL environment
variable, so nothing is committed back to the repo and the future
website can query the same live database directly.
"""
import os
import sys

import psycopg2
import psycopg2.extras

import fetch_kalshi
import fetch_polymarket
import fetch_polymarket_leaderboard
import fetch_polymarket_positions

SCHEMA = """
CREATE TABLE IF NOT EXISTS market_snapshots (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS trader_positions_snapshots (
    id BIGSERIAL PRIMARY KEY,
    wallet TEXT NOT NULL,
    condition_id TEXT,
    market_title TEXT,
    outcome TEXT,
    size DOUBLE PRECISION,
    avg_price DOUBLE PRECISION,
    cur_price DOUBLE PRECISION,
    cash_pnl DOUBLE PRECISION,
    realized_pnl DOUBLE PRECISION,
    percent_realized_pnl DOUBLE PRECISION,
    redeemable BOOLEAN,
    end_date TEXT,
    fetched_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positions_wallet ON trader_positions_snapshots(wallet);
CREATE INDEX IF NOT EXISTS idx_positions_fetched_at ON trader_positions_snapshots(fetched_at);
-- Current-state table, not a time series: one row per (wallet, market),
-- updated in place each run instead of appended. Without this, a single
-- wallet like the #1 leaderboard trader (150,000+ positions) would add
-- that many fresh rows on every scheduled run, forever. This unique
-- index is what ON CONFLICT below targets to make that possible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_wallet_condition
    ON trader_positions_snapshots(wallet, condition_id);
"""

INSERT_SQL = """
INSERT INTO market_snapshots
(source, external_id, title, category, yes_price_cents, no_price_cents,
 volume, open_interest, status, close_time, result, fetched_at)
VALUES (%(source)s, %(external_id)s, %(title)s, %(category)s, %(yes_price_cents)s,
        %(no_price_cents)s, %(volume)s, %(open_interest)s, %(status)s,
        %(close_time)s, %(result)s, %(fetched_at)s)
"""

LEADERBOARD_INSERT_SQL = """
INSERT INTO trader_leaderboard_snapshots
(rank, wallet, username, volume, pnl, fetched_at)
VALUES (%(rank)s, %(wallet)s, %(username)s, %(volume)s, %(pnl)s, %(fetched_at)s)
"""

POSITIONS_INSERT_SQL = """
INSERT INTO trader_positions_snapshots
(wallet, condition_id, market_title, outcome, size, avg_price, cur_price,
 cash_pnl, realized_pnl, percent_realized_pnl, redeemable, end_date, fetched_at)
VALUES (%(wallet)s, %(condition_id)s, %(market_title)s, %(outcome)s, %(size)s,
        %(avg_price)s, %(cur_price)s, %(cash_pnl)s, %(realized_pnl)s,
        %(percent_realized_pnl)s, %(redeemable)s, %(end_date)s, %(fetched_at)s)
ON CONFLICT (wallet, condition_id) DO UPDATE SET
    market_title = EXCLUDED.market_title,
    outcome = EXCLUDED.outcome,
    size = EXCLUDED.size,
    avg_price = EXCLUDED.avg_price,
    cur_price = EXCLUDED.cur_price,
    cash_pnl = EXCLUDED.cash_pnl,
    realized_pnl = EXCLUDED.realized_pnl,
    percent_realized_pnl = EXCLUDED.percent_realized_pnl,
    redeemable = EXCLUDED.redeemable,
    end_date = EXCLUDED.end_date,
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


def save_positions_to_supabase(rows):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            psycopg2.extras.execute_batch(cur, POSITIONS_INSERT_SQL, rows)
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
        print("No rows fetched — nothing saved.")

    try:
        leaderboard_rows = fetch_polymarket_leaderboard.run()
        print(f"Polymarket leaderboard: {len(leaderboard_rows)} traders")
        if leaderboard_rows:
            save_leaderboard_to_supabase(leaderboard_rows)
            print(f"Saved {len(leaderboard_rows)} leaderboard rows to Supabase")
    except Exception as e:
        print(f"Polymarket leaderboard fetch failed: {e}")
        leaderboard_rows = []

    try:
        wallets = list({r["wallet"] for r in leaderboard_rows if r.get("wallet")})
        if wallets:
            print(f"Fetching positions for {len(wallets)} leaderboard wallets...")
            position_rows = fetch_polymarket_positions.run(wallets)
            print(f"Polymarket positions: {len(position_rows)} rows across {len(wallets)} wallets")
            if position_rows:
                save_positions_to_supabase(position_rows)
                print(f"Saved {len(position_rows)} position rows to Supabase")
    except Exception as e:
        print(f"Polymarket positions fetch failed: {e}")


if __name__ == "__main__":
    run()
