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

Runs ONCE per pipeline execution and needs population stats (mu/sigma2/
tau2) that reflect the FULL current 90-day realized-PnL ledger across
every tracked wallet, not just whoever had new activity today.

INCREMENTAL as of 2026-08-29 (wallet_score_stats cache, see its comment
in run_pipeline.py's SCHEMA): re-aggregating the entire
trader_realized_pnl_events table from scratch every run was fine at one
run/day, but scales linearly with run frequency for data that mostly
hasn't changed -- switching to hourly would have meant 24x the egress
for an almost-identical answer. Instead, each wallet's contribution to
the population stats is cached as sufficient statistics (n, sum,
sum-of-squares of its percent returns, plus dollar totals) in
wallet_score_stats, and only re-derived from the real ledger for wallets
with new realized-pnl activity this run, wallets never cached before, or
wallets whose cache entry has gone stale (see fetch_position_returns).
Everyone else's numbers come straight from the cache. The math is exact,
not approximate -- mean/variance are fully recoverable from (n, sum,
sumsq), so this is a reformulation of the original computation, not a
different one.

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

import psycopg2.extras

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

# How long a wallet's wallet_score_stats row can go without a real
# re-check against trader_realized_pnl_events. Needed because a
# position can age OUT of the rolling 90-day window with no new event
# at all -- a wallet with zero new activity still needs an occasional
# refresh or its cached stats would just go stale forever. Time-based
# (not a fixed batch size/run) so the same ~1-day-max staleness holds
# whether this pipeline runs hourly, daily, or anything in between --
# at hourly cadence roughly 1/20th of cached wallets get swept up per
# run; at daily cadence, effectively everyone does.
STALE_AFTER_INTERVAL = "20 hours"


def fetch_open_cost_basis(conn):
    """
    Total OPEN (never sold/redeemed/merged, unresolved) cost basis per
    wallet. Reads total_open_cost, a scalar column on wallet_open_ledger
    maintained by run_pipeline.save_wallet_open_ledger (which already
    holds each wallet's positions dict in memory at write time, so
    computing the sum there is free) -- added 2026-08-29 alongside
    wallet_score_stats below so this no longer has to pull the full
    positions_json blob for every tracked wallet on every run just to
    re-sum something that only actually changes when the ledger itself
    changes.

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
        cur.execute("SELECT wallet, total_open_cost FROM wallet_open_ledger")
        rows = cur.fetchall()
    return {wallet: float(cost) if cost is not None else 0.0 for wallet, cost in rows}


def fetch_position_returns(conn, changed_wallets=(), all_wallets=()):
    """
    Per-wallet sufficient statistics (n, sum, sum-of-squares of percent
    returns; total realized PnL and closed cost basis dollars) for the
    current rolling 90-day ledger, read from the wallet_score_stats
    cache and kept correct there incrementally rather than recomputed
    from trader_realized_pnl_events in full on every run.

    Only three kinds of wallets get a real re-aggregation against the
    ledger this run:
      - changed_wallets: wallets with new realized-pnl events this run
        (passed in from run_pipeline.run(), which already knows this
        from its own incremental activity fetch -- see realized_rows).
      - never before cached (new to tracking).
      - cached but stale (their row's updated_at is older than
        STALE_AFTER_INTERVAL) -- covers positions aging OUT of the
        90-day window with no new event to trigger a refresh, and also
        naturally re-verifies/expires wallets that have since dropped
        out of tracking entirely (their row just keeps aging until it's
        swept and found to have zero qualifying positions left, at
        which point it's deleted rather than left stale forever).
    Every other wallet's contribution comes straight from its existing
    cache row. This is the same math as before, just not re-derived
    from raw ledger rows for wallets whose ledger didn't actually
    change -- position-level aggregation (SUM/GROUP BY) still happens
    in Postgres, only now scoped to the wallets that actually need it.

    Returns wallet -> {"n", "sum_returns", "sumsq_returns", "wallet_pnl",
    "wallet_closed_cost"}. mean = sum_returns/n; sample variance =
    (sumsq_returns - sum_returns**2/n) / (n-1) -- both exactly
    recoverable from these three numbers, not an approximation of the
    original per-position list.

    wallet_pnl (real dollar totals) includes every position regardless
    of size -- a tiny cost basis doesn't distort a dollar sum the way
    it distorts a percentage, and this is what the site displays as
    Realized PnL, so it should reflect the full ledger. The n/sum/sumsq
    triple (percent returns, feeding mu/sigma2/tau2 and each wallet's
    own r_bar) excludes positions below MIN_POSITION_COST_BASIS or
    beyond MAX_ABS_PCT_RETURN -- see the constants above for why. This
    does mean n can run a little below a wallet's true total closed-
    position count for a wallet with excluded dust positions; the
    site's own "All Positions" list is a separate, unfiltered query and
    still shows every position. wallet_closed_cost is paired with
    fetch_open_cost_basis's still-OPEN figure to get open_fraction in
    compute_scores; not used in the score math itself.
    """
    changed_wallets = set(changed_wallets)
    all_wallets = set(all_wallets)

    with conn.cursor() as cur:
        cur.execute("SELECT wallet FROM wallet_score_stats")
        cached_wallets = {row[0] for row in cur.fetchall()}
        never_cached = all_wallets - cached_wallets

        cur.execute(
            "SELECT wallet FROM wallet_score_stats WHERE updated_at < NOW() - %s::interval",
            (STALE_AFTER_INTERVAL,),
        )
        stale = {row[0] for row in cur.fetchall()}

        refresh_wallets = changed_wallets | never_cached | stale
        if refresh_wallets:
            cur.execute(
                """
                SELECT wallet, condition_id,
                       SUM(realized_pnl) AS position_pnl,
                       SUM(avg_cost * size) AS position_cost_basis
                FROM trader_realized_pnl_events
                WHERE wallet = ANY(%s)
                  AND closed_at IS NOT NULL
                  AND closed_at >= (NOW() - INTERVAL '90 days')
                GROUP BY wallet, condition_id
                """,
                (list(refresh_wallets),),
            )
            position_rows = cur.fetchall()

            fresh_stats = {}
            for wallet, _condition_id, pnl, cost_basis in position_rows:
                pnl = float(pnl) if pnl is not None else 0.0
                cost_basis = float(cost_basis) if cost_basis is not None else 0.0
                s = fresh_stats.setdefault(wallet, {
                    "n": 0, "sum_returns": 0.0, "sumsq_returns": 0.0,
                    "wallet_pnl": 0.0, "wallet_closed_cost": 0.0,
                })
                s["wallet_pnl"] += pnl
                s["wallet_closed_cost"] += cost_basis
                if cost_basis >= MIN_POSITION_COST_BASIS:
                    pct_return = (pnl / cost_basis) * 100
                    if abs(pct_return) <= MAX_ABS_PCT_RETURN:
                        s["n"] += 1
                        s["sum_returns"] += pct_return
                        s["sumsq_returns"] += pct_return ** 2

            now_iso = datetime.now(timezone.utc).isoformat()
            upsert_rows = [
                {**fresh_stats[wallet], "wallet": wallet, "updated_at": now_iso}
                for wallet in refresh_wallets if wallet in fresh_stats
            ]
            # A refreshed wallet with no qualifying positions left at all
            # (e.g. everything it had aged out of the 90-day window) gets
            # its stale cache row deleted instead of left around with
            # stale nonzero numbers forever.
            emptied_wallets = [wallet for wallet in refresh_wallets if wallet not in fresh_stats]

            if upsert_rows:
                psycopg2.extras.execute_batch(
                    cur,
                    """
                    INSERT INTO wallet_score_stats
                    (wallet, n, sum_returns, sumsq_returns, wallet_pnl, wallet_closed_cost, updated_at)
                    VALUES (%(wallet)s, %(n)s, %(sum_returns)s, %(sumsq_returns)s,
                            %(wallet_pnl)s, %(wallet_closed_cost)s, %(updated_at)s)
                    ON CONFLICT (wallet) DO UPDATE SET
                        n = EXCLUDED.n,
                        sum_returns = EXCLUDED.sum_returns,
                        sumsq_returns = EXCLUDED.sumsq_returns,
                        wallet_pnl = EXCLUDED.wallet_pnl,
                        wallet_closed_cost = EXCLUDED.wallet_closed_cost,
                        updated_at = EXCLUDED.updated_at
                    """,
                    upsert_rows,
                )
            if emptied_wallets:
                cur.execute("DELETE FROM wallet_score_stats WHERE wallet = ANY(%s)", (emptied_wallets,))
            conn.commit()

        cur.execute(
            "SELECT wallet, n, sum_returns, sumsq_returns, wallet_pnl, wallet_closed_cost FROM wallet_score_stats"
        )
        all_rows = cur.fetchall()

    return {
        wallet: {
            "n": n,
            "sum_returns": sum_returns,
            "sumsq_returns": sumsq_returns,
            "wallet_pnl": wallet_pnl,
            "wallet_closed_cost": wallet_closed_cost,
        }
        for wallet, n, sum_returns, sumsq_returns, wallet_pnl, wallet_closed_cost in all_rows
    }


def compute_population_stats(wallet_stats: dict):
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

    wallet_stats: wallet -> {"n", "sum_returns", "sumsq_returns", ...}
    (see fetch_position_returns) -- derived from cached sufficient
    statistics rather than raw per-position return lists; mean/variance
    are exactly recoverable from (n, sum, sumsq), so this is the same
    computation as operating on the raw lists, not an approximation.
    """
    total_n = sum(s["n"] for s in wallet_stats.values())
    if total_n == 0:
        return 0.0, 1.0, 0.0

    total_sum = sum(s["sum_returns"] for s in wallet_stats.values())
    total_sumsq = sum(s["sumsq_returns"] for s in wallet_stats.values())
    mu = total_sum / total_n

    ss_within, df_within = 0.0, 0
    for s in wallet_stats.values():
        n_i = s["n"]
        if n_i < 2:
            continue
        ss_within += s["sumsq_returns"] - (s["sum_returns"] ** 2) / n_i
        df_within += n_i - 1
    if df_within > 0:
        sigma2 = ss_within / df_within
    else:
        ss_total = total_sumsq - 2 * mu * total_sum + total_n * mu ** 2
        sigma2 = ss_total / max(total_n - 1, 1)
    sigma2 = max(sigma2, 1.0)  # floor -- avoid divide-by-zero degeneracy

    trader_means = [s["sum_returns"] / s["n"] for s in wallet_stats.values() if s["n"] > 0]
    k_traders = len(trader_means)
    n_bar = total_n / k_traders if k_traders else 1
    if k_traders > 1:
        grand_mean = sum(trader_means) / k_traders
        var_of_means = sum((m - grand_mean) ** 2 for m in trader_means) / (k_traders - 1)
        tau2 = max(var_of_means - (sigma2 / n_bar), 0.0)
    else:
        tau2 = 0.0

    return mu, sigma2, tau2


def compute_scores(wallet_stats: dict, mu, sigma2, tau2, k=None,
                    open_cost_basis: dict | None = None):
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
    for wallet, s in wallet_stats.items():
        n_i = s["n"]
        if n_i == 0:
            continue
        sum_i = s["sum_returns"]
        r_bar = sum_i / n_i

        if n_i >= 5:
            sigma_i2 = (s["sumsq_returns"] - (sum_i ** 2) / n_i) / (n_i - 1)
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
        closed_cost = s["wallet_closed_cost"]
        total_cost = open_cost + closed_cost
        open_fraction = (open_cost / total_cost) if total_cost > 0 else None

        results.append({
            "wallet": wallet,
            "position_count": n_i,
            "avg_edge_pct": r_bar,
            "shrunk_edge_pct": theta_i,
            "z_score": z_i,
            "realized_pnl_90d": s["wallet_pnl"],
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


def run(conn, changed_wallets=(), all_wallets=()):
    """
    changed_wallets: wallets with new realized-pnl activity this run
    (from run_pipeline.run()'s realized_rows) -- these get a real
    re-aggregation against trader_realized_pnl_events; see
    fetch_position_returns for the full incremental-refresh mechanics.
    all_wallets: every wallet currently tracked this run (leaderboard
    UNION top-scored UNION followed), used only to detect wallets never
    cached before.

    Returns (results, population_stats). population_stats is logged
    and stored every run for visibility into how mu/sigma2/tau2/k
    drift over time as the wallet pool and their track records change.
    """
    wallet_stats = fetch_position_returns(conn, changed_wallets, all_wallets)
    open_cost_basis = fetch_open_cost_basis(conn)
    mu, sigma2, tau2 = compute_population_stats(wallet_stats)
    results, k = compute_scores(wallet_stats, mu, sigma2, tau2, open_cost_basis=open_cost_basis)
    return results, {
        "mu": mu, "sigma2": sigma2, "tau2": tau2, "k": k,
        "n_wallets": len(results),
    }
