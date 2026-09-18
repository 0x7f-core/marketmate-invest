import { getPopularStocks, type PopularStockMarket } from "@/lib/server/market-rankings";

const MARKETS = ["KR", "US"] as const;

export async function GET() {
  const settled = await Promise.allSettled(MARKETS.map(market => getPopularStocks(market)));

  const payload: Partial<Record<PopularStockMarket, Awaited<ReturnType<typeof getPopularStocks>>>> = {};
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === "fulfilled") payload[MARKETS[index]] = result.value;
  }

  if (!payload.KR && !payload.US) {
    return Response.json(
      { error: "인기 종목을 불러오지 못했습니다." },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }

  const pollingInterval = Math.min(
    payload.KR?.pollingInterval ?? Number.POSITIVE_INFINITY,
    payload.US?.pollingInterval ?? Number.POSITIVE_INFINITY,
  );

  return Response.json({
    domestic: payload.KR?.items ?? [],
    us: payload.US?.items ?? [],
    source: "NAVER",
    fetchedAt: Math.max(payload.KR?.fetchedAt ?? 0, payload.US?.fetchedAt ?? 0),
    stale: Boolean(payload.KR?.stale || payload.US?.stale),
    pollingInterval: Number.isFinite(pollingInterval) ? pollingInterval : 30_000,
  }, {
    headers: {
      "cache-control": "public, max-age=5, s-maxage=20, stale-while-revalidate=60",
    },
  });
}
