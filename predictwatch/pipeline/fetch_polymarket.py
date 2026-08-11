"""
Fetch public market data from Polymarket's Gamma API.
No API key required for read-only market discovery/pricing.
Docs: https://docs.polymarket.com/api-reference/introduction
"""
import requests
import time
from datetime import datetime, timezone

GAMMA_URL = "https://gamma-api.polymarket.com"
PAGE_LIMIT = 200


def fetch_all_markets(active=True):
    """Fetch all active markets with pagination. Returns a list of market dicts."""
    markets = []
    offset = 0
    while True:
        params = {"limit": PAGE_LIMIT, "offset": offset, "active": str(active).lower()}
        resp = requests.get(f"{GAMMA_URL}/markets", params=params, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        markets.extend(batch)
        offset += PAGE_LIMIT
        if len(batch) < PAGE_LIMIT:
            break
        time.sleep(0.2)  # be polite, stay under rate limits
    return markets


def normalize_market(m: dict) -> dict:
    """Normalize a Polymarket market into our common schema."""
    # outcomePrices is usually a JSON-encoded string like '["0.62", "0.38"]'
    yes_price = None
    try:
        import json
        prices = json.loads(m.get("outcomePrices", "[]"))
        if prices:
            yes_price = round(float(prices[0]) * 100, 2)  # convert to cents-equivalent
    except Exception:
        pass

    def to_float(val):
        try:
            return float(val) if val not in (None, "") else None
        except (TypeError, ValueError):
            return None

    return {
        "source": "polymarket",
        "external_id": m.get("id"),
        "title": m.get("question"),
        # No top-level "category" field on /markets — confirmed against a live
        # response 2026-08-10. Leaving None for now; category-level analysis
        # would need to pull it from the parent event's tags instead.
        "category": None,
        "yes_price_cents": yes_price,
        "no_price_cents": (100 - yes_price) if yes_price is not None else None,
        "volume": to_float(m.get("volume")),  # comes back as a numeric string
        "open_interest": to_float(m.get("liquidity")),  # also a numeric string
        "status": "open" if m.get("active") else "closed",
        "close_time": m.get("endDate"),
        "result": m.get("outcomePrices") if m.get("closed") else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def run():
    raw = fetch_all_markets(active=True)
    return [normalize_market(m) for m in raw]


if __name__ == "__main__":
    rows = run()
    print(f"Fetched {len(rows)} active Polymarket markets")
    for r in rows[:3]:
        print(r)
