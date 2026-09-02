import NavBar from "./NavBar";
import DataFreshnessClient from "./DataFreshnessClient";

/**
 * Thin wrapper around NavBar (the actual client-side nav bar, moved
 * here from what used to be Nav.tsx -- see NavBar.tsx). DataFreshnessClient
 * self-fetches from /api/last-refresh client-side (see that file for
 * why), so unlike the old DataFreshness.tsx it needs no Server
 * Component / async plumbing to compose into NavBar -- it's just
 * another Client Component now.
 *
 * showFreshness, added 2026-08-29: the freshness badge only makes
 * sense on pages actually showing pipeline-derived data (the
 * leaderboard, a trader's page) -- it read as out-of-place chrome on
 * Methodology/Contact/Login/etc, which show nothing "fresh" at all.
 * Defaults to false (opt-in) rather than true (opt-out) so a new page
 * that imports Nav the plain `<Nav />` way -- the common case -- does
 * NOT show it by default.
 */
export default function Nav({ showFreshness = false }: { showFreshness?: boolean } = {}) {
  return <NavBar freshness={showFreshness ? <DataFreshnessClient /> : null} />;
}
