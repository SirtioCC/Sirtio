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


def fetch_position_returns(conn):
    """
    Aggregate the full 90-day realized-PnL ledger to one row per
    position (wallet, condition_id) -- a partial sell followed by a
    later full exit produces multiple ledger rows for what is really
    one position, so this collapses them first, same reasoning as the
    site's old per-position SQL CTEs.
    Returns (wallet_returns, wallet_pnl):
      wallet_returns: wallet -> list of per-position percent returns
      wallet_pnl:     wallet -> total realized PnL dollars (90d)
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

    wallet_returns, wallet_pnl = {}, {}
    for wallet, _condition_id, pnl, cost_basis in rows:
        pnl = float(pnl) if pnl is not None else 0.0
        cost_basis = float(cost_basis) if cost_basis is not None else 0.0
        wallet_pnl[wallet] = wallet_pnl.get(wallet, 0.0) + pnl
        if cost_basis > 0:
            wallet_returns.setdefault(wallet, []).append((pnl / cost_basis) * 100)
    return wallet_returns, wallet_pnl


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


def compute_scores(wallet_returns: dict, wallet_pnl: dict, mu, sigma2, tau2, k=None):
    """
    Per-wallet: shrunk edge (theta_i), posterior uncertainty (omega_i),
    Z-score (theta_i / omega_i), and the final 0-100 Sirtio Score via a
    logistic squash of Z. Z=0 (true breakeven) maps to exactly 50.

    k: logistic steepness. If not supplied, auto-calibrated from the
    REAL spread of Z across this pool, so scores don't all bunch near
    50 or blow out to 0/100 -- solved so two standard deviations of Z
    lands near a score of ~95.
    """
    results = []
    for wallet, returns in wallet_returns.items():
        n_i = len(returns)
        r_bar = sum(returns) / n_i

        if n_i >= 5:
            sigma_i2 = sum((r - r_bar) ** 2 for r in returns) / (n_i - 1)
            sigma_i2 = max(sigma_i2, 1.0)
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

        results.append({
            "wallet": wallet,
            "position_count": n_i,
            "avg_edge_pct": r_bar,
            "shrunk_edge_pct": theta_i,
            "z_score": z_i,
            "realized_pnl_90d": wallet_pnl.get(wallet, 0.0),
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
    wallet_returns, wallet_pnl = fetch_position_returns(conn)
    mu, sigma2, tau2 = compute_population_stats(wallet_returns)
    results, k = compute_scores(wallet_returns, wallet_pnl, mu, sigma2, tau2)
    return results, {
        "mu": mu, "sigma2": sigma2, "tau2": tau2, "k": k,
        "n_wallets": len(results),
    }
