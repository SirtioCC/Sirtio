import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";
import { loadGoogleFont } from "@/lib/og-fonts";

// Root-level opengraph-image.tsx is Next's file convention for a
// default share image -- every route under app/ inherits this unless
// it defines its own (trader/[wallet] does, for a per-trader card; see
// that file). Covers the homepage, /leaderboard, /methodology,
// /contact, etc. No DB access here, so no revalidate/egress concern --
// this is effectively static.
export const alt = "Sirtio: Prediction Market Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0b1220";
const PARCHMENT = "#ede7da";
const MUTED = "#8d9bb8";
const ACCENT = "#e8a33d";

export default async function Image() {
  const text = "Sirtio Prediction Market Intelligence Is this trader actually good, or did they get lucky?";
  const fraunces = await loadGoogleFont("Fraunces", 600, text);

  let logoDataUri: string | null = null;
  try {
    const file = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
    logoDataUri = `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    logoDataUri = null;
  }

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
          gap: 28,
          backgroundColor: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {logoDataUri && <img src={logoDataUri} width={72} height={72} alt="" />}
          <span style={{ fontSize: 84, color: PARCHMENT, fontFamily: "Fraunces", fontWeight: 700 }}>
            Sirtio
          </span>
        </div>
        <span style={{ fontSize: 34, color: ACCENT, fontFamily: "Fraunces" }}>
          Prediction Market Intelligence
        </span>
        <span style={{ fontSize: 26, color: MUTED, maxWidth: 820, textAlign: "center" }}>
          Is this trader actually good, or did they get lucky?
        </span>
      </div>
    ),
    { ...size, fonts: fraunces ? [{ name: "Fraunces", data: fraunces, weight: 600 as const }] : [] }
  );
}
