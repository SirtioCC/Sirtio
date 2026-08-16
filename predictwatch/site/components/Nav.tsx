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
 * Every page keeps doing exactly what it already did --
 * `import Nav from "@/components/Nav"` and `<Nav />` -- and
 * transparently gets the freshness badge with zero page-level changes,
 * now and for any future page that imports Nav this same way.
 */
export default function Nav() {
  return <NavBar freshness={<DataFreshness />} />;
}
