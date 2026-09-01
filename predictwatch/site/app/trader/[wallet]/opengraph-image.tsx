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

// next/og's ImageResponse has no bundled fallback typeface -- confirmed
// live: with zero fonts registered it throws "No fonts are loaded"
// outright, and with only Fraunces registered, EVERY span pulls glyphs
// from that same Fraunces file regardless of its own fontFamily value,
// including a value Satori has no font registered under (e.g. a generic
// "sans-serif" that was never actually loaded) -- there's nothing else
// for it to fall back to. Since the Fraunces file is subsetted to just
// the brand wordmark/tier/trader-name text (loadGoogleFont's `text`
// param), any other span whose own text happens to share letters with
// that subset (near-guaranteed for ordinary English words -- "Elite"
// and "Sirtio" alone cover e/l/i/t/s/r/o) rendered with those specific
// letters in serif Fraunces and the rest in some renderer-internal
// fallback glyph -- a mixed-font word, confirmed by zooming into a
// rendered card. The actual fix is to register real fonts under real
// names for every other style of text this card uses, and reference
// those names explicitly -- not to name a family that isn't backed by
// anything in `fonts`, which does nothing (verified: identical output
// with and without it).
const INTER = "Inter";
const MONO = "IBM Plex Mono";

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
      {/* fontFamily: INTER explicit on both spans -- see the note by
          the INTER/MONO constants at the top of this file for why
          leaving it unset (or naming an unregistered family) isn't
          safe here. */}
      <span style={{ fontSize: 18, color: MUTED, textTransform: "uppercase", letterSpacing: 1, fontFamily: INTER }}>
        {label}
      </span>
      {/* Also deliberately not Fraunces -- confirmed live that Satori
          mis-renders this font file's "+" glyph (a stray detached
          vertical stroke instead of a plus sign) even though it
          renders fine in a real browser and even though plain digits
          render correctly. */}
      <span style={{ fontSize: 44, color: highlight ? ACCENT : PARCHMENT, fontFamily: INTER }}>
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

  // getDisplayName falls back to the truncated wallet itself when a
  // trader has no username -- true for most tracked wallets. Rendering
  // that fallback in 68px decorative Fraunces (meant for an actual
  // human name) reads as a garbled hex string wearing a font it was
  // never designed for, and it duplicated the exact same address on
  // the monospace line right below it. A wallet-address name instead
  // gets the same plain monospace treatment as the rest of the site
  // (see the trader page's own CopyableWallet, the leaderboard rows),
  // just larger, and only once.
  const isWalletFallback = name === truncateWallet(stats.wallet);

  // Only needs to cover what's actually set to fontFamily: "Fraunces"
  // below -- the brand wordmark, the tier value (e.g. "Elite"), and a
  // real trader name (skipped when it's just the wallet fallback, which
  // renders in MONO instead -- see isWalletFallback above).
  const fontText = `${isWalletFallback ? "" : name} ${tier ?? ""} Sirtio`;
  const font = await loadGoogleFont("Fraunces", 600, fontText);

  // Unlike Fraunces, these two aren't subsetted to specific per-request
  // text -- everything they render (stat labels/values, the footer
  // tagline, "sirtio.com", and the wallet-address text) is either fully
  // static across every card or drawn from a small fixed digit/symbol
  // alphabet, so there's no real payload cost to just requesting the
  // full charset, and it means nobody has to remember to extend a
  // subset string the next time a label changes.
  const interFont = await loadGoogleFont("Inter", 500);
  const monoFont = await loadGoogleFont("IBM Plex Mono", 500);
  const cardFonts = [
    ...(font ? [{ name: "Fraunces", data: font, weight: 600 as const }] : []),
    ...(interFont ? [{ name: INTER, data: interFont, weight: 500 as const }] : []),
    ...(monoFont ? [{ name: MONO, data: monoFont, weight: 500 as const }] : []),
  ];

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
              <span style={{ fontSize: 16, color: MUTED, textTransform: "uppercase", letterSpacing: 2, fontFamily: INTER }}>
                Tier
              </span>
              <span style={{ fontSize: 26, color: ACCENT, fontFamily: "Fraunces", fontWeight: 700 }}>
                {tier}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {isWalletFallback ? (
            <span style={{ fontSize: 56, color: PARCHMENT, fontFamily: MONO, fontWeight: 700 }}>
              {name}
            </span>
          ) : (
            // An explicit wrapping div, not a <>...</> Fragment -- confirmed
            // live that Satori doesn't stack a Fragment's children inside a
            // column-flex parent the way a real DOM node's children would
            // (the two spans rendered side by side instead of stacked). A
            // genuine flex container sidesteps that entirely.
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 68, color: PARCHMENT, fontFamily: "Fraunces", fontWeight: 700 }}>
                {name}
              </span>
              <span style={{ fontSize: 24, color: MUTED, fontFamily: MONO }}>
                {truncateWallet(stats.wallet)}
              </span>
            </div>
          )}
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
          <span style={{ fontSize: 20, color: MUTED, fontFamily: INTER }}>
            Is this trader actually good, or did they get lucky?
          </span>
          <span style={{ fontSize: 20, color: ACCENT, fontFamily: INTER }}>sirtio.com</span>
        </div>
      </div>
    ),
    { ...size, fonts: cardFonts }
  );
}
