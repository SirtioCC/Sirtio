import { MetadataRoute } from "next";
import { getLeaderboard } from "@/lib/queries";

const SITE_URL = "https://www.sirtio.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/methodology`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/contact`, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Every currently-scored trader gets their own indexable page -- this
  // is the real long-tail SEO opportunity (individual trader names +
  // "polymarket"), not just the handful of static pages above.
  let traderPages: MetadataRoute.Sitemap = [];
  try {
    const traders = await getLeaderboard(100);
    traderPages = traders
      .filter((t) => t.pm_score !== null)
      .map((t) => ({
        url: `${SITE_URL}/trader/${t.wallet}`,
        changeFrequency: "daily" as const,
        priority: 0.5,
      }));
  } catch {
    // If the DB is briefly unreachable at build/request time, still
    // serve a valid sitemap with just the static pages rather than a
    // hard failure -- crawlers pick up trader pages again next fetch.
  }

  return [...staticPages, ...traderPages];
}
