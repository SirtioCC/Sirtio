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

-- Tracks the latest activity timestamp successfully fetched per wallet,
-- so the daily run only pulls NEW trade/redeem events since last time
-- instead of re-walking up to 2 years of history from scratch every
-- single day. A wallet with no row here is treated as brand new (full
-- 2-year backfill); a wallet with a row only fetches forward from
-- last_activity_ts. See fetch_polymarket_activity.py's run() for how
-- this gets used.
CREATE TABLE IF NOT EXISTS wallet_fetch_state (
    wallet TEXT PRIMARY KEY,
    last_activity_ts BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- Persists each wallet's open (never sold/redeemed) position ledger
-- state between runs -- tokens/cost basis per asset, as a JSON blob
-- (structure mirrors realized_pnl.py's in-memory `positions` dict).
-- Required for incremental fetching to stay correct: a position bought
-- before this run's watermark and sold/redeemed after it needs its
-- real prior cost basis restored, not reconstructed from zero, or its
-- realized PnL would be silently skipped/wrong. See realized_pnl.py's
-- build_realized_pnl_events for the full reasoning.
CREATE TABLE IF NOT EXISTS wallet_open_ledger (
    wallet TEXT PRIMARY KEY,
    positions_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
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


def get_wallet_watermarks(wallets: list[str]) -> dict:
    """
    Load last-successfully-fetched activity timestamps for the given
    wallets from wallet_fetch_state. A wallet with no row here has
    never been successfully fetched before -- fetch_polymarket_activity
    treats an absent wallet as "needs full backfill" automatically, so
    this only needs to return whatever DOES exist, not fill in gaps.
    """
    if not wallets:
        return {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute(
                "SELECT wallet, last_activity_ts FROM wallet_fetch_state WHERE wallet = ANY(%s)",
                (wallets,),
            )
            return {row[0]: row[1] for row in cur.fetchall()}
    finally:
        conn.close()


def save_wallet_watermarks(watermarks: dict):
    """
    Upsert new last-fetched timestamps so next run only pulls activity
    since this point for each wallet, instead of re-walking full
    history every day.
    """
    if not watermarks:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = [
        {"wallet": w, "last_activity_ts": ts, "updated_at": now_iso}
        for w, ts in watermarks.items()
    ]
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            psycopg2.extras.execute_batch(
                cur,
                """
                INSERT INTO wallet_fetch_state (wallet, last_activity_ts, updated_at)
                VALUES (%(wallet)s, %(last_activity_ts)s, %(updated_at)s)
                ON CONFLICT (wallet) DO UPDATE SET
                    last_activity_ts = EXCLUDED.last_activity_ts,
                    updated_at = EXCLUDED.updated_at
                """,
                rows,
            )
        conn.commit()
    finally:
        conn.close()


def get_wallet_open_ledger(wallets: list[str]) -> dict:
    """
    Load each wallet's persisted open-position ledger state (see
    wallet_open_ledger in SCHEMA for why this exists). Returns
    wallet -> {asset: pos_dict}, matching realized_pnl.py's expected
    initial_open_positions shape exactly.
    """
    if not wallets:
        return {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute(
                "SELECT wallet, positions_json FROM wallet_open_ledger WHERE wallet = ANY(%s)",
                (wallets,),
            )
            return {row[0]: row[1] for row in cur.fetchall()}
    finally:
        conn.close()


def save_wallet_open_ledger(new_open_positions: dict, processed_wallets: list):
    """
    Overwrite each wallet's open-ledger state with the freshly computed
    result from realized_pnl.run() -- NOT a merge, since the returned
    dict already IS the correct merge of prior state + this run's new
    events (see realized_pnl.run's docstring).

    processed_wallets: every wallet actually run through realized_pnl
    this pass (activity_wallets from the caller). Any wallet in this
    list but absent from new_open_positions had all its open positions
    resolved/force-closed this run -- its old wallet_open_ledger row is
    deleted rather than left stale, since a leftover row would make a
    future run wrongly restore already-settled positions as if still
    open. A wallet NOT in processed_wallets (e.g. skipped this run
    entirely) is left untouched either way.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            if new_open_positions:
                now_iso = datetime.now(timezone.utc).isoformat()
                rows = [
                    {"wallet": w, "positions_json": psycopg2.extras.Json(positions), "updated_at": now_iso}
                    for w, positions in new_open_positions.items()
                ]
                psycopg2.extras.execute_batch(
                    cur,
                    """
                    INSERT INTO wallet_open_ledger (wallet, positions_json, updated_at)
                    VALUES (%(wallet)s, %(positions_json)s, %(updated_at)s)
                    ON CONFLICT (wallet) DO UPDATE SET
                        positions_json = EXCLUDED.positions_json,
                        updated_at = EXCLUDED.updated_at
                    """,
                    rows,
                )
            now_fully_closed = [w for w in processed_wallets if w not in new_open_positions]
            if now_fully_closed:
                cur.execute(
                    "DELETE FROM wallet_open_ledger WHERE wallet = ANY(%s)",
                    (now_fully_closed,),
                )
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
    #
    # INCREMENTAL FETCHING, added 2026-08-14: without this, every run
    # (including a scheduled daily one) re-walks up to LOOKBACK_DAYS
    # (2 years) of full history for every wallet, forever -- that's what
    # drove pipeline runtime to 4.5+ hours before this fix. Watermarks
    # (wallet_fetch_state) track the last successfully-fetched point per
    # wallet, so a wallet seen before only fetches NEW activity since
    # then. A wallet seen for the first time still gets a full backfill.
    try:
        if activity_wallets:
            watermarks = get_wallet_watermarks(activity_wallets)
            new_wallet_count = len(activity_wallets) - len(watermarks)
            print(f"Fetching trade/redeem activity for {len(activity_wallets)} leaderboard wallets "
                  f"({len(watermarks)} incremental, {new_wallet_count} full backfill)...")
            wallet_events, activity_bot_wallets, new_watermarks = fetch_polymarket_activity.run(
                activity_wallets, watermarks=watermarks
            )
            if activity_bot_wallets:
                print(f"  {len(activity_bot_wallets)} additional wallet(s) hit the "
                      f"activity event cap (likely bot, caught here rather than by "
                      f"the closed-positions cap): {sorted(activity_bot_wallets)}")
            total_events = sum(len(v) for v in wallet_events.values())
            print(f"Polymarket activity: {total_events} trade/redeem events across {len(activity_wallets)} wallets")

            open_ledger = get_wallet_open_ledger(activity_wallets)
            print(f"Building realized PnL ledger ({len(open_ledger)} wallets carrying forward "
                  f"open-position state, including force-close of abandoned resolved positions)...")
            realized_rows, new_open_positions = realized_pnl.run(
                wallet_events, initial_open_positions=open_ledger
            )
            print(f"Realized PnL: {len(realized_rows)} events across {len(activity_wallets)} wallets")
            if realized_rows:
                now = datetime.now(timezone.utc).isoformat()
                for r in realized_rows:
                    r["fetched_at"] = now
                save_realized_pnl_to_supabase(realized_rows)
                print(f"Saved {len(realized_rows)} realized PnL rows to Supabase")
            save_wallet_open_ledger(new_open_positions, activity_wallets)
            print(f"Saved open-ledger state for next run "
                  f"({len(new_open_positions)} wallets still have open positions)")
            if new_watermarks:
                save_wallet_watermarks(new_watermarks)
                print(f"Saved fetch watermarks for {len(new_watermarks)} wallets "
                      f"(next run will only fetch activity newer than this)")
    except Exception as e:
        print(f"Polymarket trade-level realized PnL fetch failed: {e}")


if __name__ == "__main__":
    run()