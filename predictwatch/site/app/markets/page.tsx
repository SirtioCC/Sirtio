import Nav from "@/components/Nav";
import ProbabilityBar from "@/components/ProbabilityBar";
import { getTopMarkets } from "@/lib/queries";
import { marketSourceUrl } from "@/lib/format";

export const metadata = {
  title: "Markets",
  description:
    "The highest-volume prediction markets across Kalshi and Polymarket, ranked side by side.",
};

function formatVolume(v: number | null) {
  if (!v) return "$0";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default async function MarketsPage() {
  const markets = await getTopMarkets(100);

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-parchment mb-2">
          Markets
        </h1>
        <p className="text-muted mb-10">
          Ranked by volume, across Kalshi and Polymarket.
        </p>

        {markets.length === 0 ? (
          <p className="text-muted">
            No markets yet — run the pipeline to populate data.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_200px_90px] gap-6 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
              <span>Market</span>
              <span></span>
              <span className="text-right">Yes price</span>
            </div>
            {markets.map((m) => (
              <div
                key={`${m.source}-${m.external_id}`}
                className="grid grid-cols-[1fr_200px_90px] items-center gap-6 py-4 border-b border-hairline"
              >
                <div>
                  <p className="text-parchment">{m.title}</p>
                  <p className="text-xs text-muted mt-1 uppercase tracking-wide">
                    {m.source} · {formatVolume(m.volume)} vol
                    {m.category ? ` · ${m.category}` : ""}
                    {marketSourceUrl(m.source, m.external_id, m.slug, m.title) && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={marketSourceUrl(m.source, m.external_id, m.slug, m.title)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline normal-case tracking-normal"
                        >
                          {m.source === "kalshi" ? "Search on Kalshi" : "View market"}
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <ProbabilityBar yesPriceCents={m.yes_price_cents} hidePrice />
                <span className="font-mono text-sm tabular-nums text-parchment text-right">
                  {m.yes_price_cents !== null ? `${Math.min(100, Math.max(0, m.yes_price_cents)).toFixed(0)}¢` : "--"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
