import { getLastRefresh } from "@/lib/queries";
import DataFreshnessClient from "./DataFreshnessClient";

/**
 * Drop this into Nav (or wherever else should show it) -- it's a
 * self-contained async server component, so it just needs to be
 * rendered, no props required. See DataFreshnessClient.tsx for why
 * the actual formatting happens in a separate client component.
 */
export default async function DataFreshness() {
  const completedAt = await getLastRefresh();
  return <DataFreshnessClient completedAt={completedAt} />;
}
