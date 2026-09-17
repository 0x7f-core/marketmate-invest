import { getNaverMarketNews } from "@/lib/server/market-news";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";

const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;

type Market = "KR" | "US" | "CRYPTO";

export async function GET(request: Request) {
  try {
    // News is public read-only market data. Avoid user-session and D1 rate-limit
    // lookups on page load; getNaverMarketNews already applies upstream timeout,
    // deduplication and bounded caching.
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
    const items = [...result.items].sort((a, b) => {
      if (a.publishedAt === b.publishedAt) return 0;
      return (b.publishedAt || 0) - (a.publishedAt || 0);
    });
    return Response.json(
      { items, source: "NAVER", stale: result.stale },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate",
          pragma: "no-cache",
          expires: "0",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "뉴스를 불러오지 못했습니다." },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "10" } },
    );
  }
}
