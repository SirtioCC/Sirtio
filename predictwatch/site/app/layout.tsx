import type { Metadata } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

const SITE_URL = "https://www.sirtio.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Sirtio — Prediction market intelligence",
    template: "%s | Sirtio",
  },
  description:
    "Market data and trader skill scores across Kalshi and Polymarket. Is this trader actually good, or did they get lucky?",
  keywords: [
    "prediction markets",
    "polymarket",
    "kalshi",
    "polymarket trader leaderboard",
    "prediction market analytics",
    "polymarket accuracy",
  ],
  openGraph: {
    type: "website",
    siteName: "Sirtio",
    title: "Sirtio — Prediction market intelligence",
    description:
      "Market data and trader skill scores across Kalshi and Polymarket. Is this trader actually good, or did they get lucky?",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Sirtio — Prediction market intelligence",
    description:
      "Market data and trader skill scores across Kalshi and Polymarket. Is this trader actually good, or did they get lucky?",
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    other: {
      "msvalidate.01": "E6D5210566B297F9E55B2BFBD4171DF2",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Sirtio",
    url: SITE_URL,
    description:
      "Market data and trader skill scores across Kalshi and Polymarket.",
  };

  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
