"""
Fetch a wallet's raw on-chain TRADE, REDEEM, SPLIT, and MERGE activity
from Polymarket's Data API -- the actual event-level ledger needed to
compute REAL realized PnL (including early-exit losses AND losses/gains
realized via split/merge), not the survivorship-biased summary from
/closed-positions.

WHY THIS EXISTS: /closed-positions only reflects positions closed via
market resolution/redemption. A trader who sells a losing position
early (cutting the loss before the market resolves) never appears
there at all -- that loss genuinely happened, but the endpoint has no
concept of it. Verified via a real wallet: 33/33 winning positions
and $1.09M summed from /closed-positions, against Polymarket's own
site showing a real max around $349K for the same wallet. Rebuilding
PnL from trade-level BUY/SELL/REDEEM/SPLIT/MERGE events, with a real
cost-basis ledger (see realized_pnl.py), is the only way to capture
losses that were realized by selling or merging rather than by losing
at resolution.

PAGINATION: confirmed via Polymarket's own official docs -- offset
pagination on /activity is capped around 5000; requests past that are
rejected with a 400 (never silently clamped), and reading deeper
requires paging inside separate start/end timestamp windows, each
with its own offset budget. Verified this exact failure live
(2026-08-12): a flat offset-based fetch against all 25 real tracked
wallets returned 0 events for 20 of them -- every one hit a 400 at
offset=5500 and had ALL of its already-fetched pages silently
discarded, not just the failed page. Fixed here by walking backward
through time in bounded windows, each independently offset-paginated,
with automatic window-halving if a single window still overflows the
cap (verified some wallets have very dense multi-thousand-event
windows even at a 60-day granularity).

WINDOW (this is separate from the pagination fix above -- see
realized_pnl.py): unlike the closed-positions fetcher, this pulls
FULL history, not just the last 90 days, since correct realized PnL
for a sale inside the 90-day window requires knowing the true cost
basis from that position's original purchase, which may be older.
The 90-day filter gets applied later, to the realized events the
ledger produces, not to the raw trade fetch itself.

SPLIT/MERGE ADDED (2026-08-16): confirmed live against a real wallet
that SPLIT/MERGE rows carry asset="" and outcomeIndex=999 (Polymarket's
sentinel for "applies to the whole market, not one outcome token") --
unlike TRADE/REDEEM rows, which always have a real asset id. Also
confirmed a single transactionHash can cover MULTIPLE conditionIds in
one MERGE transaction (a wallet merged 12 different markets in one tx)
-- transaction_hash alone is NOT a safe unique key for these rows the
way it is for TRADE/REDEEM; realized_pnl.py disambiguates by appending
condition_id. CHECK your trader_realized_pnl_events table's actual
unique constraint before this runs against production -- if it's a
plain unique index on transaction_hash alone, MERGE rows sharing a real
(non-synthetic) tx hash across markets will collide on insert.

NOTE: including SPLIT/MERGE in the fetch means wallets that do a lot of
split/merge arbitrage will hit ACTIVITY_EVENT_CAP (bot detection) more
easily than before, since it now counts SPLIT/MERGE rows too, not just
TRADE/REDEEM. This is arguably correct (heavy split/merge activity is
itself a bot signal) but is a behavior change worth knowing about --
a wallet previously under the cap on TRADE/REDEEM alone may now trip it.

Schema confirmed against Polymarket's public Data API docs
(GET /activity) -- verified 2026-08-12. SPLIT/MERGE shape confirmed
live 2026-08-16.
"""
import time
import requests
from datetime import datetime, timezone

ACTIVITY_URL = "https://data-api.polymarket.com/activity"
PAGE_LIMIT = 500  # API max, confirmed in docs
OFFSET_CAP = 5000  # confirmed via Polymarket's own docs
ACTIVITY_EVENT_CAP = 3000  # a wallet with more than this many raw
# TRADE/REDEEM/SPLIT/MERGE events across the lookback window isn't a
# human placing predictions -- almost certainly a market-making/
# arbitrage bot. This is DIFFERENT from the closed-positions bot cap
# (which counts RESOLVED POSITIONS in a 90-day window) -- a bot can
# have very few resolved positions while still generating thousands of
# raw trade events (e.g. repeatedly buying/selling the same market, or
# many small partial fills), so the closed-positions cap alone doesn't
# catch this pattern. Confirmed live 2026-08-13: wallet
# 0xa9c4b118...c5e7433 had only 254 closed positions (well under that
# cap) but 8451+ activity events.
RATE_LIMIT_MAX_RETRIES = 5
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"),
}


class RateLimitExhausted(Exception):
    """Raised when a single window fetch keeps hitting 429/408 even
    after RATE_LIMIT_MAX_RETRIES backed-off retries. Callers should
    treat this as "stop fetching further back for this wallet, keep
    what's already collected" rather than losing the whole wallet."""
    pass


