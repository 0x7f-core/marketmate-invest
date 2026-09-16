import { persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession } from "@/lib/server/market-hours";
import { apiError, requireUser } from "@/lib/server/auth";
import { matchPendingOrders } from "@/lib/server/pending-orders";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { getTradingQuote } from "@/lib/server/trading-quote";
import { enforceRateLimit } from "@/lib/server/safety";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

function isQuoteUnavailable(error: unknown) {
  return isNaverStockUnavailable(error) || (error instanceof Error && ["NAVER_FX_UNAVAILABLE", "NAVER_EMPTY_QUOTE", "NAVER_INVALID_QUOTE", "NAVER_NXT_TIMESTAMP_UNAVAILABLE"].includes(error.message));
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "quotes", 180, 60_000, user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const exchange = url.searchParams.get("exchange") ?? undefined;
    const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).slice(0, 20);
    if (!market || !["KR", "US", "CRYPTO"].includes(market) || symbols.length === 0) {
      return Response.json({ error: "market과 symbols가 필요합니다." }, { status: 400 });
    }

    const normalizedSymbols = [...new Set(symbols.map(symbol => normalizeNaverMarketSymbol(market, symbol)))];
    if (normalizedSymbols.some(symbol => !/^[A-Za-z0-9._-]{1,32}$/.test(symbol))) {
      return Response.json({ error: "종목코드를 확인해주세요." }, { status: 400 });
    }

    const knownSession = market === "KR" ? await getCheckedMarketSession("KR") : undefined;
    const results = await Promise.allSettled(normalizedSymbols.map(symbol =>
      getTradingQuote(market, symbol, normalizedSymbols.length === 1 ? exchange : undefined, knownSession),
    ));
    const resolved = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    const quotes = resolved.filter(quote => !quote.stale);

    if (quotes.length === 0) {
      const rejected = results.find(result => result.status === "rejected");
      if (rejected?.status === "rejected" && !isQuoteUnavailable(rejected.reason)) throw rejected.reason;
      return Response.json(
        { error: resolved.length ? "네이버증권 최신 시세 갱신이 지연되고 있습니다." : "네이버증권 실시간 시세를 불러오지 못했습니다.", source: "NAVER", stale: resolved.length > 0 },
        { status: 503, headers: { "retry-after": "10", "cache-control": "no-store" } },
      );
    }

    await env.DB!.batch(quotes.map(quote => env.DB!.prepare(`INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active)
      VALUES (?,?,?,?,?,?,1) ON CONFLICT(market,symbol) DO UPDATE SET currency=excluded.currency,exchange=excluded.exchange,is_active=1`)
      .bind(`${quote.market}:${quote.symbol}`, quote.market, quote.symbol, quote.symbol, quote.currency, quote.venue ?? exchange ?? quote.market)));
    await Promise.allSettled(quotes.map(persistQuoteSnapshot));
    await Promise.allSettled(quotes.map(matchPendingOrders));
    return Response.json(
      { quotes, partial: quotes.length !== normalizedSymbols.length, staleOmitted: resolved.length !== quotes.length, source: "NAVER" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (isQuoteUnavailable(error)) {
      return Response.json({ error: "네이버증권 실시간 시세를 불러오지 못했습니다.", source: "NAVER" }, { status: 503, headers: { "retry-after": "30" } });
    }
    return apiError(error);
  }
}
