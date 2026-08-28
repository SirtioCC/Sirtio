import Link from "next/link";
import { getRecentSettlements, type RecentSettlement } from "@/lib/queries";
import { getDisplayName } from "@/lib/format";

function formatMoney(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * One margin column of the ticker. Only ever rendered at very wide
 * viewports (see the [@media(min-width:1850px)] gate below) -- below
 * that width there's no real margin for this to live in, so it
 * doesn't render at all rather than overlapping the page's content.
 *
 * Fixed-position, not absolute: pinning to the viewport (rather than
 * the page) keeps it visible the whole time regardless of how tall
 * the page actually is -- on the homepage that's mostly moot (the
 * hero is roughly one viewport tall anyway), but on the leaderboard's
 * long scrolling table, fixed is what keeps this feeling like an
 * ambient, always-present ticker instead of vanishing after the first
 * screenful.
 *
 * items is pre-doubled by the caller for a seamless scroll loop (the
 * translateY(-50%) keyframe in globals.css assumes exactly two copies
 * back to back).
 */
function TickerColumn({
  items, reverse, side,
}: {
  items: RecentSettlement[];
  reverse: boolean;
  side: "left" | "right";
}) {
  return (
    <div
      className={`hidden [@media(min-width:1850px)]:flex flex-col fixed top-28 bottom-28 w-[280px] z-0 ${
        side === "left" ? "left-8" : "right-8"
      }`}
      aria-hidden="true"
    >
      <span className="flex items-center gap-[7px] text-[10px] font-mono uppercase tracking-[0.14em] text-muted mb-2.5 flex-none">
        <span className="w-1.5 h-1.5 rounded-full bg-signal-yes shadow-[0_0_0_3px_rgba(79,191,139,0.18)]" />
        Recently settled
      </span>

      {/* group/col: hovering anywhere in the column pauses the scroll,
          so a link can actually be clicked mid-scroll instead of
          sliding out from under the pointer. */}
      <div
        className="group/col relative flex-1 overflow-hidden border-t border-hairline [mask-image:linear-gradient(to_bottom,transparent,black_28px,black_calc(100%-28px),transparent)]"
      >
        <div
          className={`flex flex-col motion-reduce:animate-none group-hover/col:[animation-play-state:paused] ${
            reverse
              ? "animate-[ticker-scroll_46s_linear_infinite_reverse]"
              : "animate-[ticker-scroll_46s_linear_infinite]"
          }`}
        >
          {items.map((s, i) => (
            <Link
              key={`${s.wallet}-${s.closed_at}-${i}`}
              href={`/trader/${s.wallet}`}
              tabIndex={-1}
              className="group block px-2 -mx-2 py-[11px] border-b border-hairline rounded-[5px] hover:bg-accent/[0.06] transition-colors"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-1.5 min-w-0">
                  {s.rank !== null && (
                    <span className="font-mono text-[10px] text-accent shrink-0">#{s.rank}</span>
                  )}
                  <span className="font-medium text-[11.5px] text-parchment truncate border-b border-accent/45 group-hover:text-accent group-hover:border-accent">
                    {getDisplayName(s.username, s.wallet)}
                  </span>
                </span>
                <span
                  className={`font-mono text-[11px] shrink-0 tabular-nums ${
                    s.realized_pnl >= 0 ? "text-signal-yes" : "text-signal-no"
                  }`}
                >
                  {formatMoney(s.realized_pnl)}
                </span>
              </div>
              <span className="block mt-[3px] font-mono text-[11px] text-[#7c8cae] truncate">
                {s.market_title ?? "—"}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Fills a page's side margins (only visible past ~1850px, where those
 * margins actually exist) with real, recently-settled positions
 * across every tracked wallet -- decorative in placement,
 * but not decorative in content: every row links to the real trader
 * page for whoever made that trade. See getRecentSettlements for why
 * this is ordered by recency rather than biggest wins.
 *
 * Self-contained async server component (same pattern as
 * DataFreshness.tsx) -- fetches its own data, degrades to nothing if
 * there isn't enough real recent activity to loop convincingly rather
 * than rendering a sparse, obviously-padded column.
 *
 * tabIndex={-1} on each link + aria-hidden on both columns: this is a
 * secondary, decorative rendering of positions that are (or will be)
 * discoverable through the real leaderboard/trader-page navigation --
 * without this, a keyboard or screen-reader user would tab through 48
 * duplicate links before ever reaching the page's actual content.
 */
export default async function MarginTicker() {
  const settlements = await getRecentSettlements(24);
  if (settlements.length < 6) return null;

  const mid = Math.ceil(settlements.length / 2);
  const left = settlements.slice(0, mid);
  const right = settlements.slice(mid);

  return (
    <>
      <TickerColumn items={[...left, ...left]} reverse={false} side="left" />
      <TickerColumn items={[...right, ...right]} reverse={true} side="right" />
    </>
  );
}
