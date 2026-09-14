import { apiError, requireUser } from "@/lib/server/auth";
import { getMarketOverview } from "@/lib/server/market-data";
import { enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "market_overview", 60, 60_000, user.id);
    const quotes = await getMarketOverview();
    return Response.json({ quotes, timestamp: Date.now() }, { headers: { "cache-control": "private, max-age=2" } });
  } catch (error) {
    return apiError(error);
  }
}
