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
    """Fetch all markets with pagination. Returns a list of market dicts."""
    markets = []
    cursor = None
    while True:
        params = {"limit": PAGE_LIMIT, "status": status}
        if cursor:
            params["cursor"] = cursor
        resp = requests.get(f"{BASE_URL}/markets", params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        markets.extend(data.get("markets", []))
        cursor = data.get("cursor")
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


def run():
    raw = fetch_all_markets(status="open")
    return [normalize_market(m) for m in raw]


if __name__ == "__main__":
    rows = run()
    print(f"Fetched {len(rows)} open Kalshi markets")
    for r in rows[:3]:
        print(r)
