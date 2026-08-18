"""
Builds a real average-cost-basis ledger per (wallet, asset) from
chronological TRADE_BUY / TRADE_SELL / REDEEM / SPLIT / MERGE events,
producing genuinely complete realized PnL -- including losses from
positions sold early, and PnL realized via split/merge, both of which
Polymarket's /closed-positions endpoint silently omits (see
fetch_polymarket_activity.py for the full reasoning).

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

THE THIRD GAP (SPLIT/MERGE, added 2026-08-16): a wallet can close a
position by merging YES+NO tokens back into $1 collateral instead of
selling or waiting for redemption. That never generates a TRADE_SELL
or REDEEM either -- it's invisible to the trade ledger above just like
the abandoned-position gap, but for the opposite reason (the position
WAS actively closed, just via a mechanism the ledger didn't recognize).

MERGE events carry NO asset id (Polymarket returns asset="" on these
rows -- confirmed live 2026-08-16) and NO outcome_index (returned as
sentinel 999, normalized to None by fetch_polymarket_activity.py) --
only a condition_id. So a MERGE is matched against this ledger by
condition_id, closing whichever asset-keyed position(s) for that
market are already tracked (there are normally up to two: one per
outcome, added via earlier TRADE_BUY or SPLIT events for the same
wallet+market).

SPLIT events have the same missing asset id, but SPLIT can also be the
very FIRST event this ledger ever sees for a given market (a wallet
that splits before ever buying or merging). In that case there's no
existing asset-keyed entry to add cost basis to, and no way to invent
one without knowing the real token ids -- so build_realized_pnl_events
accepts an optional outcome_token_ids lookup (condition_id -> [asset0,
asset1]), populated by a one-time Gamma API batch call BEFORE this
function runs (see fetch_outcome_token_ids), keeping this function
itself free of network calls, same as the existing force-close design
below.

TRANSACTION HASH / SCHEMA FIT (confirmed live against the real schema,
2026-08-16): trader_realized_pnl_events has `asset TEXT NOT NULL`, and
its real dedup key is a unique index on (wallet, asset,
transaction_hash) -- there's no unique CONSTRAINT registered (checked
via pg_constraint, which returned no rows), but a bare unique INDEX
still enforces this and is what run_pipeline.py's
ON CONFLICT (wallet, asset, transaction_hash) upsert relies on.

This ruled out an earlier version of this fix that emitted one
combined row per merge with asset=None when both YES/NO legs closed --
that would have violated the NOT NULL column outright, and even if it
hadn't, NULL never matches NULL in a unique index, so every pipeline
rerun would have inserted a fresh duplicate row instead of upserting
the same one, silently multiplying realized PnL run over run.

Fixed by emitting ONE ROW PER CLOSED LEG instead (see _apply_merge) --
same shape as the existing TRADE_SELL/REDEEM rows below, each keyed by
its own real asset id. Since real per-leg asset ids are globally
unique across markets, this also means transaction_hash does NOT need
disambiguating -- confirmed live that a single MERGE transaction can
close positions across multiple different markets at once (one wallet
merged 12 markets in one tx), but each leg's row still gets a distinct
(wallet, asset, transaction_hash) key on its own.
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


def fetch_outcome_token_ids(condition_ids: list[str]) -> dict:
    """
    Look up the real outcome token (asset) ids for a list of
    conditionIds via Polymarket's Gamma API. Returns a dict:
      condition_id -> [asset_id_outcome_0, asset_id_outcome_1]
    (order matches the market's outcomes array). Only called for
    condition_ids that appear in a SPLIT event where this wallet's
    ledger doesn't already have BOTH outcome sides tracked under a
    real asset id from an earlier TRADE_BUY -- typically rare, so
    this stays cheap despite being a live lookup.
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
            print(f"    Token id lookup failed for a batch of {len(batch)} "
                  f"condition_ids: {e}")
            continue
        for m in markets:
            cid = m.get("conditionId")
            if not cid:
                continue
            try:
                token_ids = json.loads(m.get("clobTokenIds", "[]"))
            except Exception:
                token_ids = None
            if token_ids and len(token_ids) == 2:
                result[cid] = token_ids
        time.sleep(0.2)
    return result


def _apply_split(positions: dict, e: dict, outcome_token_ids: dict | None) -> None:
    """
    SPLIT: opens a position on BOTH outcome sides of a condition_id.
    Cost splits evenly across both sides since a split always creates
    one token of each outcome per dollar of usdc_size.

    If this wallet's ledger already has one or both sides tracked
    (from an earlier TRADE_BUY or SPLIT under the real asset id),
    those existing entries are added to directly. Any side NOT yet
    tracked needs a real asset id to key a new entry under --
    resolved via the pre-fetched outcome_token_ids lookup. If that
    lookup has nothing for this condition_id (Gamma call failed, or
    wasn't needed to be attempted), the untracked side is skipped
    rather than fabricating a key -- under-counting one market's split
    cost basis is safer than inventing a wrong asset id that could
    later collide with a real one.
    """
    cid = e["condition_id"]
    tokens = e["size"]
    total_cost = e.get("usdc_size")
    if total_cost is None:
        total_cost = tokens  # fallback: confirmed live that
        # usdc_size == size for SPLIT/MERGE (0 mismatches out of 2590
        # events tested), so size is a safe fallback if usdc_size is
        # ever missing.
    cost_per_side = total_cost / 2

    matched_assets = [a for a, p in positions.items() if p["condition_id"] == cid]

    if len(matched_assets) >= 2:
        for a in matched_assets[:2]:
            positions[a]["tokens"] += tokens
            positions[a]["cost"] += cost_per_side
        return

    token_ids = (outcome_token_ids or {}).get(cid)
    if not token_ids:
        # No existing tracked sides AND no token id lookup available --
        # nothing safe to do. This split's cost basis is lost for this
        # market only; it does not affect any other market's ledger.
        for a in matched_assets:
            positions[a]["tokens"] += tokens
            positions[a]["cost"] += cost_per_side
        return

    for idx, a in enumerate(token_ids):
        if a in matched_assets:
            positions[a]["tokens"] += tokens
            positions[a]["cost"] += cost_per_side
        else:
            positions[a] = {
                "tokens": tokens,
                "cost": cost_per_side,
                "condition_id": cid,
                "outcome": None,
                "outcome_index": idx,
                "title": e.get("title"),
            }


def _apply_merge(wallet: str, positions: dict, e: dict) -> list[dict]:
    """
    MERGE: closes a position on whichever outcome side(s) of a
    condition_id are currently tracked in this wallet's ledger.
    Realizes PnL deterministically at $1.00 per complete set (total
    proceeds = usdc_size) -- no price lookup needed, since merge always
    pays out exactly $1 regardless of market price.

    Emits ONE ROW PER CLOSED LEG (same pattern as TRADE_SELL/REDEEM
    below), not one combined row per merge event -- required by the
    real trader_realized_pnl_events schema: `asset` is NOT NULL, and
    the table's real dedup key is a unique index on
    (wallet, asset, transaction_hash) (confirmed live 2026-08-16 --
    there's no unique CONSTRAINT registered in pg_constraint, but a
    bare unique INDEX still enforces this and drives the pipeline's
    ON CONFLICT upsert). A single combined row with asset=None would
    violate the NOT NULL column outright, and even if it didn't, NULL
    never matches NULL in a unique index -- every rerun would insert a
    fresh duplicate instead of upserting the same row.

    Total proceeds split EVENLY across however many legs are matched
    (normally 2 -- YES and NO -- occasionally 1 if only one side was
    ever tracked). This mirrors _apply_split's even cost-basis split
    on open, so a pure split->merge round trip still nets exactly
    $0.00 per leg, same as it does combined (verified live and in
    synthetic tests). Real per-leg asset ids are globally unique across
    markets, so (wallet, asset, transaction_hash) disambiguates
    correctly on its own even when one transaction merges several
    different markets at once (confirmed live) -- no synthetic key
    suffix needed.

    Returns a list of realized-PnL rows (possibly empty, if there's no
    matching tracked position to close against -- e.g. the wallet split
    before this wallet's earliest fetched activity page, or a Gamma
    lookup for an earlier split failed. Skip rather than fabricate a
    cost basis).
    """
    cid = e["condition_id"]
    tokens = e["size"]
    proceeds_total = e.get("usdc_size")
    if proceeds_total is None:
        proceeds_total = tokens  # see _apply_split's comment on this fallback

    matched = [(a, p) for a, p in positions.items()
               if p["condition_id"] == cid and p["tokens"] > 1e-9]
    if not matched:
        return []

    proceeds_per_leg = proceeds_total / len(matched)
    tx_hash = e.get("transaction_hash") or f"missing-txhash:{cid}:MERGE:{e.get('timestamp')}"
    closed_at = (datetime.fromtimestamp(int(e["timestamp"]), tz=timezone.utc).isoformat()
                 if e.get("timestamp") else None)

    rows = []
    for a, p in matched:
        close_tokens = min(tokens, p["tokens"])
        avg_cost = p["cost"] / p["tokens"] if p["tokens"] > 0 else 0.0
        cost_basis_closed = avg_cost * close_tokens
        p["cost"] -= cost_basis_closed
        p["tokens"] -= close_tokens
        realized_pnl = proceeds_per_leg - cost_basis_closed

        rows.append({
            "wallet": wallet,
            "condition_id": cid,
            "asset": a,
            "market_title": e.get("title"),
            "outcome": p.get("outcome"),
            "event_type": "MERGE",
            "price": round(proceeds_per_leg / close_tokens, 6) if close_tokens else None,
            "size": close_tokens,
            "avg_cost": round(avg_cost, 6),
            "realized_pnl": round(realized_pnl, 4),
            "closed_at": closed_at,
            "transaction_hash": tx_hash,
        })
    return rows


def build_realized_pnl_events(wallet: str, events: list[dict], initial_positions: dict = None,
                               outcome_token_ids: dict = None):
    """
    Walk one wallet's chronological TRADE_BUY / TRADE_SELL / REDEEM /
    SPLIT / MERGE events and emit a realized-PnL row for every SELL,
    REDEEM, and MERGE. Returns (realized_rows, open_positions) --
    open_positions is whatever's left on the ledger with a non-zero
    token balance after all events are processed (never sold,
    redeemed, or merged). Those are candidates for force-closing
    against real market resolution -- handled separately in
    force_close_abandoned_positions.

    initial_positions: optional starting ledger state (wallet's open
    positions carried over from a PREVIOUS run) -- required for
    correctness under incremental fetching. Without this, a position
    bought before the fetch's watermark and sold/redeemed/merged after
    it would have its closing event present but its opening event
    missing (it's older than what got fetched this run), and get
    silently skipped as "nothing on the ledger to close against" --
    reproducing the exact survivorship gap this ledger exists to fix,
    just via a different mechanism. Passing in the wallet's real prior
    open-position state (persisted in wallet_open_ledger between runs)
    keeps cost-basis continuity intact across incremental runs.

    outcome_token_ids: optional dict, condition_id -> [asset0, asset1],
    pre-fetched via fetch_outcome_token_ids for any condition_id that
    appears in a SPLIT event in `events` where initial_positions
    doesn't already have both outcome sides tracked. Fetch this BEFORE
    calling build_realized_pnl_events, same pattern as the existing
    force-close step -- keeps this function itself free of network
    calls.
    """
    positions = {k: dict(v) for k, v in initial_positions.items()} if initial_positions else {}
    realized = []

    for e in events:
        event_type = e["event_type"]

        if event_type == "SPLIT":
            _apply_split(positions, e, outcome_token_ids)
            continue

        if event_type == "MERGE":
            realized.extend(_apply_merge(wallet, positions, e))
            continue

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
        if event_type in ("TRADE_BUY", "TRADE_SELL") and price is None:
            # BUY/SELL genuinely need a real price -- no sensible default.
            continue

        if event_type == "TRADE_BUY":
            pos["tokens"] += size
            pos["cost"] += price * size

        elif event_type in ("TRADE_SELL", "REDEEM"):
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
            settle_price = price if (event_type == "TRADE_SELL" or price) else 1.0
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
                "event_type": event_type,
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
    (never sold, never redeemed, never merged), look up real
    resolution status ONLY for those markets and force-realize any
    that have actually settled -- at the true settlement value ($1
    for the winning outcome index, $0 for every other outcome), not
    assumed.
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
            # No real event/tx backs a force-close, so the upsert key is
            # derived from (condition_id, asset) rather than fetch time --
            # deterministic across retries, matching the MERGE fallback
            # pattern above instead of minting a new row every run.
            "transaction_hash": f"missing-txhash:{pos['condition_id']}:FORCE_CLOSE_RESOLVED:{asset}",
        })
    return realized


