import { apiError, requireUser } from "@/lib/server/auth";
import { getNaverMarketNews } from "@/lib/server/market-news";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { enforceRateLimit } from "@/lib/server/safety";

const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;

type Market = "KR" | "US" | "CRYPTO";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "news", 40, 5 * 60_000, user.id);
    const url = new URL(request.url);
    const market = (url.searchParams.get("market") ?? "KR") as Market;
    const rawSymbol = (url.searchParams.get("symbol") ?? "").trim();
    const name = (url.searchParams.get("name") ?? "").normalize("NFKC").trim();
    const exchange = (url.searchParams.get("exchange") ?? "").trim();

    if (!["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "시장을 확인해주세요." }, { status: 400 });
    if (rawSymbol.length > 32 || name.length > 80 || (exchange && !EXCHANGE.test(exchange))) {
      return Response.json({ error: "뉴스 요청값을 확인해주세요." }, { status: 400 });
    }

    const symbol = rawSymbol ? normalizeNaverMarketSymbol(market, rawSymbol) : "";
    if (symbol && !/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) return Response.json({ error: "종목코드를 확인해주세요." }, { status: 400 });

    const result = await getNaverMarketNews(market, symbol, name, exchange);
    return Response.json(
      { items: result.items, source: "NAVER", stale: result.stale },
      { headers: { "cache-control": "private, max-age=60" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
