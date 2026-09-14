import { getLiveQuote, persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { apiError, requireUser } from "@/lib/server/auth";
import { matchPendingOrders } from "@/lib/server/pending-orders";
import { enforceRateLimit } from "@/lib/server/safety";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

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
    const results = await Promise.allSettled(symbols.map(symbol => getLiveQuote(market, symbol.toUpperCase(), symbols.length === 1 ? exchange : undefined)));
    const quotes = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (quotes.length === 0) return Response.json({ error: "실시간 시세를 불러오지 못했습니다." }, { status: 503 });
    await env.DB!.batch(quotes.map(quote => env.DB!.prepare(`INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active)
      VALUES (?,?,?,?,?,?,1) ON CONFLICT(market,symbol) DO UPDATE SET currency=excluded.currency,exchange=excluded.exchange,is_active=1`)
      .bind(`${quote.market}:${quote.symbol}`, quote.market, quote.symbol, quote.symbol, quote.currency, exchange ?? quote.market)));
    await Promise.allSettled(quotes.map(persistQuoteSnapshot));
    await Promise.allSettled(quotes.map(matchPendingOrders));
    return Response.json({ quotes, partial: quotes.length !== symbols.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
