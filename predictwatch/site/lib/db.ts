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
const sql = postgres(process.env.DATABASE_URL, { max: 3 });

export default sql;
