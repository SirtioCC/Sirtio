import postgres from "postgres";

// Reuses the exact same DATABASE_URL as the Python pipeline — one
// Supabase database, read by both. No separate Supabase client/RLS
// setup needed since we connect straight to Postgres.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to site/.env.local — same connection " +
      "string used by the pipeline (Transaction pooler URI from Supabase)."
  );
}

// max needs to comfortably cover the query concurrency of a single page
// render, not just overall traffic -- root-caused 2026-08-27 by reading
// postgres.js's own dispatch logic (index.js's handler()): once every
// pooled connection is busy, a new query is NOT queued to wait its turn,
// it's immediately pipelined onto one of the already-busy connections
// (`busy.length ? go(busy.shift(), query) : queries.push(query)` --
// queries.push only runs if there's no connection at all). Pipelining
// multiple statements onto one client-side connection is incompatible
// with Supabase's Transaction-mode pooler, which can hand different
// statements on that same "connection" to different backend Postgres
// processes -- exactly what produced the wedged connections below. The
// trader page alone fires 4 concurrent queries via Promise.all
// (getTraderStats/getTraderPositions/getScoreTierCutoffs/
// getPositionsTrackingStart) plus a 5th from Nav's DataFreshness
// (getLastRefresh, an independent async Server Component) -- 5 queries
// against the old max: 3 guaranteed at least 2 of them pipelined on
// every single trader page render, which is exactly why it was always
// the same query (getPositionsTrackingStart) that wedged. 10 covers
// that peak per-request concurrency with headroom for a couple of
// concurrent visitors before pipelining kicks in again; Supabase's
// pooler comfortably supports far more client connections than this on
// any tier.
//
// prepare: false is required against Supabase's Transaction pooler --
// PgBouncer in transaction mode hands out a different backend connection
// per transaction, so a prepared statement created on one backend can be
// gone by the time postgres.js re-executes it, surfacing as
// 'prepared statement "..." does not exist' at runtime.
//
// prepare: false alone stopped that specific error, but a pooled
// connection can still wedge mid-query for other reasons (a dropped
// packet, the pooler recycling the backend under it, etc.) -- confirmed
// live 2026-08-27 via pg_stat_activity: two connections sat "active" on
// a trivial indexed SELECT for 4+ minutes, orphaned server-side even
// after the client that issued the query had already given up. postgres.js
// only arms idle_timeout on connections sitting unused in the pool
// (index.js's move() only starts it when a connection reaches the open/
// idle queue), so it never fires on a connection stuck mid-query -- that
// needed max_lifetime instead, which force-closes a connection on a flat
// wall-clock timer regardless of busy/idle state and properly rejects
// any in-flight query with CONNECTION_DESTROYED (see connection.js's
// terminate()) rather than leaving it hanging. Without this, one wedged
// connection in a 3-connection pool eventually wedges all 3, and every
// request queues behind it until Vercel's 300s function cap kills it --
// exactly the failure mode observed. 60s caps the worst case at roughly
// 60s-plus-a-retry instead of a 5-minute hang; idle_timeout/connect_timeout
// are shortened too so a bad connection doesn't sit around or block new
// ones for as long by default.
const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60,
});

export default sql;
