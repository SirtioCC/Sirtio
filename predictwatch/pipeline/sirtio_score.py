"""
Sirtio Score v2 -- Bayesian-shrunk, risk-adjusted mean return.

Replaces the old formula (avg_edge_pct + log-scaled magnitude, damped by
a linear position_count/30 multiplier) with one fused statistic:
shrink each trader's edge toward the population mean proportional to
how little data exists on them, then measure that shrunk edge against
its own posterior uncertainty (a Bayesian analog of a Sharpe ratio / t-
statistic). See conversation notes for the full derivation -- this is
standard empirical Bayes / hierarchical shrinkage, the same family of
technique actuaries and sports-analytics "true talent" models use.

Runs ONCE per pipeline execution against the FULL current 90-day
realized-PnL ledger (queried fresh from trader_realized_pnl_events),
not just whatever activity this specific run happened to fetch --
population stats (mu/sigma2/tau2) need to reflect everyone, regardless
of which wallets had new activity today under incremental fetching.

Computed here in Python, not live SQL, on purpose: the population-level
aggregation (grand mean, pooled variance, between-trader variance via
method-of-moments) is genuinely awkward to express and debug as a
single SQL query, and it's the same number for every site visitor until
the next pipeline run -- no reason to redo it per page load. Results
are stored in trader_sirtio_scores; the site just SELECTs the
precomputed number.
"""
import math
from datetime import datetime, timezone

# Below this cost basis, a percent return is too noisy to trust as a
# skill signal -- a $2 position that resolves YES can legitimately
# read as a 99,900% "return" (buying deep-discount shares right before
# a near-certain resolution is a real, low-risk Polymarket strategy,
# not bad data), but pooling that percentage in with everyone else's
# distorts the whole population's mu/sigma2 far out of proportion to
# the few real dollars actually at risk. Confirmed live 2026-08-18:
# one wallet's run of sub-$70 positions (up to 99,900% each) pushed
# sigma2 from ~70K to ~1.67M and collapsed tau2 to exactly 0 in a
# single pipeline run, which zeroed out every OTHER trader's shrunk
# edge (see compute_scores' tau2==0 branch) and broke that day's
# scores site-wide, not just for the outlier wallet.
MIN_POSITION_COST_BASIS = 25.0
# Belt-and-suspenders on top of the cost-basis floor above: even a
# position that clears MIN_POSITION_COST_BASIS can still produce an
# extreme percent return (confirmed in the same incident: a $65.72
# cost basis position read as an 8,642% return) that shouldn't be
# allowed to dominate the pooled statistics on its own.
MAX_ABS_PCT_RETURN = 1000.0
# Same class of problem as the two guards above, one level up the
# pipeline: compute_scores' per-trader sigma_i2 (n_i >= 5 branch) used
# to floor at 1.0 -- fine when a trader's own returns have real spread,
# but REDEEM events (added 2026-08-26) settle an abandoned losing
# position at exactly -100%, so a wallet with many redeemed losses has
# nearly ALL its returns clustered within a rounding error of -100%.
# Sample variance on a near-degenerate cluster like that collapses
# toward zero, and omega_i = 1/sqrt(n_i/sigma_i2 + 1/tau2) collapses
# with it -- confirmed live 2026-08-27: one 57-position wallet hit
# z = -755 this way, a statistically meaningless magnitude for a
# Bayesian t-statistic. Worse, k (compute_scores' logistic steepness)
# is auto-calibrated off std_z across the WHOLE population, so a
# handful of these degenerate wallets silently crushed k -- and with
# it, the displayed sirtio_score -- for every other trader too (the
# top-ranked wallet site-wide was reading 61.1 instead of a defensible
# ~95 purely because of this). 100.0 (a 10-percentage-point SD floor)
# is conservative relative to the population's own ~76pt spread but
# large enough that a near-identical run of redeemed losses can no
# longer read as near-infinite confidence.
MIN_TRADER_VARIANCE = 100.0


