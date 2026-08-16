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
 * completedAt arrives as a UTC ISO string from the server (via
 * DataFreshness.tsx). Formatting -- both the relative "X minutes ago"
 * text and the absolute local timestamp -- has to happen here, client-
 * side, since the server has no idea what timezone the visitor is in.
 *
 * Renders nothing until mounted (first render always returns null, on
 * both server AND client, before useEffect ever runs) -- this is
 * deliberate, not a loading-state afterthought: it means the server-
 * rendered HTML and the client's first paint are IDENTICAL (both
 * "nothing"), so there's no hydration mismatch to suppress or work
 * around. The actual text only appears after useEffect fires, which is
 * imperceptible in practice since the underlying data only changes
 * every 2 hours anyway.
 */
export default function DataFreshnessClient({
  completedAt,
}: {
  completedAt: string | null;
}) {
  const [display, setDisplay] = useState<{ relative: string; absolute: string } | null>(null);

  useEffect(() => {
    if (!completedAt) return;
    const update = () => {
      setDisplay({
        relative: formatRelative(completedAt),
        absolute: new Date(completedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
    };
    update();
    // Keeps "X minutes ago" honest for anyone leaving a tab open,
    // rather than freezing at whatever it said on page load.
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [completedAt]);

  if (!completedAt || !display) return null;

  return (
    <span className="text-xs text-muted" title={display.absolute}>
      Data last refreshed {display.relative}
    </span>
  );
}
