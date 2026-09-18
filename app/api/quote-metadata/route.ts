import { apiError, requireUser } from "@/lib/server/auth";
import { get52WeekDateMetadata, type Market } from "@/lib/server/market-data";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";

export const dynamic = "force-dynamic";

const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const rawSymbol = url.searchParams.get("symbol") ?? "";
    const exchange = url.searchParams.get("exchange") ?? undefined;

    if (
      !market
      || !["KR", "US", "CRYPTO"].includes(market)
      || !rawSymbol
      || rawSymbol.length > 32
      || (exchange !== undefined && !EXCHANGE.test(exchange))
    ) {
      return Response.json({ error: "52주 시세 요청값을 확인해주세요." }, { status: 400 });
    }

    const symbol = normalizeNaverMarketSymbol(market, rawSymbol);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) {
      return Response.json({ error: "종목코드를 확인해주세요." }, { status: 400 });
    }

    const metadata = await get52WeekDateMetadata(market, symbol, exchange);
    return Response.json(
      { ...metadata, source: "NAVER" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
