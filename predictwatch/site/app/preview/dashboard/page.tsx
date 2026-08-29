import Link from "next/link";
import NavBar from "@/components/NavBar";
import { scoreTier } from "@/lib/tiers";

/**
 * Design preview only -- NOT linked from anywhere in the real site and
 * NOT wired to Supabase (no DATABASE_URL import), so it runs with zero
 * setup beyond `npm run dev`. Every number below is SAMPLE DATA for
 * visual review, not a live query. Delete this route (or leave it
 * un-linked) once the direction is decided; nothing else in the app
 * references it.
 *
 * Real trader names/scores below (danielwolfmorales, bigspending,
 * crckr, vito3corleone, etc.) are wallets that were actually top-ranked
 * on 2026-08-29 -- kept for continuity with earlier review, but the
 * position/edge/win-split numbers next to them are illustrative, not
 * pulled from a query.
 */

type SampleTrader = {
  rank: number;
  prevRank: number;
  name: string;
  positions: number;
  avgEdge: number;
  score: number;
  winPct: number;
};

const SAMPLE_TRADERS: SampleTrader[] = [
  { rank: 1, prevRank: 1, name: "danielwolfmorales", positions: 118, avgEdge: 38, score: 95.6, winPct: 82 },
  { rank: 2, prevRank: 3, name: "0x6982…da165", positions: 64, avgEdge: 31, score: 88.7, winPct: 76 },
  { rank: 3, prevRank: 2, name: "bigspending", positions: 201, avgEdge: 22, score: 87.5, winPct: 70 },
  { rank: 4, prevRank: 4, name: "0xf3ce…ca57a", positions: 40, avgEdge: 45, score: 86.5, winPct: 88 },
  { rank: 5, prevRank: 6, name: "theowalcott", positions: 52, avgEdge: 18, score: 79.6, winPct: 65 },
  { rank: 6, prevRank: 6, name: "AGUGava", positions: 33, avgEdge: 17, score: 79.1, winPct: 63 },
  { rank: 7, prevRank: 7, name: "crckr", positions: 44, avgEdge: 19, score: 78.6, winPct: 61 },
];

const SAMPLE_TAIL: SampleTrader = {
  rank: 28, prevRank: 30, name: "vito3corleone", positions: 37, avgEdge: 14, score: 62.9, winPct: 54,
};

const SAMPLE_RISING = [
  { rank: 28, name: "vito3corleone", delta: 2.2 },
  { rank: 41, name: "Gooooooollllllllll", delta: 0.8 },
  { rank: 61, name: "tsihkodiives", delta: 0.7 },
  { rank: 84, name: "UpTheBlues", delta: 0.6 },
];

function tierBadgeClasses(score: number): string {
  const tier = scoreTier(score);
  if (tier === "Elite" || tier === "Great") return "bg-signal-yes/15 text-signal-yes";
  if (tier === "Good") return "bg-accent/15 text-accent";
  if (tier === "Break even") return "bg-hairline text-muted";
  return "bg-signal-no/15 text-signal-no";
}

function TraderRow({ t }: { t: SampleTrader }) {
  const delta = t.prevRank - t.rank; // positive = moved up (lower rank number is better)
  return (
    <div className="grid grid-cols-[32px_1fr_90px_90px_140px_90px] items-center gap-3 py-3 border-b border-hairline text-sm">
      <span className="font-mono text-xs text-muted">{t.rank}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-6 h-6 rounded-full shrink-0 bg-gradient-to-br from-accent to-signal-yes" />
        <span className="text-parchment truncate">{t.name}</span>
        {delta !== 0 && (
          <span className={`font-mono text-[10px] shrink-0 ${delta > 0 ? "text-signal-yes" : "text-signal-no"}`}>
            {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}
          </span>
        )}
      </span>
      <span className="font-mono text-xs text-right text-body">{t.positions}</span>
      <span className="font-mono text-xs text-right text-signal-yes">+{t.avgEdge}%</span>
      <span className="flex items-center h-2 rounded overflow-hidden bg-hairline">
        <span className="h-full bg-signal-yes" style={{ width: `${t.winPct}%` }} />
        <span className="h-full bg-signal-no" style={{ width: `${100 - t.winPct}%` }} />
      </span>
      <span className="text-right">
        <span className={`font-mono text-xs font-semibold px-2.5 py-1 rounded-full ${tierBadgeClasses(t.score)}`}>
          {t.score.toFixed(1)}
        </span>
      </span>
    </div>
  );
}

