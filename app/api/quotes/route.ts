import { env } from "cloudflare:workers";
import { getLiveQuote, type Market } from "@/lib/server/market-data";
import { apiError, requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser(request);
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
    const receivedAt = Date.now();
    await env.DB!.batch(quotes.map(quote => {
      const instrumentId = `${quote.market}:${quote.symbol}`;
      const fxRateMicros = Math.round(quote.exchangeRate * 1_000_000);
      return env.DB!.prepare(
        `INSERT INTO quote_snapshots (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
         SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM instruments WHERE id=?)
         ON CONFLICT(instrument_id) DO UPDATE SET price_micros=excluded.price_micros,change_micros=excluded.change_micros,
           change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros,source=excluded.source,
           source_timestamp=excluded.source_timestamp,received_at=excluded.received_at`,
      ).bind(
        instrumentId,
        Math.round(quote.price * quote.exchangeRate * 1_000_000),
        Math.round(quote.change * quote.exchangeRate * 1_000_000),
        Math.round(quote.changeRate * 10_000),
        fxRateMicros,
        quote.source,
        quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1000 : quote.timestamp,
        receivedAt,
        instrumentId,
      );
    }));
    return Response.json({ quotes, partial: quotes.length !== symbols.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
