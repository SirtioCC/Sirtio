import { MIN_POSITIONS_FOR_RANKING } from "@/lib/tiers";

// Only the strongest trader pages are offered to Google for now.
// Search Console (2026-11-15) showed 128 of 133 known URLs as "Crawled"
// or "Discovered - currently not indexed", and 0 indexed. A new domain
// gets a small crawl budget, and ~100 near-identical template pages used
// it all. Fewer, richer pages let Google judge the site on its best
// content. Raise this number as the site earns links and authority.
export const INDEXABLE_TRADER_LIMIT = 30;

// One rule for both the sitemap and the trader page's robots meta tag,
// so the two can never disagree. A trader must have a computed score,
// meet the ranking minimum (same one the leaderboard uses), and sit in
// the top INDEXABLE_TRADER_LIMIT by rank.
export function isIndexableTrader(t: {
  rank: number | null;
  position_count: number;
  pm_score: number | null;
}): boolean {
  return (
    t.pm_score !== null &&
    t.rank !== null &&
    t.rank <= INDEXABLE_TRADER_LIMIT &&
    t.position_count >= MIN_POSITIONS_FOR_RANKING
  );
}
