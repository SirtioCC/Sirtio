"use client";

import { useState } from "react";
import type { TraderPosition } from "@/lib/queries";

function formatMoney(v: number | null) {
  if (v === null) return "--";
  const sign = v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Maps the raw event_type from trader_realized_pnl_events (see
// TraderPosition in lib/queries.ts) to how a position actually closed.
// TRADE_BUY/SPLIT never appear -- those open a position, they don't
// close one, so getTraderPositions never returns them. FORCE_CLOSE_RESOLVED
// is synthetic (realized_pnl.py inferring an abandoned position settled
// at market resolution, not a real on-chain action), so it's flagged
// `synthetic` and gets a hollow/dashed marker instead of a solid dot --
// visually honest that it's an inferred close, not an observed one.
const EVENT_TYPES: Record<string, { label: string; dotClassName: string; synthetic?: boolean }> = {
  TRADE_SELL: { label: "Sold", dotClassName: "bg-accent" },
  REDEEM: { label: "Redeemed", dotClassName: "bg-type-redeemed" },
  MERGE: { label: "Merged", dotClassName: "bg-type-merged" },
  FORCE_CLOSE_RESOLVED: { label: "Force-closed", dotClassName: "bg-muted", synthetic: true },
};

const FILTERABLE_TYPES = ["TRADE_SELL", "REDEEM", "MERGE", "FORCE_CLOSE_RESOLVED"] as const;

function EventDot({ dotClassName, synthetic }: { dotClassName: string; synthetic?: boolean }) {
  return (
    <span
      className={
        synthetic
          ? "w-2 h-2 rounded-full border border-dashed border-muted"
          : `w-2 h-2 rounded-full ${dotClassName}`
      }
    />
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  dotClassName,
  synthetic,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClassName: string;
  synthetic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-parchment"
          : "border-hairline bg-surface-raised text-body hover:border-accent/40"
      }`}
    >
      <EventDot dotClassName={dotClassName} synthetic={synthetic} />
      {label}
      <span className="font-mono text-[10px] text-muted">{count}</span>
    </button>
  );
}

export default function PositionsList({ positions }: { positions: TraderPosition[] }) {
  const [filter, setFilter] = useState<"ALL" | (typeof FILTERABLE_TYPES)[number]>("ALL");

  const counts = positions.reduce<Record<string, number>>((acc, p) => {
    if (!p.event_type) return acc;
    acc[p.event_type] = (acc[p.event_type] ?? 0) + 1;
    return acc;
  }, {});

  const visible = filter === "ALL" ? positions : positions.filter((p) => p.event_type === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChip
          active={filter === "ALL"}
          onClick={() => setFilter("ALL")}
          label="All"
          count={positions.length}
          dotClassName="bg-muted"
        />
        {FILTERABLE_TYPES.map((type) => {
          const count = counts[type] ?? 0;
          if (count === 0) return null;
          const meta = EVENT_TYPES[type];
          return (
            <FilterChip
              key={type}
              active={filter === type}
              onClick={() => setFilter(type)}
              label={meta.label}
              count={count}
              dotClassName={meta.dotClassName}
              synthetic={meta.synthetic}
            />
          );
        })}
      </div>

      <div className="bg-surface border border-accent/40 rounded-lg px-4 sm:px-6 pt-2">
        {/* Column header only makes sense once Side/Entry/PnL/Return sit
            in fixed columns, which only happens at sm+ -- see the mobile
            row layout below, which stacks PnL/Return under the market
            title instead of squeezing them into the same row. */}
        <div className="hidden sm:grid sm:grid-cols-[1fr_80px_90px_100px_90px] gap-4 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
          <span>Market</span>
          <span className="text-right">Side</span>
          <span className="text-right">Entry</span>
          <span className="text-right">PnL</span>
          <span className="text-right">Return</span>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-body py-6">No positions match this filter.</p>
        ) : (
          visible.map((p) => {
            const meta = p.event_type ? EVENT_TYPES[p.event_type] : undefined;
            const resolvedText = p.closed_at
              ? `Resolved ${new Date(p.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : "Resolved";
            const entryText = p.avg_price !== null ? `${(p.avg_price * 100).toFixed(0)}c` : "--";
            const pnlPositive = (p.realized_pnl ?? 0) >= 0;
            const returnPositive = (p.percent_return_approx ?? 0) >= 0;
            const pnlText = formatMoney(p.realized_pnl);
            const returnText = p.percent_return_approx !== null ? `${p.percent_return_approx.toFixed(0)}%` : "--";

            return (
              <div key={p.condition_id} className="py-3 border-b border-hairline">
                {/* Mobile: title gets the full row width so long market
                    names wrap onto a second line instead of truncating
                    after a few characters; PnL/Return move to their own
                    row underneath instead of fighting the title for
                    horizontal space. */}
                <div className="sm:hidden">
                  <p className="text-sm text-parchment leading-snug">{p.market_title || "--"}</p>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted mt-1">
                    <span>{resolvedText}</span>
                    {meta && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span className="inline-flex items-center gap-1">
                          <EventDot dotClassName={meta.dotClassName} synthetic={meta.synthetic} />
                          {meta.label}
                        </span>
                      </>
                    )}
                    {p.outcome && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span>{p.outcome}</span>
                      </>
                    )}
                    <span aria-hidden="true">&middot;</span>
                    <span>{entryText} entry</span>
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <span className={`font-mono text-sm ${pnlPositive ? "text-signal-yes" : "text-signal-no"}`}>
                      {pnlText}
                    </span>
                    <span className={`font-mono text-xs ${returnPositive ? "text-signal-yes" : "text-signal-no"}`}>
                      {returnText}
                    </span>
                  </div>
                </div>

                {/* Desktop: fixed columns, as before. */}
                <div className="hidden sm:grid sm:grid-cols-[1fr_80px_90px_100px_90px] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-parchment truncate">{p.market_title || "--"}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted mt-0.5">
                      <span>{resolvedText}</span>
                      {meta && (
                        <>
                          <span aria-hidden="true">&middot;</span>
                          <span className="inline-flex items-center gap-1">
                            <EventDot dotClassName={meta.dotClassName} synthetic={meta.synthetic} />
                            {meta.label}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-xs text-muted text-right">{p.outcome || "--"}</span>
                  <span className="font-mono text-xs text-muted text-right">{entryText}</span>
                  <span className={`font-mono text-xs text-right ${pnlPositive ? "text-signal-yes" : "text-signal-no"}`}>
                    {pnlText}
                  </span>
                  <span className={`font-mono text-xs text-right ${returnPositive ? "text-signal-yes" : "text-signal-no"}`}>
                    {returnText}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div className="pb-2" />
      </div>
    </div>
  );
}
