"""
Fetch a wallet's positions from Polymarket's Data API — this is the
"wallet vs. resolved market" join that gives the trader leaderboard
actual teeth.

Key insight: Polymarket already computes realizedPnl per position for
you. You don't need to manually reconstruct "did this wallet win or
lose on this market" by cross-referencing trades against resolved
markets yourself — realizedPnl / percentRealizedPnl already answer
that, authoritatively, straight from Polymarket's own settlement data.

Schema confirmed against Polymarket's official OpenAPI spec
(docs.polymarket.com) and a Polymarket-published example response
(2026-08-10). NOTE: unlike the other two fetchers in this pipeline, I
could not get a live 200 response from this specific endpoint through
my sandbox (it returned 400s — likely anti-bot protection on this
route, since /leaderboard and /markets both worked fine). Test this
one locally before trusting it in production.
"""
import time
import requests
from datetime import datetime, timezone

POSITIONS_URL = "https://data-api.polymarket.com/positions"
PAGE_LIMIT = 500  # API max


def fetch_positions_for_wallet(wallet: str):
    """
    Fetch all positions (any size, including fully closed ones) for a
    single wallet, paginating as needed. sizeThreshold=0 is important —
    the API defaults to only showing positions with size >= 1, which
    would silently drop small or fully-redeemed positions.
    """
    positions = []
    offset = 0
    while True:
        params = {
            "user": wallet,
            "sizeThreshold": 0,
            "limit": PAGE_LIMIT,
            "offset": offset,
            "sortBy": "CASHPNL",
            "sortDirection": "DESC",
        }
        resp = requests.get(POSITIONS_URL, params=params, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        positions.extend(batch)
        offset += PAGE_LIMIT
        if len(batch) < PAGE_LIMIT:
            break
        time.sleep(0.2)
    return positions


def normalize_position(wallet: str, p: dict) -> dict:
    return {
        "wallet": wallet,
        "condition_id": p.get("conditionId"),
        "market_title": p.get("title"),
        "outcome": p.get("outcome"),
        "size": p.get("size"),
        "avg_price": p.get("avgPrice"),
        "cur_price": p.get("curPrice"),
        "cash_pnl": p.get("cashPnl"),
        "realized_pnl": p.get("realizedPnl"),
        "percent_realized_pnl": p.get("percentRealizedPnl"),
        "redeemable": p.get("redeemable"),
        "end_date": p.get("endDate"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def run(wallets: list[str]):
    """
    Fetch positions for a list of wallets (e.g. everyone currently on
    the leaderboard). Returns a flat list of normalized position rows
    across all wallets.
    """
    all_rows = []
    for wallet in wallets:
        try:
            raw = fetch_positions_for_wallet(wallet)
            all_rows.extend(normalize_position(wallet, p) for p in raw)
        except Exception as e:
            print(f"  Positions fetch failed for {wallet}: {e}")
        time.sleep(0.3)  # spread requests out across wallets
    return all_rows


if __name__ == "__main__":
    # Quick manual test against a single known wallet
    test_wallet = "0x6af75d4e4aaf700450efbac3708cce1665810ff1"
    rows = run([test_wallet])
    print(f"Fetched {len(rows)} positions for {test_wallet}")
    for r in rows[:3]:
        print(r)
