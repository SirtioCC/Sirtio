import psycopg2, os, traceback
import fetch_polymarket_activity
import realized_pnl

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("SELECT DISTINCT wallet FROM trader_leaderboard_snapshots WHERE fetched_at >= (SELECT MAX(fetched_at) FROM trader_leaderboard_snapshots) - INTERVAL '1 minute'")
wallets = [row[0] for row in cur.fetchall()]
conn.close()
print(f"Testing against {len(wallets)} real leaderboard wallets")

try:
    events, bot_wallets, _watermarks = fetch_polymarket_activity.run(wallets)
    print("--- Activity fetch complete ---")
    if bot_wallets:
        print(f"Bot-capped wallets: {sorted(bot_wallets)}")
    for w, evs in events.items():
        print(f"{w}: {len(evs)} events")
    print()
    print("--- Now running realized_pnl.run() with FULL traceback on any crash ---")
    rows, open_positions = realized_pnl.run(events)
    print(f"SUCCESS: {len(rows)} total realized PnL rows, "
          f"{len(open_positions)} wallets with open positions remaining")
except Exception:
    print("CRASHED -- full traceback below:")
    traceback.print_exc()
