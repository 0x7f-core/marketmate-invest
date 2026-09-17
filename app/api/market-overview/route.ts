import { getMarketOverview } from "@/lib/server/market-data";
import { getNaverUsdKrwRate } from "@/lib/server/naver-fx";

export async function GET() {
  try {
    // Market overview is public read-only data. Do not gate it behind the user
    // session/rate-limit tables: that added several D1 round trips to the hottest
    // polling path before any market data could be returned.
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
      {
        headers: {
          // The browser polling loop still decides freshness from pollingInterval.
          // A tiny shared cache lets concurrent page loads reuse the same response
          // without creating a visible stale-data window.
          "cache-control": "public, max-age=1, s-maxage=2, stale-while-revalidate=2",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "시장 지표를 불러오지 못했습니다." },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }
}
