"""
Fetch public market data from Kalshi's Trade API v2.
No API key required for read-only market data.
Docs: https://docs.kalshi.com/getting_started/quick_start_market_data
"""
import requests
import time
from datetime import datetime, timezone

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"  # works for all markets, not just elections
PAGE_LIMIT = 200


def fetch_all_markets(status="open"):
    """
    Fetch all markets with pagination. Returns a list of market dicts.

    Prints progress per page — without this, a large result set (Kalshi
    has many thousands of open markets once you count every sports prop)
    looks identical to a stuck/hung request. max_pages is a hard safety
    cap so a pagination bug (a cursor that never actually advances)
    can't loop forever silently. Also detects a repeating cursor
    directly — that's the clearest signal of a real pagination bug,
    as opposed to a dataset that's just genuinely large.
    """
    markets = []
    cursor = None
    page_num = 0
    max_pages = 2000  # raised ceiling — Kalshi's sports-prop expansion
                       # means a legitimately large open-market count
                       # is plausible; this is now a true safety net,
                       # not an expected stopping point
    seen_cursors = set()
    while True:
        page_num += 1
        if page_num > max_pages:
            print(f"  Hit safety cap of {max_pages} pages — stopping. "
                  f"At this size, something is likely still wrong.")
            break
        params = {"limit": PAGE_LIMIT, "status": status, "mve_filter": "exclude"}
        if cursor:
            params["cursor"] = cursor
        resp = requests.get(f"{BASE_URL}/markets", params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("markets", [])
        markets.extend(batch)
        print(f"  page {page_num}: +{len(batch)} markets (running total: {len(markets)})")

        new_cursor = data.get("cursor")
        if new_cursor and new_cursor in seen_cursors:
            print(f"  BUG DETECTED: cursor '{new_cursor[:20]}...' was already seen — "
                  f"pagination is not advancing. Stopping here; the data collected "
                  f"so far is likely incomplete/duplicated and shouldn't be trusted.")
            break
        if new_cursor:
            seen_cursors.add(new_cursor)
        cursor = new_cursor
        if not cursor:
            break
        time.sleep(0.2)  # be polite, stay under rate limits
    return markets


def normalize_market(m: dict) -> dict:
    """
    Normalize a Kalshi market into our common schema.

    Verified against a live response on 2026-08-10 — the actual field
    names differ from what most third-party docs/snippets show. Kalshi
    returns prices as decimal-dollar strings (e.g. "0.1570"), not plain
    integer cents, and volume/open interest come back as "_fp" fields.
    """
    def to_cents(dollar_str):
        try:
            return round(float(dollar_str) * 100, 2) if dollar_str not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def to_float(val):
        try:
            return float(val) if val not in (None, "") else None
        except (TypeError, ValueError):
            return None

    return {
        "source": "kalshi",
        "external_id": m.get("ticker"),
        "title": m.get("title"),
        "category": m.get("category"),  # not present on every market; multivariate markets often omit it
        "yes_price_cents": to_cents(m.get("yes_bid_dollars")),
        "no_price_cents": to_cents(m.get("no_bid_dollars")),
        "volume": to_float(m.get("volume_fp")),
        "open_interest": to_float(m.get("open_interest_fp")),
        "status": m.get("status"),
        "close_time": m.get("close_time"),
        "result": m.get("result") or None,  # empty string until resolved
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def run(min_volume=1):
    """
    min_volume filters out markets with no real trading activity.
    Kalshi lists tens of thousands of individual player-prop markets;
    the vast majority have zero or near-zero volume and are dead
    weight for an accuracy/analytics product. Filtering these out
    dramatically cuts row count and keeps storage sane on Supabase's
    free tier — without this, a single day's worth of pipeline runs
    (every 4 hours) can approach the 500MB free-tier ceiling.
    """
    raw = fetch_all_markets(status="open")
    normalized = [normalize_market(m) for m in raw]
    filtered = [r for r in normalized if (r["volume"] or 0) >= min_volume]
    print(f"  Kept {len(filtered)} of {len(normalized)} markets after "
          f"filtering out volume < {min_volume}")
    return filtered


if __name__ == "__main__":
    rows = run()
    print(f"Fetched {len(rows)} open Kalshi markets")
    for r in rows[:3]:
        print(r)