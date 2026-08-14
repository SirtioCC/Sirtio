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


def fetch_all_markets(active=True, min_volume=1):
    """
    Fetch active markets with volume >= min_volume, sorted highest-volume
    first. Returns a list of market dicts.

    Filtering server-side (volume_min) instead of pulling every market
    and filtering after the fact avoids the deep-offset problem entirely:
    the legacy /markets endpoint 422s past a certain offset depth (~2000+
    confirmed by testing), and requesting only markets with real trading
    activity keeps the result set well under that ceiling in normal
    conditions. Sorting by volume descending also means that if the
    offset ceiling IS hit for some reason, what's already collected is
    the most important data, not an arbitrary slice.

    Prints progress per page for visibility, and has a safety cap so a
    pagination issue can't loop silently forever — the same blind spot
    that caused a real problem in the Kalshi fetcher (see fetch_kalshi.py).
    """
    markets = []
    offset = 0
    page_num = 0
    max_pages = 500  # generous ceiling; should never realistically be hit now
    while True:
        page_num += 1
        if page_num > max_pages:
            print(f"  Hit safety cap of {max_pages} pages — stopping. "
                  f"This is far beyond Polymarket's realistic active-market count.")
            break
        params = {
            "limit": PAGE_LIMIT,
            "offset": offset,
            "active": str(active).lower(),
            "order": "volume",
            "ascending": "false",
            "volume_min": min_volume,
        }
        resp = requests.get(f"{GAMMA_URL}/markets", params=params, timeout=30)
        if resp.status_code == 422:
            print(f"  Got 422 at offset {offset} — hit the API's deep-pagination "
                  f"ceiling. Stopping here; since results are volume-sorted, "
                  f"what's collected so far is the most relevant data anyway.")
            break
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        markets.extend(batch)
        print(f"  page {page_num}: +{len(batch)} markets (running total: {len(markets)})")
        offset += PAGE_LIMIT
        # NOTE: don't stop just because batch is smaller than PAGE_LIMIT —
        # confirmed Polymarket's legacy /markets endpoint appears to cap
        # results around 100 per request regardless of the requested
        # limit, so a full page can look identical to a final partial
        # page. Only an actually empty batch (checked above) means done.
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
        "slug": m.get("slug"),
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


def run(min_volume=1):
    """
    min_volume is now passed to the API directly (server-side filtering,
    see fetch_all_markets) rather than pulled-then-discarded client-side.
    The check below is a cheap backstop only, in case a market slips
    through with a null/missing volume field.
    """
    raw = fetch_all_markets(active=True, min_volume=min_volume)
    normalized = [normalize_market(m) for m in raw]
    filtered = [r for r in normalized if (r["volume"] or 0) >= min_volume]
    if len(filtered) != len(normalized):
        print(f"  Backstop filter dropped {len(normalized) - len(filtered)} "
              f"more markets with missing/invalid volume data")
    print(f"  Final count: {len(filtered)} markets")
    return filtered


if __name__ == "__main__":
    rows = run()
    print(f"Fetched {len(rows)} active Polymarket markets")
    for r in rows[:3]:
        print(r)
