import Nav from "@/components/Nav";
import { getAccuracyStats } from "@/lib/queries";

export default async function AccuracyPage() {
  const stats = await getAccuracyStats();

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-parchment mb-2">
          Market accuracy
        </h1>
        <p className="text-muted mb-2">
          Kalshi and Polymarket, compared -- how well does each platform's
          pricing actually predict outcomes?
        </p>
        <p className="text-xs text-muted mb-10">
          "Correct" means the favored side (whichever side was priced
          above 50c right before resolution) actually won. This is a
          measure of the market itself, not any individual trader.
        </p>

        {stats.total_resolved === 0 ? (
          <p className="text-muted">
            No resolved markets yet -- check back once the pipeline has
            captured some settlements.
          </p>
        ) : (
          <>
            <div className="border border-hairline rounded-lg p-8 mb-12 text-center">
              <p className="text-xs uppercase tracking-wide text-muted mb-2">
                Overall accuracy
              </p>
              <p className="font-[family-name:var(--font-display)] text-6xl text-signal-yes">
                {(stats.overall_accuracy * 100).toFixed(1)}%
              </p>
              <p className="text-sm text-muted mt-2">
                across {stats.total_resolved.toLocaleString()} resolved markets
              </p>
            </div>

            <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-6">
              By platform
            </h2>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              {stats.by_platform.map((p) => (
                <div key={p.source} className="border border-hairline rounded-lg p-6">
                  <p className="text-xs uppercase tracking-wide text-muted mb-2">
                    {p.source}
                  </p>
                  <p className="font-[family-name:var(--font-display)] text-3xl text-parchment">
                    {(p.accuracy * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {p.count.toLocaleString()} resolved markets
                  </p>
                </div>
              ))}
            </div>
            {stats.by_platform.some((p) => p.count < 100) && (
              <p className="text-xs text-muted -mt-8 mb-12">
                Note: a platform with under 100 resolved markets has a
                thin sample -- treat that percentage as early, not final.
              </p>
            )}

            <h2 className="font-[family-name:var(--font-display)] text-2xl text-parchment mb-2">
              Calibration
            </h2>
            <p className="text-sm text-muted mb-6">
              For a genuinely well-calibrated market, a market priced at
              70c should resolve "yes" about 70% of the time -- not more,
              not less. The closer "actual" tracks "predicted" below, the
              better calibrated that price range is.
            </p>
            <div>
              <div className="grid grid-cols-4 gap-4 pb-3 border-b border-hairline text-xs uppercase tracking-wide text-muted">
                <span>Price range</span>
                <span className="text-right">Predicted yes rate</span>
                <span className="text-right">Actual yes rate</span>
                <span className="text-right">Sample size</span>
              </div>
              {stats.by_bucket.map((b) => (
                <div key={b.bucket}
                  className="grid grid-cols-4 gap-4 items-center py-3 border-b border-hairline"
                >
                  <span className="font-mono text-sm text-parchment">{b.bucket}c</span>
                  <span className="font-mono text-sm text-muted text-right">
                    {(b.predicted_yes_rate * 100).toFixed(0)}%
                  </span>
                  <span className="font-mono text-sm text-signal-yes text-right">
                    {(b.actual_yes_rate * 100).toFixed(0)}%
                  </span>
                  <span className="font-mono text-sm text-muted text-right">{b.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
