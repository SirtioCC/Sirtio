"""
inspect_category_shape.py

One-off: check whether Polymarket's Gamma /markets endpoint returns
category/tag data when queried the SAME way realized_pnl.py already
queries it (batched by condition_ids), with and without include_tag=true.
Needed before building a "Strongest Market" feature -- confirmed via
SQL that market_snapshots has zero category coverage for markets
traders have actually resolved positions in, so this has to come from
a live Gamma lookup instead. Not part of the pipeline -- delete after use.
"""
import sys
import json
import requests

GAMMA_MARKETS_URL = "https://gamma-api.polymarket.com/markets"


def main():
    if len(sys.argv) < 2:
        print("Usage: python inspect_category_shape.py 0xCONDITION_ID [more_condition_ids...]")
        sys.exit(1)
    condition_ids = sys.argv[1:]

    print("=== Baseline sanity check: closed=true, no condition_id filter ===")
    resp = requests.get(GAMMA_MARKETS_URL, params={"closed": "true", "limit": 3}, timeout=30)
    resp.raise_for_status()
    baseline = resp.json()
    print(f"Got {len(baseline)} market objects with no condition_id filter\n")
    for m in baseline[:3]:
        print(f"conditionId: {m.get('conditionId')}  question: {m.get('question')}")
        print(f"all top-level keys: {sorted(m.keys())}")
        print("---")

    for include_tag in (False, True):
        params = {"condition_ids": ",".join(condition_ids), "limit": len(condition_ids)}
        if include_tag:
            params["include_tag"] = "true"
        print(f"\n=== Request with include_tag={include_tag} ===")
        resp = requests.get(GAMMA_MARKETS_URL, params=params, timeout=30)
        resp.raise_for_status()
        markets = resp.json()
        print(f"Got {len(markets)} market objects\n")
        for m in markets:
            print(f"conditionId: {m.get('conditionId')}")
            print(f"question: {m.get('question')}")
            # Print every key so we see the full real shape, not a guess
            print(f"all top-level keys: {sorted(m.keys())}")
            if "events" in m:
                print(f"events (raw): {json.dumps(m['events'], indent=2)[:2000]}")
            if "tags" in m:
                print(f"tags (raw): {json.dumps(m['tags'], indent=2)[:2000]}")
            print("---")


if __name__ == "__main__":
    main()
