import NavBar from "./NavBar";
import DataFreshness from "./DataFreshness";

/**
 * Thin Server Component wrapper around NavBar (the actual client-side
 * nav bar, moved here from what used to be Nav.tsx -- see NavBar.tsx).
 * Exists so DataFreshness (async, queries Postgres directly, must be a
 * Server Component) can compose with NavBar (Client Component, needs
 * useState/useEffect for the auth dropdown and mobile menu) without
 * violating the Next.js rule that a Server Component can't be directly
 * imported and rendered from inside a "use client" file.
 *
 * showFreshness, added 2026-08-29: the freshness badge only makes
 * sense on pages actually showing pipeline-derived data (the
 * leaderboard, a trader's page) -- it read as out-of-place chrome on
 * Methodology/Contact/Login/etc, which show nothing "fresh" at all.
 * Defaults to false (opt-in) rather than true (opt-out) so a new page
 * that imports Nav the plain `<Nav />` way -- the common case -- does
 * NOT show it by default, and doesn't pay for the underlying
 * getLastRefresh() Supabase query either, unlike before when every
 * single page incurred it unconditionally.
 */
export default function Nav({ showFreshness = false }: { showFreshness?: boolean } = {}) {
  return <NavBar freshness={showFreshness ? <DataFreshness /> : null} />;
}
