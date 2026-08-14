"""
Builds a real average-cost-basis ledger per (wallet, asset) from
chronological TRADE_BUY / TRADE_SELL / REDEEM events, producing
genuinely complete realized PnL -- including losses from positions
sold early, which Polymarket's /closed-positions endpoint silently
omits (see fetch_polymarket_activity.py for the full reasoning).

METHOD: average cost basis, not FIFO -- matches how Polymarket's own
/positions endpoint computes cashPnl/realizedPnl (avgPrice field),
so this stays consistent with numbers Polymarket itself surfaces
elsewhere.

THE SECOND GAP THIS CLOSES: a trader who buys a losing position and
never sells it (because a losing token is worth $0 -- there's nothing
to gain by explicitly closing it) generates NO event at all. No SELL,
no REDEEM. That loss would silently vanish from a trade-level ledger
too, reproducing the exact same survivorship bias one layer deeper.
Fixed here by force-closing any remaining open balance in a market
that's actually resolved, at the market's real settlement value ($1
for the winning outcome index, $0 for every other outcome) -- looked
up live via Polymarket's Gamma API by conditionId, not from our own
market_snapshots table (which only reliably captures markets resolved
within its own ~2-day trailing fetch window, and would be incomplete
for anything older).
"""
import time
import requests
import json
from datetime import datetime, timezone

GAMMA_MARKETS_URL = "https://gamma-api.polymarket.com/markets"
CONDITION_ID_BATCH_SIZE = 20  # keep query strings reasonable


def fetch_resolution_by_condition_ids(condition_ids: list[str]) -> dict:
    """
    Look up current resolution status for a list of conditionIds
    directly from Polymarket's Gamma API. Returns a dict:
      condition_id -> {"resolved": bool, "outcome_prices": [float, ...]}
    Only called for positions actually left open after the trade
    ledger runs (i.e. never sold or redeemed) -- typically a small
    fraction of a wallet's total activity, so this stays cheap even
    though it's a live lookup rather than a cached table.
    """
    unique_ids = list({c for c in condition_ids if c})
    result = {}
    for i in range(0, len(unique_ids), CONDITION_ID_BATCH_SIZE):
        batch = unique_ids[i:i + CONDITION_ID_BATCH_SIZE]
        params = {"condition_ids": ",".join(batch), "limit": len(batch)}
        try:
            resp = requests.get(GAMMA_MARKETS_URL, params=params, timeout=30)
            resp.raise_for_status()
            markets = resp.json()
        except Exception as e:
            print(f"    Resolution lookup failed for a batch of {len(batch)} "
                  f"condition_ids: {e}")
            continue
        for m in markets:
            cid = m.get("conditionId")
            if not cid:
                continue
            resolved = bool(m.get("closed"))
            outcome_prices = None
            if resolved:
                try:
                    outcome_prices = [float(p) for p in json.loads(m.get("outcomePrices", "[]"))]
                except Exception:
                    outcome_prices = None
            result[cid] = {"resolved": resolved, "outcome_prices": outcome_prices}
        time.sleep(0.2)
    return result


