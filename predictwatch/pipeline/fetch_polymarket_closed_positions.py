"""
Fetch a wallet's CLOSED (settled/fully realized) positions from
Polymarket's Data API. This is a genuinely separate endpoint from
/positions (fetch_polymarket_positions.py) -- confirmed via Polymarket's
own OpenAPI spec and a third-party client library that treats them as
distinct concepts ("current positions" vs "closed positions").

Why this exists: /positions reflects current holdings, and appears to
drop positions once they're fully redeemed/closed out -- meaning a
trader's genuinely old, already-cashed-out wins can be invisible to us
even when pulling "all positions." This endpoint is Polymarket's own
dedicated historical record, keyed by a settlement `timestamp` rather
than current holding state.

STATUS: additive/reference only for now. Not yet wired into PM Score
or the site's queries -- this just gets the data flowing into storage
so it's available for a future methodology upgrade, without changing
today's live scoring while that's designed properly.

WINDOW: last 90 days only, matching the site's PM Score window. A
real wallet was found with 99,000+ closed positions -- fetching all
of it would be enormous and mostly wasted, since PM Score only uses
the last 90 days anyway. Fixed by stopping pagination as soon as a
position older than the window is seen, since results are sorted
newest-first by timestamp -- everything after that point is
guaranteed to be even older.

Schema confirmed against Polymarket's official OpenAPI spec
(docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user)
and a third-party Go client library, cross-checked for consistency.
NOTE: unlike /positions, this endpoint has NO cashPnl or
percentRealizedPnl field -- only realizedPnl (a dollar amount) and
totalBought (total dollars spent entering the position). Percent
return is approximated here as realizedPnl / totalBought * 100.
"""
import time
import requests
from datetime import datetime, timezone, timedelta

CLOSED_POSITIONS_URL = "https://data-api.polymarket.com/closed-positions"
PAGE_LIMIT = 50  # confirmed API max for this endpoint (much smaller than /positions' 500)
WINDOW_DAYS = 90
BOT_POSITION_CAP = 3000  # a wallet with more resolved positions than this in a
# 90-day window isn't a human placing predictions -- almost certainly a
# market-making/arbitrage script. Stop paginating for that wallet as soon
# as the running count crosses this line, rather than fetching its entire
# history first and judging afterward (real wallets seen with 25,000-
# 37,000+ closed positions, several hitting the 1000-page safety cap and
# still not finishing -- this was the dominant cost in pipeline runtime).
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"),
}


def fetch_closed_positions_for_wallet(wallet: str, window_days: int = WINDOW_DAYS):
    """
    Fetch closed positions for a single wallet, but only within the
    last `window_days` -- stops paginating early once a position older
    than the cutoff is seen, rather than walking the wallet's entire
    history. Relies on the API's default sort (TIMESTAMP DESC,
    confirmed in the request params below) -- newest first, so once
    we've seen one too-old item, everything after it is guaranteed
    older too.
    """
    cutoff_ts = int((datetime.now(timezone.utc) - timedelta(days=window_days)).timestamp())

    closed = []
    offset = 0
    page_num = 0
    max_pages = 1000  # hard safety net; window-based early-stop should trigger well before this
    hit_bot_cap = False
    while True:
        page_num += 1
        if page_num > max_pages:
            print(f"    Hit safety cap of {max_pages} pages for {wallet} - stopping.")
            break
        params = {
            "user": wallet,
            "limit": PAGE_LIMIT,
            "offset": offset,
            "sortBy": "TIMESTAMP",
            "sortDirection": "DESC",
        }

        batch = None
        for attempt in range(1, 4):
            resp = requests.get(CLOSED_POSITIONS_URL, params=params, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
            if batch:
                break
            if attempt < 3:
                time.sleep(1.5 * attempt)

        if not batch:
            break

        hit_cutoff = False
        for item in batch:
            ts = item.get("timestamp")
            if ts is not None and int(ts) < cutoff_ts:
                hit_cutoff = True
                break
            closed.append(item)

        if hit_cutoff:
            break

        if len(closed) > BOT_POSITION_CAP:
            hit_bot_cap = True
            print(f"    {wallet} exceeded {BOT_POSITION_CAP} resolved positions "
                  f"within the 90-day window (likely bot) - stopping early at "
                  f"{len(closed)}.")
            break

        offset += PAGE_LIMIT
        if len(batch) < PAGE_LIMIT:
            break
        time.sleep(0.2)
    return closed, hit_bot_cap


def normalize_closed_position(wallet: str, p: dict) -> dict:
    total_bought = p.get("totalBought")
    realized_pnl = p.get("realizedPnl")
    percent_return = None
    if total_bought and realized_pnl is not None and total_bought != 0:
        percent_return = round((realized_pnl / total_bought) * 100, 4)

    closed_at = None
    ts = p.get("timestamp")
    if ts:
        try:
            closed_at = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
        except (ValueError, TypeError):
            closed_at = None

    return {
        "wallet": wallet,
        "condition_id": p.get("conditionId"),
        "market_title": p.get("title"),
        "outcome": p.get("outcome"),
        "avg_price": p.get("avgPrice"),
        "cur_price": p.get("curPrice"),
        "total_bought": total_bought,
        "realized_pnl": realized_pnl,
        "percent_return_approx": percent_return,
        "closed_at": closed_at,
        "end_date": p.get("endDate"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def run(wallets: list[str]):
    """
    Fetch closed positions for a list of wallets, deduplicated by
    (wallet, condition_id) -- same reasoning as the open-positions
    fetcher: a single closed position should appear once per wallet.

    Returns (all_rows, bot_wallets) -- bot_wallets is the set of wallets
    that exceeded BOT_POSITION_CAP and had their pagination cut short,
    so callers (e.g. the activity/ledger step) can skip them too rather
    than re-deriving the same judgment from partial data afterward.
    """
    all_rows = []
    bot_wallets = set()
    for i, wallet in enumerate(wallets, 1):
        try:
            raw, hit_bot_cap = fetch_closed_positions_for_wallet(wallet)
            if hit_bot_cap:
                bot_wallets.add(wallet)
            normalized = [normalize_closed_position(wallet, p) for p in raw]
            deduped = list({(r["wallet"], r["condition_id"]): r for r in normalized}.values())
            if len(deduped) != len(normalized):
                print(f"    Deduped {len(normalized) - len(deduped)} repeated "
                      f"closed position(s) for {wallet}")
            all_rows.extend(deduped)
            print(f"  [{i}/{len(wallets)}] {wallet}: {len(deduped)} closed positions "
                  f"(running total: {len(all_rows)})")
        except Exception as e:
            print(f"  [{i}/{len(wallets)}] {wallet}: FAILED - {e}")
        time.sleep(0.3)
    return all_rows, bot_wallets


if __name__ == "__main__":
    test_wallet = "0x6af75d4e4aaf700450efbac3708cce1665810ff1"
    rows, bots = run([test_wallet])
    print(f"Fetched {len(rows)} closed positions for {test_wallet}")
    for r in rows[:3]:
        print(r)