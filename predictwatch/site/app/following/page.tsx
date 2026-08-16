import Link from "next/link";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase/server";
import { getFollowedTraders } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Traders I'm Following",
  description: "Traders you follow on Sirtio, all in one place.",
};

export default async function FollowingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="min-h-screen">
        <Nav />
        <section className="max-w-3xl mx-auto px-6 py-20 text-center">
          <p className="font-[family-name:var(--font-display)] text-3xl text-parchment mb-4">
            Log in to see who you follow
          </p>
          <Link href="/login" className="text-accent hover:underline">
            Log in --&gt;
          </Link>
        </section>
      </div>
    );
  }

  const { data: follows } = await supabase
    .from("follows")
    .select("wallet")
    .eq("user_id", user.id);

  const wallets = (follows ?? []).map((f: { wallet: string }) => f.wallet);
  const traders = await getFollowedTraders(wallets);

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h1 className="font-[family-name:var(--font-title)] font-bold text-4xl text-parchment mb-2">
          Traders I'm Following
        </h1>
        <p className="text-muted mb-10">
          Traders you're following, so you never lose track of them.
        </p>

        {traders.length === 0 ? (
          <p className="text-muted">
            You're not following any traders yet. Visit a{" "}
            <Link href="/leaderboard" className="text-accent hover:underline">
              trader's page
            </Link>{" "}
            and click Follow.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_60px_90px] sm:grid-cols-[1fr_130px_150px_140px] gap-3 sm:gap-6 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
              <span>Trader</span>
              <span className="hidden sm:block text-center">Current Leaderboard Rank</span>
              <span className="sm:hidden text-center">Rank</span>
              <span className="text-center">Sirtio Score</span>
              <span className="hidden sm:block text-center">Resolved Bets (Last 90D)</span>
            </div>
            {traders.map((t) => (
              <div key={t.wallet}
                className="grid grid-cols-[1fr_60px_90px] sm:grid-cols-[1fr_130px_150px_140px] items-center gap-3 sm:gap-6 py-4 border-b border-hairline"
              >
                <Link href={`/trader/${t.wallet}`}
                  className="text-parchment hover:text-accent transition-colors"
                >
                  {t.username || `${t.wallet.slice(0, 8)}...${t.wallet.slice(-6)}`}
                </Link>
                <span className="font-mono text-sm text-muted text-center">
                  {t.rank !== null ? `#${t.rank}` : "--"}
                </span>
                <span className="font-mono text-sm text-signal-yes text-center">
                  {t.pm_score !== null ? t.pm_score.toFixed(1) : "--"}
                </span>
                <span className="hidden sm:block font-mono text-sm text-muted text-center">
                  {t.position_count}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