def fetch_open_cost_basis(conn):
    """
    Total OPEN (never sold/redeemed/merged, unresolved) cost basis per
    wallet, from wallet_open_ledger -- purely local/DB-side, no network
    calls, so this is cheap even though wallet_open_ledger holds tens
    of thousands of open positions across all tracked wallets combined.

    THIS EXISTS BECAUSE realized_pnl_90d/avg_edge_pct are built
    ENTIRELY from CLOSED positions (see fetch_position_returns) -- for
    an active high-frequency wallet that keeps most of its capital
    continuously deployed, that can be a small, self-selected slice of
    its real exposure. Confirmed live 2026-08-28: comparing our
    computed realized_pnl_90d for the #1-ranked wallet against
    Polymarket's OWN leaderboard pnl for the same wallet in the same
    trader_leaderboard_snapshots table showed a ~13x gap ($1.74M vs
    $136,830) that persisted even narrowed to a trailing 30-day window
    ($1.54M vs $136,830) -- ruling out a simple window-length
    explanation. Investigation found no duplicate-row or unit-scaling
    bug in the ledger (individual trade rows check out arithmetically,
    and the unique index on (wallet, asset, transaction_hash) is
    correctly enforced); instead, that one wallet had 745 open
    positions worth $2.54M in still-open cost basis sitting in
    wallet_open_ledger, MORE than its entire realized gain -- and
    checking the rest of the scored population, this is the norm, not
    an outlier: 108 of 138 currently-scored wallets (78%) have OVER
    HALF their real deployed capital sitting in positions the score
    never sees at all, in either direction. A wallet that closes
    winners quickly (this platform's most common profitable pattern --
    buy at a discount, exit near $0.999 right before resolution) while
    simply carrying more open risk than closed track record will look
    far more skilled by realized-only metrics than its actual current
    portfolio state supports.

    This does NOT feed into avg_edge_pct/z_score/sirtio_score --
    mark-to-market on an open, still-resolving book is exactly the kind
    of noisy signal this file already goes out of its way to keep out
    of the population statistics (see MIN_POSITION_COST_BASIS,
    MAX_ABS_PCT_RETURN, MIN_TRADER_VARIANCE above), and pricing all
    ~25,000 distinct currently-open markets across the tracked wallet
    pool live on every run would be a real, unbounded runtime/rate-limit
    cost this pipeline has already been burned by once (see the
    incremental-fetching comment in fetch_polymarket_activity.py).
    Returned instead as a transparency figure alongside the score, so
    the site can disclose how much of a wallet's real book the score
    is (and isn't) actually based on, and so a PnL number sourced
    directly from Polymarket's own leaderboard -- guaranteed to
    reconcile with what a user sees on Polymarket itself, unlike our
    realized-only figure -- can be shown instead of this one wherever
    the site needs a headline PnL dollar amount.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT wallet, positions_json FROM wallet_open_ledger")
        rows = cur.fetchall()

    open_cost_basis = {}
    for wallet, positions_json in rows:
        total = sum(float(p.get("cost") or 0.0) for p in positions_json.values())
        open_cost_basis[wallet] = total
    return open_cost_basis


def fetch_position_returns(conn):
    """
    Aggregate the full 90-day realized-PnL ledger to one row per
    position (wallet, condition_id) -- a partial sell followed by a
    later full exit produces multiple ledger rows for what is really
    one position, so this collapses them first, same reasoning as the
    site's old per-position SQL CTEs.

    wallet_pnl (real dollar totals) includes every position regardless
    of size -- a tiny cost basis doesn't distort a dollar sum the way
    it distorts a percentage, and this is what the site displays as
    Realized PnL, so it should reflect the full ledger. wallet_returns
    (percent returns, feeding mu/sigma2/tau2 and each wallet's own
    r_bar) excludes positions below MIN_POSITION_COST_BASIS or beyond
    MAX_ABS_PCT_RETURN -- see the constants above for why. This does
    mean position_count (len of a wallet's return list) can run a
    little below their true total closed-position count for a wallet
    with excluded dust positions; the site's own "All Positions" list
    is a separate, unfiltered query and still shows every position.

    Returns (wallet_returns, wallet_pnl, wallet_closed_cost):
      wallet_returns:     wallet -> list of per-position percent returns
      wallet_pnl:         wallet -> total realized PnL dollars (90d)
      wallet_closed_cost: wallet -> total CLOSED cost basis dollars
                          (90d, every position regardless of size --
                          same "full ledger" reasoning as wallet_pnl).
                          Paired with fetch_open_cost_basis's still-OPEN
                          figure to get open_fraction in compute_scores;
                          not used in the score math itself.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT wallet, condition_id,
                   SUM(realized_pnl) AS position_pnl,
                   SUM(avg_cost * size) AS position_cost_basis
            FROM trader_realized_pnl_events
            WHERE closed_at IS NOT NULL
              AND closed_at >= (NOW() - INTERVAL '90 days')
            GROUP BY wallet, condition_id
        """)
        rows = cur.fetchall()

    wallet_returns, wallet_pnl, wallet_closed_cost = {}, {}, {}
    for wallet, _condition_id, pnl, cost_basis in rows:
        pnl = float(pnl) if pnl is not None else 0.0
        cost_basis = float(cost_basis) if cost_basis is not None else 0.0
        wallet_pnl[wallet] = wallet_pnl.get(wallet, 0.0) + pnl
        wallet_closed_cost[wallet] = wallet_closed_cost.get(wallet, 0.0) + cost_basis
        if cost_basis >= MIN_POSITION_COST_BASIS:
            pct_return = (pnl / cost_basis) * 100
            if abs(pct_return) <= MAX_ABS_PCT_RETURN:
                wallet_returns.setdefault(wallet, []).append(pct_return)
    return wallet_returns, wallet_pnl, wallet_closed_cost


def compute_population_stats(wallet_returns: dict):
    """
    mu:     pooled mean return across every position, every trader
    sigma2: pooled within-trader variance (how noisy a single trade
            is, on average, for a typical trader)
    tau2:   between-trader variance of TRUE skill, via method-of-
            moments: Var(trader means) = tau2 + sigma2/n_bar, solved
            for tau2 and floored at 0 -- a negative raw estimate means
            "no detectable skill spread beyond noise, in this pool,"
            a real and legitimate possible outcome with a small wallet
            pool, not an error.
    """
    all_returns = [r for rs in wallet_returns.values() for r in rs]
    n_total = len(all_returns)
    if n_total == 0:
        return 0.0, 1.0, 0.0

    mu = sum(all_returns) / n_total

    ss_within, df_within = 0.0, 0
    for rs in wallet_returns.values():
        n_i = len(rs)
        if n_i < 2:
            continue
        mean_i = sum(rs) / n_i
        ss_within += sum((r - mean_i) ** 2 for r in rs)
        df_within += n_i - 1
    if df_within > 0:
        sigma2 = ss_within / df_within
    else:
        sigma2 = sum((r - mu) ** 2 for r in all_returns) / max(n_total - 1, 1)
    sigma2 = max(sigma2, 1.0)  # floor -- avoid divide-by-zero degeneracy

    trader_means = [sum(rs) / len(rs) for rs in wallet_returns.values() if rs]
    k_traders = len(trader_means)
    n_bar = n_total / k_traders if k_traders else 1
    if k_traders > 1:
        grand_mean = sum(trader_means) / k_traders
        var_of_means = sum((m - grand_mean) ** 2 for m in trader_means) / (k_traders - 1)
        tau2 = max(var_of_means - (sigma2 / n_bar), 0.0)
    else:
        tau2 = 0.0

    return mu, sigma2, tau2


def compute_scores(wallet_returns: dict, wallet_pnl: dict, mu, sigma2, tau2, k=None,
                    open_cost_basis: dict | None = None, wallet_closed_cost: dict | None = None):
    """
    Per-wallet: shrunk edge (theta_i), posterior uncertainty (omega_i),
    Z-score (theta_i / omega_i), and the final 0-100 Sirtio Score via a
    logistic squash of Z. Z=0 (true breakeven) maps to exactly 50.

    k: logistic steepness. If not supplied, auto-calibrated from the
    REAL spread of Z across this pool, so scores don't all bunch near
    50 or blow out to 0/100 -- solved so two standard deviations of Z
    lands near a score of ~95.

    open_cost_basis: optional wallet -> still-open cost basis (from
    fetch_open_cost_basis), attached to each result as open_cost_basis
    and open_fraction = open / (open + closed). Pure transparency data,
    not used anywhere in the score math itself -- see
    fetch_open_cost_basis's docstring for why.
    """
    results = []
    for wallet, returns in wallet_returns.items():
        n_i = len(returns)
        r_bar = sum(returns) / n_i

        if n_i >= 5:
            sigma_i2 = sum((r - r_bar) ** 2 for r in returns) / (n_i - 1)
            sigma_i2 = max(sigma_i2, MIN_TRADER_VARIANCE)
        else:
            sigma_i2 = sigma2  # too little personal data to trust their own variance

        if tau2 > 0:
            w_i = (n_i / sigma_i2) / (n_i / sigma_i2 + 1 / tau2)
            omega2 = 1 / (n_i / sigma_i2 + 1 / tau2)
        else:
            # No detectable between-trader skill variance in this pool --
            # every trader fully shrinks to the population mean.
            w_i = 0.0
            omega2 = sigma_i2 / n_i

        theta_i = w_i * r_bar + (1 - w_i) * mu
        omega_i = math.sqrt(omega2) if omega2 > 0 else 1e-9
        z_i = theta_i / omega_i

        open_cost = (open_cost_basis or {}).get(wallet, 0.0)
        closed_cost = (wallet_closed_cost or {}).get(wallet, 0.0)
        total_cost = open_cost + closed_cost
        open_fraction = (open_cost / total_cost) if total_cost > 0 else None

        results.append({
            "wallet": wallet,
            "position_count": n_i,
            "avg_edge_pct": r_bar,
            "shrunk_edge_pct": theta_i,
            "z_score": z_i,
            "realized_pnl_90d": wallet_pnl.get(wallet, 0.0),
            "open_cost_basis": open_cost,
            "open_fraction": open_fraction,
        })

    if k is None:
        z_values = [r["z_score"] for r in results]
        if len(z_values) > 1:
            mean_z = sum(z_values) / len(z_values)
            var_z = sum((z - mean_z) ** 2 for z in z_values) / (len(z_values) - 1)
            std_z = math.sqrt(var_z) if var_z > 0 else 1.0
        else:
            std_z = 1.0
        k = 2.944 / (2 * std_z) if std_z > 0 else 0.5  # ln(0.95/0.05) ~= 2.944

    for r in results:
        r["sirtio_score"] = round(100 / (1 + math.exp(-k * r["z_score"])), 1)

    return results, k


def run(conn):
    """
    Full computation against the current full 90-day ledger.
    Returns (results, population_stats). population_stats is logged
    and stored every run for visibility into how mu/sigma2/tau2/k
    drift over time as the wallet pool and their track records change.
    """
    wallet_returns, wallet_pnl, wallet_closed_cost = fetch_position_returns(conn)
    open_cost_basis = fetch_open_cost_basis(conn)
    mu, sigma2, tau2 = compute_population_stats(wallet_returns)
    results, k = compute_scores(wallet_returns, wallet_pnl, mu, sigma2, tau2,
                                 open_cost_basis=open_cost_basis, wallet_closed_cost=wallet_closed_cost)
    return results, {
        "mu": mu, "sigma2": sigma2, "tau2": tau2, "k": k,
        "n_wallets": len(results),
    }
