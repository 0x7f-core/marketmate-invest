import { apiError, requireUser } from "@/lib/server/auth";
import { isChartPeriod, legacyRangeToChartPeriod, type ChartPeriod } from "@/lib/server/chart-period";
import { getDomesticChartSeries } from "@/lib/server/domestic-chart";
import { getMarketChartSeries } from "@/lib/server/market-chart";
import { getChartSeries, getTrackedMarketIndexChartSeries, isTrackedMarketIndexId, type Market } from "@/lib/server/market-data";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { enforceRateLimit } from "@/lib/server/safety";

const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "chart", 90, 60_000, user.id);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "instrument";
    const market = url.searchParams.get("market") as Market | null;
    const rawSymbol = url.searchParams.get("symbol") ?? "";
    const exchange = url.searchParams.get("exchange") ?? undefined;
    const requestedPeriod = url.searchParams.get("period");
    const periodValue = requestedPeriod ?? legacyRangeToChartPeriod(url.searchParams.get("range")) ?? "DAY";
    if (!isChartPeriod(periodValue)) {
      return Response.json({ error: "차트 기간을 확인해주세요." }, { status: 400 });
    }
    const period = periodValue as ChartPeriod;
    if (kind === "index") {
      const id = (url.searchParams.get("id") ?? "").toUpperCase();
      if (!isTrackedMarketIndexId(id)) {
        return Response.json({ error: "지수 차트 요청값을 확인해주세요." }, { status: 400 });
      }
      const result = await getTrackedMarketIndexChartSeries(id, period);
      if (!result.points.length) {
        return Response.json({ ...result, error: "네이버증권에서 지수 차트 데이터를 받지 못했습니다." }, { status: 503, headers: { "retry-after": "15" } });
      }
      return Response.json(result, { headers: { "cache-control": "private, max-age=30" } });
    }
    if (kind !== "instrument" || !market || !["KR", "US", "CRYPTO"].includes(market)) {
      return Response.json({ error: "차트 요청값을 확인해주세요." }, { status: 400 });
    }
    const symbol = normalizeNaverMarketSymbol(market, rawSymbol);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol) || (exchange !== undefined && !EXCHANGE.test(exchange))) {
      return Response.json({ error: "차트 요청값을 확인해주세요." }, { status: 400 });
    }
    const result = market === "US"
      ? await getMarketChartSeries(market, symbol, exchange, period)
      : market === "KR"
        ? await getDomesticChartSeries(symbol, period)
        : await getChartSeries(market, symbol, exchange, period);
    if (!result.points.length) {
      return Response.json({ ...result, error: "네이버증권에서 차트 데이터를 받지 못했습니다." }, { status: 503, headers: { "retry-after": "15" } });
    }
    return Response.json(result, { headers: { "cache-control": "private, max-age=30" } });
  } catch (error) {
    if (isNaverStockUnavailable(error)) {
      return Response.json({ points: [], source: "NAVER", error: "네이버증권 차트 API를 불러오지 못했습니다." }, { status: 503, headers: { "retry-after": "15" } });
    }
    return apiError(error);
  }
}
