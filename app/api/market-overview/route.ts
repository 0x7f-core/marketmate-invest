import { apiError, requireUser } from "@/lib/server/auth";
import { getMarketOverview } from "@/lib/server/market-data";
import { enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "market_overview", 60, 60_000, user.id);
    const resolved = await getMarketOverview();
    const quotes = resolved.filter(quote => !quote.stale);
    return Response.json(
      { quotes, partial: quotes.length !== resolved.length, staleOmitted: resolved.length !== quotes.length, timestamp: Date.now() },
      { headers: { "cache-control": "private, max-age=2" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
