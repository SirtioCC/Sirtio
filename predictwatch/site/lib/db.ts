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

// A couple of connections is plenty for a low-traffic site talking to
// Supabase's pooler; keeps this safe to import in multiple route files
// without exhausting the pool.
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
  max: 3,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60,
});

export default sql;