def _request_with_backoff(params: dict):
    """
    GET a single page, retrying on 429 (rate limit) or 408 (timeout)
    with exponential backoff. Confirmed live 2026-08-13: a run against
    73 wallets hit 429s on 5+ consecutive wallets plus a 408, and those
    wallets got ZERO activity data for the run (silent data loss, not
    just slowness) because nothing retried a real error status --
    the old code only retried on an EMPTY response body, which is a
    different situation from a rejected request.
    """
    delay = 2.0
    for attempt in range(1, RATE_LIMIT_MAX_RETRIES + 1):
        resp = requests.get(ACTIVITY_URL, params=params, headers=HEADERS, timeout=30)
        if resp.status_code in (429, 408):
            if attempt == RATE_LIMIT_MAX_RETRIES:
                raise RateLimitExhausted(
                    f"Gave up after {RATE_LIMIT_MAX_RETRIES} retries on "
                    f"status {resp.status_code}"
                )
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else delay
            print(f"    Got {resp.status_code} (attempt {attempt}/"
                  f"{RATE_LIMIT_MAX_RETRIES}) -- backing off {wait:.1f}s...")
            time.sleep(wait)
            delay *= 2
            continue
        return resp
    return resp  # unreachable, but keeps type checkers happy


def _fetch_window(wallet: str, start_ts: int, end_ts: int):
    """
    Offset-paginate within a single start/end timestamp window.
    Returns (events, hit_cap) -- hit_cap=True means this window alone
    has more events than the offset budget allows, and the caller
    should split it into smaller windows and retry rather than trust
    this as the complete set for that range.
    """
    events = []
    offset = 0
    while True:
        if offset >= OFFSET_CAP:
            return events, True
        params = {
            "user": wallet,
            "type": "TRADE,REDEEM,SPLIT,MERGE",
            "limit": PAGE_LIMIT,
            "offset": offset,
            "start": start_ts,
            "end": end_ts,
            "sortBy": "TIMESTAMP",
            "sortDirection": "ASC",
        }

        batch = None
        for attempt in range(1, 4):
            resp = _request_with_backoff(params)
            if resp.status_code == 400:
                # Confirmed expected behavior at the offset cap, not a
                # real error -- treat like reaching the cap above.
                return events, True
            resp.raise_for_status()
            batch = resp.json()
            if batch:
                break
            if attempt < 3:
                time.sleep(1.5 * attempt)

        if not batch:
            break
        events.extend(batch)
        offset += PAGE_LIMIT
        if len(batch) < PAGE_LIMIT:
            break
        time.sleep(0.2)
    return events, False


def fetch_activity_for_wallet(wallet: str, earliest_ts: int = 0):
    """
    Fetch a wallet's full TRADE/REDEEM/SPLIT/MERGE history by walking
    backward through time in windows, each independently offset-
    paginated. Starts with a 60-day window; any window that still hits
    the offset cap gets halved and retried, so even a wallet with an
    extremely dense trading history in a short span still gets fully
    captured rather than silently truncated.

    Returns (events, hit_bot_cap) -- hit_bot_cap=True means the
    cumulative event count crossed ACTIVITY_EVENT_CAP and the walk was
    stopped early (likely bot), same convention as the closed-positions
    fetcher's bot-cap signal.

    If a window keeps hitting 429/408 even after backoff retries
    (RateLimitExhausted), that's treated as "stop walking further back
    for this wallet" -- NOT as a fatal error that discards everything
    already fetched. Previously an uncaught error here would propagate
    up through run()'s try/except and wipe the wallet's entire result
    to [], even if most of its history had already been collected.
    """
    all_events = []
    end_ts = int(datetime.now(timezone.utc).timestamp())
    initial_window = 60 * 24 * 60 * 60  # 60 days, in seconds
    min_window = 6 * 60 * 60  # don't shrink below 6 hours -- if even
                                # that overflows, something's wrong;
                                # stop rather than loop forever
    hit_bot_cap = False

    while end_ts > earliest_ts:
        window_seconds = initial_window
        start_ts = max(earliest_ts, end_ts - window_seconds)

        try:
            while True:
                events, hit_offset_cap = _fetch_window(wallet, start_ts, end_ts)
                if not hit_offset_cap:
                    all_events.extend(events)
                    break
                if window_seconds <= min_window:
                    print(f"    Window for {wallet} still overflowing at minimum "
                          f"size ({min_window}s) -- keeping what was fetched, "
                          f"some events in this narrow range may be missing.")
                    all_events.extend(events)
                    break
                window_seconds = window_seconds // 2
                start_ts = max(earliest_ts, end_ts - window_seconds)
        except RateLimitExhausted as e:
            print(f"    {wallet}: rate limit exhausted mid-fetch ({e}) -- "
                  f"stopping here, keeping {len(all_events)} events already "
                  f"collected rather than discarding them.")
            break

        if len(all_events) > ACTIVITY_EVENT_CAP:
            hit_bot_cap = True
            print(f"    {wallet} exceeded {ACTIVITY_EVENT_CAP} trade/redeem/"
                  f"split/merge events (likely bot) -- stopping early at "
                  f"{len(all_events)}.")
            break

        end_ts = start_ts
        time.sleep(0.2)

    return all_events, hit_bot_cap


