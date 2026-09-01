import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";
import { getTraderStats, resolveWallet } from "@/lib/queries";
import { getDisplayName, truncateWallet } from "@/lib/format";
import { scoreTier } from "@/lib/tiers";
import { loadGoogleFont } from "@/lib/og-fonts";

export const alt = "Trader profile on Sirtio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Same freshness window as page.tsx's own `revalidate` -- this image
// hits the exact same Supabase-backed getTraderStats() the page does.
// Link-preview crawlers (Twitter/Discord/Slack/iMessage all eagerly
// fetch OG images) would otherwise mean an uncached Supabase query on
// every single share, which is exactly the per-request egress pattern
// the rest of this pipeline was reworked to avoid.
export const revalidate = 300;

const INK = "#0b1220";
const SURFACE_RAISED = "#16233d";
const HAIRLINE = "#24314a";
const PARCHMENT = "#ede7da";
const MUTED = "#8d9bb8";
const ACCENT = "#e8a33d";

function readLogoDataUri(): string | null {
  try {
    const file = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null;
  }
}

function StatBox({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        backgroundColor: SURFACE_RAISED,
        border: `1px solid ${ACCENT}66`,
        borderRadius: 12,
        padding: "20px 28px",
        flex: 1,
      }}
    >
      <span style={{ fontSize: 20, color: MUTED, textTransform: "uppercase", letterSpacing: 2 }}>
        {label}
      </span>
      {/* Deliberately NOT fontFamily: "Fraunces" here -- confirmed live
          that Satori mis-renders this font file's "+" glyph (a stray
          detached vertical stroke instead of a plus sign) even though
          it renders fine in a real browser and even though plain digits
          render correctly. Satori's default font has no such issue, and
          numeric stat values in a plain sans reads fine for a card like
          this regardless. */}
      <span style={{ fontSize: 44, color: highlight ? ACCENT : PARCHMENT }}>
        {value}
      </span>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet: rawParam } = await params;
  const resolvedWallet = await resolveWallet(decodeURIComponent(rawParam));
  const stats = resolvedWallet ? await getTraderStats(resolvedWallet) : null;
  const logoDataUri = readLogoDataUri();

  const brandHeader = (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {logoDataUri && <img src={logoDataUri} width={40} height={40} alt="" />}
      <span style={{ fontSize: 30, color: PARCHMENT, fontFamily: "Fraunces", fontStyle: "italic" }}>
        Sirtio
      </span>
    </div>
  );

  if (!stats) {
    const font = await loadGoogleFont("Fraunces", 600, "Sirtio Prediction Market Intelligence");
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 24,
            backgroundColor: INK,
          }}
        >
          {brandHeader}
          <span style={{ fontSize: 40, color: MUTED, fontFamily: "Fraunces" }}>
            Prediction Market Intelligence
          </span>
        </div>
      ),
      { ...size, fonts: font ? [{ name: "Fraunces", data: font, weight: 600 as const }] : [] }
    );
  }

  const name = getDisplayName(stats.username, stats.wallet);
  const tier = scoreTier(stats.pm_score);
  const rankText = stats.rank !== null ? `#${stats.rank}` : "--";
  const scoreText = stats.pm_score !== null ? stats.pm_score.toFixed(1) : "--";
  const edgeText =
    stats.avg_edge_pct !== null
      ? `${stats.avg_edge_pct >= 0 ? "+" : ""}${stats.avg_edge_pct.toFixed(0)}%`
      : "--";

  // Only needs to cover what's actually set in fontFamily: "Fraunces"
  // below -- the brand wordmark, tier label, and trader name. Stat
  // values (rankText/scoreText/edgeText) deliberately render in the
  // default font instead; see StatBox's comment for why.
  const fontText = `${name} ${tier ?? ""} Sirtio`;
  const font = await loadGoogleFont("Fraunces", 600, fontText);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: INK,
          // Extra bottom padding vs. the other three sides: link-preview
          // clients (confirmed on X, and other platforms follow the same
          // pattern) overlay their own title/domain caption as a bar
          // pinned to the image's bottom edge. The old uniform 64px
          // padding put this card's own footer row right where that
          // overlay lands, so the two fought over the same pixels -- see
          // the screenshot that prompted this. Real content now clears
          // that zone with room to spare.
          padding: "64px 64px 96px 64px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {brandHeader}
          {tier && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                backgroundColor: SURFACE_RAISED,
                border: `1px solid ${ACCENT}`,
                borderRadius: 10,
                padding: "10px 22px",
              }}
            >
              <span style={{ fontSize: 16, color: MUTED, textTransform: "uppercase", letterSpacing: 2 }}>
                Tier
              </span>
              <span style={{ fontSize: 26, color: ACCENT, fontFamily: "Fraunces", fontWeight: 700 }}>
                {tier}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 68, color: PARCHMENT, fontFamily: "Fraunces", fontWeight: 700 }}>
            {name}
          </span>
          <span style={{ fontSize: 24, color: MUTED, fontFamily: "monospace" }}>
            {truncateWallet(stats.wallet)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          <StatBox label="Rank" value={rankText} />
          <StatBox label="Sirtio Score" value={scoreText} highlight />
          <StatBox label="Avg Edge" value={edgeText} />
          <StatBox label="Positions (90d)" value={String(stats.position_count)} />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${HAIRLINE}`,
            paddingTop: 20,
          }}
        >
          <span style={{ fontSize: 20, color: MUTED }}>
            Is this trader actually good, or did they get lucky?
          </span>
          <span style={{ fontSize: 20, color: ACCENT }}>sirtio.com</span>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Fraunces", data: font, weight: 600 as const }] : [] }
  );
}
