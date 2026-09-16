import { apiError, requireUser } from "@/lib/server/auth";
import { getMarketOverview } from "@/lib/server/market-data";
import { getNaverUsdKrwRate } from "@/lib/server/naver-fx";
import { enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "market_overview", 60, 60_000, user.id);
    const [resolved, fx] = await Promise.all([
      getMarketOverview(),
      getNaverUsdKrwRate().catch(() => null),
    ]);
    if (fx) {
      resolved.push({
        id: "USDKRW",
        name: "원/달러 환율",
        market: "US",
        price: fx.rate,
        change: fx.change,
        rate: fx.changeRate,
        unit: "원",
        source: "NAVER",
        timestamp: fx.fetchedAt,
        stale: fx.stale,
      });
    }
    const quotes = resolved.filter(quote => !quote.stale);
    const intervals = quotes
      .map(quote => Number(quote.pollingInterval))
      .filter(interval => Number.isFinite(interval) && interval > 0);
    const pollingInterval = Math.max(2_000, Math.min(120_000, intervals.length ? Math.min(...intervals) : 10_000));
    return Response.json(
      { quotes, pollingInterval, partial: quotes.length !== resolved.length, staleOmitted: resolved.length !== quotes.length, timestamp: Date.now() },
      { headers: { "cache-control": "private, max-age=2" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
