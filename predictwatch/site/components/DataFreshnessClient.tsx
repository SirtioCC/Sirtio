"use client";

import { useEffect, useState } from "react";

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

/**
 * Fetches completedAt itself from /api/last-refresh (an uncached Route
 * Handler -- see that file) instead of receiving it as a server-
 * rendered prop baked into this page's own ISR snapshot. That used to
 * mean two pages open at the same real moment could show different
 * "last refreshed" values -- not because the underlying data
 * disagreed, but because each page/route regenerates its cached HTML
 * independently, only on a request arriving after ITS OWN revalidate
 * window elapsed. A frequently-hit route (e.g. a trader page getting
 * crawled for its OG image) picks up a new pipeline_runs row sooner
 * than a rarely-visited one, purely from traffic, not data. Fetching
 * this value live, client-side, on every mount and interval tick,
 * means the badge always reflects the actual current DB state
 * regardless of how stale the surrounding page's own cache is.
 *
 * Renders nothing until the first successful fetch resolves -- the
 * server-rendered HTML and the client's first paint are both "nothing"
 * either way, so there's no hydration mismatch to work around, same as
 * before this only depended on a prop instead of a fetch.
 */
export default function DataFreshnessClient() {
  const [display, setDisplay] = useState<{ relative: string; absolute: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const update = async () => {
      try {
        const res = await fetch("/api/last-refresh");
        if (!res.ok) return;
        const { completedAt } = (await res.json()) as { completedAt: string | null };
        if (cancelled || !completedAt) return;
        setDisplay({
          relative: formatRelative(completedAt),
          absolute: new Date(completedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        });
      } catch {
        // Same degrade as the old getLastRefresh() try/catch: a failed
        // fetch just means the badge doesn't update this tick, not a
        // broken page.
      }
    };

    update();
    // Re-fetches completedAt itself on every tick, not just re-formatting
    // a value captured once at mount -- that's what actually keeps this
    // in sync with new pipeline runs as they land, not only with the
    // passage of time.
    const interval = setInterval(update, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!display) return null;

  return (
    <span className="text-xs text-muted" title={display.absolute}>
      Data last refreshed {display.relative}
    </span>
  );
}