def run(wallet_events: dict, resolve_abandoned: bool = True, initial_open_positions: dict = None):
    """
    wallet_events: dict from fetch_polymarket_activity.run() --
    wallet -> chronological event list (under incremental fetching,
    this is only NEW events since the wallet's last watermark, not
    full history).

    initial_open_positions: optional dict of wallet -> {asset: pos}
    (loaded from wallet_open_ledger) -- each wallet's carried-over open
    position state from the previous run. Required for correctness
    once fetching is incremental; see build_realized_pnl_events for why.

    Returns (all_rows, new_open_positions) -- new_open_positions is
    wallet -> {asset: pos} to persist for next run (the caller should
    overwrite each wallet's stored state with this, not merge it --
    it already IS the merge of prior state + this run's new events).
    A wallet with no new events this run still carries its existing
    open state forward unchanged, since nothing happened to change it.
    """
    initial_open_positions = initial_open_positions or {}
    all_rows = []
    new_open_positions = {}
    for i, (wallet, events) in enumerate(wallet_events.items(), 1):
        if not events:
            existing = initial_open_positions.get(wallet)
            if existing:
                new_open_positions[wallet] = existing
            continue
        wallet_initial = initial_open_positions.get(wallet)

        # Pre-fetch outcome token ids ONLY for condition_ids that
        # appear in a SPLIT event where this wallet doesn't already
        # have both outcome sides tracked under a real asset id --
        # keeps build_realized_pnl_events itself free of network calls.
        split_condition_ids = {e["condition_id"] for e in events if e["event_type"] == "SPLIT"}
        already_tracked_cids = set()
        if wallet_initial:
            for pos in wallet_initial.values():
                already_tracked_cids.add(pos["condition_id"])
        needs_lookup = split_condition_ids - already_tracked_cids
        outcome_token_ids = fetch_outcome_token_ids(list(needs_lookup)) if needs_lookup else {}

        realized, open_positions = build_realized_pnl_events(
            wallet, events, initial_positions=wallet_initial, outcome_token_ids=outcome_token_ids
        )
        if resolve_abandoned and open_positions:
            force_closed = force_close_abandoned_positions(wallet, open_positions)
            realized.extend(force_closed)
            # Force-closed assets are now resolved -- drop them from the
            # carried-forward open state so we don't keep re-checking
            # (and re-force-closing) an already-settled position forever.
            force_closed_assets = {r["asset"] for r in force_closed}
            open_positions = {a: p for a, p in open_positions.items() if a not in force_closed_assets}
        all_rows.extend(realized)
        if open_positions:
            new_open_positions[wallet] = open_positions
        print(f"  [{i}/{len(wallet_events)}] {wallet}: {len(realized)} realized PnL events "
              f"({len(open_positions)} still open)")
    return all_rows, new_open_positions
