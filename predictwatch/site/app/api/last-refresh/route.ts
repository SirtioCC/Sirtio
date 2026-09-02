import { getLastRefresh } from "@/lib/queries";

// Route Handlers query the DB directly, so they're not cached by
// default (unlike page.tsx's revalidate=300 above it) -- exactly why
// this exists. The freshness badge used to be baked into each page's
// own ISR snapshot via a server-rendered prop, so its value was only as
// fresh as the last time THAT SPECIFIC route happened to regenerate --
// a page nobody's visited in the last hour keeps serving an
// hour-old "last refreshed" value even though the underlying
// pipeline_runs row has moved on, while a frequently-hit page (e.g. a
// trader page getting crawled for its OG image) looks fresher, purely
// from traffic differences between routes rather than anything actually
// different about the data. Fetching this from an uncached endpoint
// client-side (see DataFreshnessClient.tsx) decouples the badge from
// whichever stale-while-revalidate snapshot of the surrounding page
// happened to be served.
export async function GET() {
  const completedAt = await getLastRefresh();
  return Response.json({ completedAt });
}