export default function DashboardPreview() {
  return (
    <div className="min-h-screen">
      <div className="bg-accent/10 border-b border-accent/30 text-center py-2">
        <p className="font-mono text-xs text-accent">
          Design preview &mdash; sample data, not connected to Supabase. Not linked from the live site.
        </p>
      </div>

      <NavBar />

      {/* Rising ticker -- horizontal, real Sirtio tokens, styled after
          the top-of-page ticker pattern on competitor dashboards, but
          using data Sirtio actually has (day-over-day score deltas)
          rather than a market-volume ticker Sirtio doesn't track. */}
      <div className="border-b border-hairline bg-surface">
        <div className="max-w-6xl mx-auto px-6 h-10 flex items-center gap-6 overflow-hidden">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-signal-yes/10 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-signal-yes" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-signal-yes">Rising today</span>
          </span>
          <div className="flex gap-6 font-mono text-xs text-body whitespace-nowrap">
            {SAMPLE_RISING.map((r) => (
              <span key={r.rank}>
                #{r.rank} {r.name} <span className="text-signal-yes">&#9650;{r.delta}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <section className="max-w-6xl mx-auto px-6 pt-10 pb-6">
        <h1 className="font-[family-name:var(--font-title)] font-bold text-2xl text-parchment">
          Prediction Market Intelligence
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Skill-adjusted trader scores, position history, and leaderboards for Polymarket.
        </p>
      </section>

      {/* Stat cards */}
      <section className="max-w-6xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface-raised border border-hairline rounded-lg p-4">
          <p className="text-xs text-muted mb-2">Scores refreshed today</p>
          <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">140</p>
        </div>
        <div className="bg-surface-raised border border-hairline rounded-lg p-4">
          <p className="text-xs text-muted mb-2">Positions analyzed</p>
          <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">41,200</p>
        </div>
        <div className="bg-surface-raised border border-hairline rounded-lg p-4">
          <p className="text-xs text-muted mb-2">Traders watched</p>
          <p className="font-[family-name:var(--font-display)] text-2xl text-parchment">2,740</p>
        </div>
      </section>

      {/* Leaderboard table */}
      <section className="max-w-6xl mx-auto px-6 pt-10 pb-20">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-parchment mb-1">
          Top Performing Traders
        </h2>
        <p className="text-sm text-muted mb-6">Ranked by Sirtio Score &mdash; skill-adjusted, not raw dollars.</p>

        <div className="grid grid-cols-[32px_1fr_90px_90px_140px_90px] gap-3 pb-2 border-b border-hairline font-mono text-[10px] uppercase tracking-wide text-muted">
          <span>#</span>
          <span>Trader</span>
          <span className="text-right">Positions</span>
          <span className="text-right">Avg Edge</span>
          <span>Win / Loss split</span>
          <span className="text-right">Sirtio Score</span>
        </div>

        {SAMPLE_TRADERS.map((t) => (
          <TraderRow key={t.rank} t={t} />
        ))}

        <div className="text-center py-3 font-mono text-xs text-muted">&#8942; 20 more traders &#8942;</div>

        <TraderRow t={SAMPLE_TAIL} />

        <p className="mt-6 text-xs text-muted/70">
          <Link href="/leaderboard" className="text-accent hover:underline">
            See the real leaderboard &rarr;
          </Link>{" "}
          for live data. This page is a static visual reference only.
        </p>
      </section>
    </div>
  );
}