def build_realized_pnl_events(wallet: str, events: list[dict]):
    """
    Walk one wallet's chronological TRADE_BUY / TRADE_SELL / REDEEM
    events and emit a realized-PnL row for every SELL and REDEEM.
    Returns (realized_rows, open_positions) -- open_positions is
    whatever's left on the ledger with a non-zero token balance after
    all events are processed (never sold, never redeemed). Those are
    candidates for force-closing against real market resolution --
    handled separately in force_close_abandoned_positions, so this
    function stays a pure trade-ledger walk with no network calls.
    """
    positions = {}  # asset -> running ledger state
    realized = []

    for e in events:
        asset = e["asset"]
        if not asset:
            continue
        pos = positions.setdefault(asset, {
            "tokens": 0.0,
            "cost": 0.0,
            "condition_id": e["condition_id"],
            "outcome": e["outcome"],
            "outcome_index": e["outcome_index"],
            "title": e["title"],
        })

        price = e.get("price")
        size = e.get("size")
        if size is None:
            continue
        if e["event_type"] in ("TRADE_BUY", "TRADE_SELL") and price is None:
            # BUY/SELL genuinely need a real price -- no sensible default.
            continue

        if e["event_type"] == "TRADE_BUY":
            pos["tokens"] += size
            pos["cost"] += price * size

        elif e["event_type"] in ("TRADE_SELL", "REDEEM"):
            if pos["tokens"] <= 1e-9:
                # Nothing on the ledger to sell/redeem against -- can
                # happen if a position was opened before this wallet's
                # earliest fetched activity page, or from a data quirk.
                # Skip rather than guess; under-counting a rare edge
                # case is safer than fabricating a cost basis.
                continue
            sell_size = min(size, pos["tokens"])
            avg_cost = pos["cost"] / pos["tokens"]
            # REDEEM events settle winning tokens at $1/token; if
            # Polymarket's own event includes a price, trust it, else
            # default to 1.0 (a REDEEM only ever happens for tokens
            # that resolved as the winning outcome -- losing tokens
            # have nothing to redeem).
            settle_price = price if (e["event_type"] == "TRADE_SELL" or price) else 1.0
            realized_pnl = (settle_price - avg_cost) * sell_size
            tx_hash = e.get("transaction_hash")
            if not tx_hash:
                # Defensive fallback -- real Polymarket trade/redeem
                # events should always carry a transactionHash, but if
                # one is ever missing, NULL would break the unique
                # constraint (NULLs don't collide with each other in a
                # Postgres unique index, silently defeating dedup).
                # Synthesize a stable key from the event itself instead.
                tx_hash = f"missing-txhash:{pos['condition_id']}:{asset}:{e.get('timestamp')}"
            realized.append({
                "wallet": wallet,
                "condition_id": pos["condition_id"],
                "asset": asset,
                "market_title": pos["title"],
                "outcome": pos["outcome"],
                "event_type": e["event_type"],
                "price": settle_price,
                "size": sell_size,
                "avg_cost": round(avg_cost, 6),
                "realized_pnl": round(realized_pnl, 4),
                "closed_at": datetime.fromtimestamp(int(e["timestamp"]), tz=timezone.utc).isoformat()
                             if e.get("timestamp") else None,
                "transaction_hash": tx_hash,
            })
            pos["cost"] -= avg_cost * sell_size
            pos["tokens"] -= sell_size

    open_positions = {a: p for a, p in positions.items() if p["tokens"] > 1e-9}
    return realized, open_positions


def force_close_abandoned_positions(wallet: str, open_positions: dict):
    """
    Given the leftover open positions from build_realized_pnl_events
    (never sold, never redeemed), look up real resolution status ONLY
    for those markets and force-realize any that have actually
    settled -- at the true settlement value ($1 for the winning
    outcome index, $0 for every other outcome), not assumed.
    """
    if not open_positions:
        return []
    condition_ids = list({p["condition_id"] for p in open_positions.values() if p["condition_id"]})
    resolution_lookup = fetch_resolution_by_condition_ids(condition_ids)

    now_iso = datetime.now(timezone.utc).isoformat()
    realized = []
    for asset, pos in open_positions.items():
        res = resolution_lookup.get(pos["condition_id"])
        if not res or not res["resolved"] or not res["outcome_prices"]:
            continue  # still open, or resolution unknown -- leave alone
        idx = pos["outcome_index"]
        if idx is None or idx >= len(res["outcome_prices"]):
            continue
        settle_price = res["outcome_prices"][idx]
        avg_cost = pos["cost"] / pos["tokens"]
        realized_pnl = (settle_price - avg_cost) * pos["tokens"]
        realized.append({
            "wallet": wallet,
            "condition_id": pos["condition_id"],
            "asset": asset,
            "market_title": pos["title"],
            "outcome": pos["outcome"],
            "event_type": "FORCE_CLOSE_RESOLVED",
            "price": settle_price,
            "size": pos["tokens"],
            "avg_cost": round(avg_cost, 6),
            "realized_pnl": round(realized_pnl, 4),
            # No trade timestamp exists for an abandoned position --
            # using fetch time as closed_at is an approximation, not
            # the true resolution moment. Good enough to land it in
            # roughly the right window; flagged here so it's a known
            # simplification, not a hidden one.
            "closed_at": now_iso,
        })
    return realized


def run(wallet_events: dict, resolve_abandoned: bool = True):
    """
    wallet_events: dict from fetch_polymarket_activity.run() --
    wallet -> chronological event list.
    Returns a flat list of realized-PnL rows across all wallets.
    """
    all_rows = []
    for i, (wallet, events) in enumerate(wallet_events.items(), 1):
        if not events:
            continue
        realized, open_positions = build_realized_pnl_events(wallet, events)
        if resolve_abandoned and open_positions:
            realized.extend(force_close_abandoned_positions(wallet, open_positions))
        all_rows.extend(realized)
        print(f"  [{i}/{len(wallet_events)}] {wallet}: {len(realized)} realized PnL events "
              f"({len(open_positions)} abandoned positions checked)")
    return all_rows
