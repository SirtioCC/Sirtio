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
const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: false });

export default sql;
