"""
Fetch Polymarket's public trader leaderboard.
No API key required — wallet activity is public by design (on-chain).
Verified against a live response on 2026-08-10.

Note: this is Polymarket-only. Kalshi accounts are not public, so
there's no equivalent trader-level data available from Kalshi's API —
a cross-platform trader leaderboard isn't possible, only a
Polymarket-only one.
"""
import requests
from datetime import datetime, timezone

LEADERBOARD_URL = "https://data-api.polymarket.com/v1/leaderboard"


def fetch_leaderboard():
    """Fetch the current top-trader leaderboard. Returns a list of dicts."""
    resp = requests.get(LEADERBOARD_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()


def normalize_entry(e: dict) -> dict:
    """Normalize a leaderboard entry into our schema."""
    return {
        "rank": int(e["rank"]) if e.get("rank") is not None else None,
        "wallet": e.get("proxyWallet"),
        "username": e.get("userName") or None,
        "volume": e.get("vol"),
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
