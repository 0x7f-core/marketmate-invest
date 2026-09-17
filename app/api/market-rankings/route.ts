import { getMarketRanking, type RankingMarket } from "@/lib/server/market-rankings";

const MARKET_SET = new Set<RankingMarket>(["KR", "US", "CRYPTO"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawMarket = (url.searchParams.get("market") ?? "KR").toUpperCase();
  const market = MARKET_SET.has(rawMarket as RankingMarket) ? rawMarket as RankingMarket : "KR";
  const category = url.searchParams.get("category") ?? "tradingValue";

  try {
    const result = await getMarketRanking(market, category);
    return Response.json(result, {
      headers: {
        "cache-control": "public, max-age=5, s-maxage=12, stale-while-revalidate=30",
      },
    });
  } catch {
    return Response.json(
      { error: "실시간 랭킹을 불러오지 못했습니다." },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }
}