def normalize_activity_event(wallet: str, e: dict) -> dict:
    """
    Normalize one activity event into the shape realized_pnl.py's
    ledger expects. event_type distinguishes TRADE_BUY / TRADE_SELL /
    REDEEM / SPLIT / MERGE up front so the ledger doesn't need to
    re-inspect raw Polymarket fields.

    SPLIT/MERGE rows come back from Polymarket with asset="" (empty
    string, not null) and outcomeIndex=999 -- confirmed live 2026-08-16
    -- since those events apply to the whole market (both outcome
    tokens equally), not one specific token. Normalized to None here so
    downstream code can use a single "falsy means unknown" check
    instead of handling "" as a special case.
    """
    raw_type = e.get("type")
    side = e.get("side")
    if raw_type == "REDEEM":
        event_type = "REDEEM"
    elif raw_type == "TRADE" and side == "BUY":
        event_type = "TRADE_BUY"
    elif raw_type == "TRADE" and side == "SELL":
        event_type = "TRADE_SELL"
    elif raw_type == "SPLIT":
        event_type = "SPLIT"
    elif raw_type == "MERGE":
        event_type = "MERGE"
    else:
        event_type = None

    outcome_index = e.get("outcomeIndex")
    if outcome_index == 999:  # Polymarket's sentinel for SPLIT/MERGE
        outcome_index = None

    return {
        "wallet": wallet,
        "asset": e.get("asset") or None,  # "" -> None for SPLIT/MERGE
        "condition_id": e.get("conditionId"),
        "outcome": e.get("outcome") or None,
        "outcome_index": outcome_index,
        "event_type": event_type,
        "price": e.get("price"),
        "size": e.get("size"),
        "usdc_size": e.get("usdcSize"),  # meaningful for SPLIT/MERGE;
                                          # not previously extracted
        "timestamp": e.get("timestamp"),
        "title": e.get("title"),
        "transaction_hash": e.get("transactionHash"),
    }


LOOKBACK_DAYS = 2 * 365  # cap how far back cost-basis history is fetched.
# Scoring only ever looks at positions resolved in the last 90 days,
# but computing THAT correctly requires each position's original buy
# trade, which can predate the 90-day window by a lot (a position held
# 150 days that resolves 3 days ago still needs its 150-day-old buy).
# 2 years is a generous margin above any realistic hold time while
# avoiding an unbounded fetch back to Polymarket's 2020 launch.


def run(wallets: list[str], watermarks: dict[str, int] | None = None):
    """
    Fetch + normalize activity for a list of wallets. Returns
    (result, bot_wallets, new_watermarks).

    watermarks: optional dict of wallet -> last successfully-fetched
    Unix timestamp (loaded from Supabase's wallet_fetch_state table by
    the caller). A wallet present here only fetches NEW activity since
    that timestamp, instead of re-walking up to LOOKBACK_DAYS of full
    history from scratch every single run -- this is what makes the
    daily scheduled run cheap after the first time a wallet is seen.
    A wallet absent from watermarks (never successfully fetched before)
    gets the full LOOKBACK_DAYS backfill, same as always.

    new_watermarks: wallet -> timestamp to persist for next run, for
    every wallet whose fetch didn't raise an exception -- even one that
    found zero new events, since that still confirms "nothing new
    happened for this wallet up through this point in time" and should
    still move the starting point forward next run. A wallet's
    watermark is deliberately NOT included here if its fetch raised an
    exception, so a failed run retries from the same starting point
    next time instead of silently skipping whatever it failed to get.
    """
    watermarks = watermarks or {}
    from datetime import timedelta
    default_earliest_ts = int((datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).timestamp())
    fetch_start_ts = int(datetime.now(timezone.utc).timestamp())

    result = {}
    bot_wallets = set()
    new_watermarks = {}
    for i, wallet in enumerate(wallets, 1):
        is_incremental = wallet in watermarks
        earliest_ts = watermarks.get(wallet, default_earliest_ts)
        try:
            raw, hit_bot_cap = fetch_activity_for_wallet(wallet, earliest_ts=earliest_ts)
            if hit_bot_cap:
                bot_wallets.add(wallet)
            normalized = [normalize_activity_event(wallet, e) for e in raw]
            usable = [e for e in normalized if e["event_type"] is not None]
            usable.sort(key=lambda e: e["timestamp"] or 0)
            result[wallet] = usable
            new_watermarks[wallet] = fetch_start_ts
            mode = "incremental" if is_incremental else "full backfill"
            print(f"  [{i}/{len(wallets)}] {wallet}: {len(usable)} trade/redeem/"
                  f"split/merge events ({mode})")
        except Exception as e:
            print(f"  [{i}/{len(wallets)}] {wallet}: FAILED -- {e}")
            result[wallet] = []
        time.sleep(0.3)
    return result, bot_wallets, new_watermarks


if __name__ == "__main__":
    test_wallet = "0x7ad71d79a3bb90d0a87a06500fa0fe11663842aa"
    events, bots, watermarks_out = run([test_wallet])
    rows = events[test_wallet]
    print(f"Fetched {len(rows)} events for {test_wallet}")
    for r in rows[:5]:
        print(r)
