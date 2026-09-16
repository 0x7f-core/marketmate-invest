import { apiError, requireUser } from "@/lib/server/auth";
import { getChartSeries, type Market } from "@/lib/server/market-data";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { enforceRateLimit } from "@/lib/server/safety";

const RANGES = new Set(["1D", "1W", "1M", "3M", "1Y"]);

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "chart", 90, 60_000, user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const rawSymbol = url.searchParams.get("symbol") ?? "";
    const exchange = url.searchParams.get("exchange") ?? undefined;
    const range = url.searchParams.get("range") ?? "3M";
    if (!market || !["KR", "US", "CRYPTO"].includes(market)) {
      return Response.json({ error: "차트 요청값을 확인해주세요." }, { status: 400 });
    }
    const symbol = normalizeNaverMarketSymbol(market, rawSymbol);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol) || !RANGES.has(range)) {
      return Response.json({ error: "차트 요청값을 확인해주세요." }, { status: 400 });
    }
    const result = await getChartSeries(market, symbol, exchange, range);
    if (!result.points.length) {
      return Response.json({ ...result, error: "네이버증권에서 차트 데이터를 받지 못했습니다." }, { status: 503, headers: { "retry-after": "30" } });
    }
    return Response.json(result, { headers: { "cache-control": "private, max-age=30" } });
  } catch (error) {
    if (isNaverStockUnavailable(error)) {
      return Response.json({ points: [], source: "NAVER", error: "네이버증권 차트 API를 불러오지 못했습니다." }, { status: 503, headers: { "retry-after": "30" } });
    }
    return apiError(error);
  }
}
