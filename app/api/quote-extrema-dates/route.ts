import { apiError, requireUser } from "@/lib/server/auth";
import { type Market } from "@/lib/server/market-data";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { getQuoteExtremaDates } from "@/lib/server/quote-extrema";

export const dynamic = "force-dynamic";

const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const rawSymbol = url.searchParams.get("symbol") ?? "";
    const exchange = url.searchParams.get("exchange") ?? undefined;
    const high52Week = Number(url.searchParams.get("high"));
    const low52Week = Number(url.searchParams.get("low"));

    if (
      !market
      || !["KR", "US", "CRYPTO"].includes(market)
      || rawSymbol.length > 32
      || !rawSymbol
      || (exchange !== undefined && !EXCHANGE.test(exchange))
      || !Number.isFinite(high52Week)
      || high52Week <= 0
      || !Number.isFinite(low52Week)
      || low52Week <= 0
    ) {
      return Response.json({ error: "52주 시세 요청값을 확인해주세요." }, { status: 400 });
    }

    const symbol = normalizeNaverMarketSymbol(market, rawSymbol);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) {
      return Response.json({ error: "종목코드를 확인해주세요." }, { status: 400 });
    }

    const dates = await getQuoteExtremaDates({
      market,
      symbol,
      exchange,
      high52Week,
      low52Week,
    });

    return Response.json(
      { ...dates, source: "NAVER" },
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (error) {
    if (isNaverStockUnavailable(error)) {
      return Response.json(
        { error: "네이버증권 52주 고저가 날짜를 불러오지 못했습니다.", source: "NAVER" },
        { status: 503, headers: { "retry-after": "60", "cache-control": "no-store" } },
      );
    }
    return apiError(error);
  }
}
