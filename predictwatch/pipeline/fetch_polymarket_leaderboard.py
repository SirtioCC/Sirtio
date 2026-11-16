"""
Fetch Polymarket's public trader leaderboard.
No API key required — wallet activity is public by design (on-chain).
Verified against a live response on 2026-08-10.

Uses timePeriod=MONTH so the discovered wallet set roughly matches
the 30-day window PM Score is computed over -- the endpoint defaults
to DAY ("Today") if timePeriod isn't set, which would discover
wallets based on a single lucky day rather than a track record.

The endpoint caps `limit` at 50 per call, so pulling 100 traders
takes two paginated calls (offset 0, then offset 50).

Note: this is Polymarket-only. Kalshi accounts are not public, so
there's no equivalent trader-level data available from Kalshi's API —
a cross-platform trader leaderboard isn't possible, only a
Polymarket-only one.
"""
import requests
from datetime import datetime, timezone

# Migrated 2026-11-15: /v1/leaderboard now returns 410 Gone. v2 uses
# snake_case fields, a { data, pagination } envelope, and limit up to 1000
# (no 50-row page cap, so one call covers TARGET_COUNT).
LEADERBOARD_URL = "https://data-api.polymarket.com/v2/leaderboard"
TIME_PERIOD = "month"
TARGET_COUNT = 100


def fetch_leaderboard():
    """Fetch the current top-trader leaderboard (MONTH window, top 100).

    Returns a list of dicts, deduplicated by wallet in case of overlap
    between pages.
    """
    params = {
        "time_period": TIME_PERIOD,
        "sort_by": "PNL",
        "limit": TARGET_COUNT,
    }
    resp = requests.get(LEADERBOARD_URL, params=params, timeout=30)
    resp.raise_for_status()
    page = resp.json().get("data") or []

    all_rows = []
    seen_wallets = set()
    for entry in page:
        wallet = entry.get("user_id")
        if wallet and wallet in seen_wallets:
            continue
        if wallet:
            seen_wallets.add(wallet)
        all_rows.append(entry)
    return all_rows


def normalize_entry(e: dict) -> dict:
    """Normalize a leaderboard entry into our schema."""
    return {
        "rank": int(e["rank"]) if e.get("rank") is not None else None,
        "wallet": e.get("user_id"),
        "username": e.get("user_name") or None,
        "volume": e.get("volume"),
        "pnl": e.get("pnl"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def run():
    raw = fetch_leaderboard()
    return [normalize_entry(e) for e in raw]


if __name__ == "__main__":
    rows = run()
    print(f"Fetched {len(rows)} leaderboard entries")
    for r in rows[:3]:
        print(r)
