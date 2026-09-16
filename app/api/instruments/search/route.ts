import { apiError, requireUser } from "@/lib/server/auth";
import { searchNaverInstruments, type Market } from "@/lib/server/market-data";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "instrument_search", 120, 60_000, user.id);
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").normalize("NFKC").trim();
    const market = url.searchParams.get("market") as Market | null;
    if (query.length < 1 || query.length > 40) return Response.json({ instruments: [] });
    if (market && !["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "지원하지 않는 시장입니다." }, { status: 400 });

    if (market) {
      const result = await searchNaverInstruments(query, market);
      return Response.json({ instruments: result.instruments, source: "NAVER", stale: result.stale }, { headers: { "cache-control": "private, max-age=15" } });
    }

    const results = await Promise.all([
      searchNaverInstruments(query, "KR"),
      searchNaverInstruments(query, "US"),
      searchNaverInstruments(query, "CRYPTO"),
    ]);
    const unique = new Map<string, (typeof results)[number]["instruments"][number]>();
    for (const result of results) for (const item of result.instruments) unique.set(`${item.market}:${item.symbol}`, item);
    return Response.json(
      { instruments: [...unique.values()].slice(0, 20), source: "NAVER", stale: results.some(result => result.stale) },
      { headers: { "cache-control": "private, max-age=15" } },
    );
  } catch (error) {
    if (isNaverStockUnavailable(error)) {
      return Response.json({ instruments: [], error: "네이버증권 종목 검색을 불러오지 못했습니다.", source: "NAVER" }, { status: 503, headers: { "retry-after": "30" } });
    }
    return apiError(error);
  }
}
