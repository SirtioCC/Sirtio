import type { Metadata } from "next";
import { Fraunces, Inter, IBM_Plex_Mono, Raleway } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-title",
  weight: ["500", "600", "700"],
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
  alternates: {
    canonical: "/",
  },
  title: {
    default: "Sirtio: Prediction Market Intelligence",
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
    title: "Sirtio: Prediction Market Intelligence",
    description:
      "Market data and trader skill scores across Kalshi and Polymarket. Is this trader actually good, or did they get lucky?",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Sirtio: Prediction Market Intelligence",
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
        className={`${fraunces.variable} ${raleway.variable} ${inter.variable} ${plexMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
