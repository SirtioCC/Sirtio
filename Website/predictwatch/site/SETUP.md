# Running the PredictWatch site locally

## 1. Install dependencies
From inside this `site` folder:
```
npm install
```

## 2. Connect it to your database
Copy the example env file:
```
copy .env.local.example .env.local
```
(Mac/Linux: `cp .env.local.example .env.local`)

Open `.env.local` and paste in the **same Supabase connection string**
you've already been using for the Python pipeline — the Transaction
pooler URI. Same database, both the pipeline and the site read from it.

## 3. Run it
```
npm run dev
```
Open http://localhost:3000 in your browser.

You should see real data: the top markets by volume on the homepage
and `/markets`, and the trader leaderboard with PM Scores on
`/leaderboard`. If a page says "no data yet," double check your
`.env.local` has the right connection string and that the pipeline
has actually run at least once.

## About the PM Score shown here
This is the v0 formula from the main README — win rate, average edge,
and consistency, damped by how many resolved positions back it up. It
is **not validated yet** — treat the numbers as directional, not
precise, until there's been real backtesting against a larger set of
resolved markets.

## Deploying (when you're ready)
The easiest path is Vercel's free tier (built by the same people as
Next.js, zero-config for this kind of app):
1. Push this repo to GitHub (already done, if you followed the
   pipeline setup).
2. Go to vercel.com, sign in with GitHub, "Import Project," select
   this repo.
3. **Important:** set the root directory to `site` in Vercel's
   project settings (not the repo root), since this Next.js app lives
   in a subfolder alongside the Python pipeline.
4. Add `DATABASE_URL` as an environment variable in Vercel's project
   settings — same value as your local `.env.local`.
5. Deploy. Vercel rebuilds automatically on every future `git push`.
