import { type DomesticTradingVenue, type Market } from "@/lib/server/market-data";
import { apiError, requireUser } from "@/lib/server/auth";
import { getDomesticListingMarket, normalizeDomesticListingMarket } from "@/lib/server/domestic-listing-market";
import { matchPendingOrders } from "@/lib/server/pending-orders";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { getTradingQuote, type TradingQuote } from "@/lib/server/trading-quote";
import { getUsListingExchange } from "@/lib/server/us-listing-exchange";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;

function isQuoteUnavailable(error: unknown) {
  return isNaverStockUnavailable(error) || (error instanceof Error && ["NAVER_FX_UNAVAILABLE", "NAVER_EMPTY_QUOTE", "NAVER_INVALID_QUOTE", "NAVER_NXT_TIMESTAMP_UNAVAILABLE", "NAVER_NXT_UNAVAILABLE"].includes(error.message));
}

function persistenceStatements(quote: TradingQuote, requestedExchange?: string) {
  const instrumentId = `${quote.market}:${quote.symbol}`;
  const domesticListing = quote.market === "KR" ? normalizeDomesticListingMarket(requestedExchange) : "";
  const resolvedExchange = quote.venue
    ?? requestedExchange
    ?? (quote.market === "CRYPTO" ? "UPBIT" : quote.market);
  const persistedExchange = quote.market === "KR" ? domesticListing || "KRX" : resolvedExchange;
  const sourceTimestamp = quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1_000 : quote.timestamp;
  const receivedAt = Date.now();
  const priceKrwMicros = Math.round(quote.price * quote.exchangeRate * 1_000_000);
  const fxRateMicros = Math.round(quote.exchangeRate * 1_000_000);
  const recordedAt = Math.floor(sourceTimestamp / 60_000) * 60_000;

  return [
    env.DB!.prepare(`INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active)
      VALUES (?,?,?,?,?,?,1) ON CONFLICT(market,symbol) DO UPDATE SET currency=excluded.currency,
      exchange=CASE
        WHEN instruments.market='KR' AND instruments.exchange IN ('KOSPI','KOSDAQ','KONEX') AND excluded.exchange IN ('KRX','NXT') THEN instruments.exchange
        WHEN excluded.exchange IN ('KOSPI','KOSDAQ','KONEX','KRX','NXT','NAS','NYS','AMS','ARCA','CBOE','OTC','NAVER','UPBIT') THEN excluded.exchange
        ELSE instruments.exchange END,
      is_active=1`)
      .bind(instrumentId, quote.market, quote.symbol, quote.symbol, quote.currency, persistedExchange),
    env.DB!.prepare(`INSERT INTO quote_snapshots (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(instrument_id) DO UPDATE SET price_micros=excluded.price_micros,change_micros=excluded.change_micros,
      change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros,source=excluded.source,
      source_timestamp=excluded.source_timestamp,received_at=excluded.received_at`)
      .bind(instrumentId, priceKrwMicros, Math.round(quote.change * quote.exchangeRate * 1_000_000), Math.round(quote.changeRate * 10_000), fxRateMicros, quote.source, sourceTimestamp, receivedAt),
    env.DB!.prepare(`INSERT INTO price_history (id,instrument_id,price_micros,change_rate_ppm,fx_rate_micros,recorded_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(instrument_id,recorded_at) DO UPDATE SET price_micros=excluded.price_micros,change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros`)
      .bind(`${instrumentId}:${recordedAt}`, instrumentId, priceKrwMicros, Math.round(quote.changeRate * 10_000), fxRateMicros, recordedAt),
  ];
}

export async function GET(request: Request) {
  try {
    // Keep authentication, but do not hit the D1-backed generic rate limiter on
    // every 1-5 second quote poll. Input is bounded below and Naver calls are
    // deduplicated/cached by the market-data layer.
    await requireUser(request);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const exchange = url.searchParams.get("exchange") ?? undefined;
    const rawVenue = url.searchParams.get("venue")?.toUpperCase();
    const requestedVenue = rawVenue === "KRX" || rawVenue === "NXT" ? rawVenue as DomesticTradingVenue : undefined;
    const symbolsRaw = url.searchParams.get("symbols") ?? "";
    if (
      symbolsRaw.length > 700
      || (exchange !== undefined && !EXCHANGE.test(exchange))
      || (rawVenue !== undefined && !requestedVenue)
      || (requestedVenue && market !== "KR")
    ) {
      return Response.json({ error: "시세 요청값을 확인해주세요." }, { status: 400 });
    }
    const symbols = symbolsRaw.split(",").filter(Boolean).slice(0, 20);
    if (!market || !["KR", "US", "CRYPTO"].includes(market) || symbols.length === 0) {
      return Response.json({ error: "market과 symbols가 필요합니다." }, { status: 400 });
    }

    const normalizedSymbols = [...new Set(symbols.map(symbol => normalizeNaverMarketSymbol(market, symbol)))];
    if (normalizedSymbols.some(symbol => !/^[A-Za-z0-9._-]{1,32}$/.test(symbol))) {
      return Response.json({ error: "종목코드를 확인해주세요." }, { status: 400 });
    }

    const results = await Promise.allSettled(normalizedSymbols.map(async symbol => {
      const symbolExchange = normalizedSymbols.length === 1 ? exchange : undefined;
      const resolvedExchange = market === "US"
        ? await getUsListingExchange(symbol, symbolExchange) || symbolExchange
        : symbolExchange;
      const venue = normalizedSymbols.length === 1 ? requestedVenue : undefined;
      try {
        return await getTradingQuote(market, symbol, resolvedExchange, undefined, venue);
      } catch (error) {
        if (market === "KR" && venue === "NXT" && error instanceof Error && error.message === "NAVER_NXT_UNAVAILABLE") {
          return getTradingQuote(market, symbol, resolvedExchange, undefined, "KRX");
        }
        throw error;
      }
    }));
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

    const requestedExchange = normalizedSymbols.length === 1 ? exchange : undefined;
    const domesticListings = new Map<string, string>();
    const usListings = new Map<string, string>();
    if (market === "KR") {
      await Promise.all(quotes.map(async quote => {
        const listing = await getDomesticListingMarket(quote.symbol, requestedExchange);
        if (listing) domesticListings.set(quote.symbol, listing);
      }));
    } else if (market === "US") {
      await Promise.all(quotes.map(async quote => {
        const listing = await getUsListingExchange(quote.symbol, requestedExchange);
        if (listing) usListings.set(quote.symbol, listing);
      }));
    }

    const writes = quotes.flatMap(quote => persistenceStatements(
      quote,
      quote.market === "KR"
        ? domesticListings.get(quote.symbol) || requestedExchange
        : quote.market === "US"
          ? usListings.get(quote.symbol) || requestedExchange
          : requestedExchange,
    ));
    if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
      writes.push(env.DB!.prepare("DELETE FROM price_history WHERE recorded_at<?").bind(Date.now() - 400 * 86_400_000));
    }
    await env.DB!.batch(writes);

    // Limit-order matching remains synchronous so a displayed executable quote can
    // immediately fill eligible simulated orders, but the common no-order path is
    // now only one lightweight indexed D1 existence check.
    await Promise.allSettled(quotes.map(matchPendingOrders));

    const clientQuotes = quotes.map(quote => {
      if (quote.market === "KR") {
        const listing = domesticListings.get(quote.symbol);
        const { venue: tradingVenue, ...rest } = quote;
        return listing ? { ...rest, venue: listing, tradingVenue } : { ...rest, tradingVenue };
      }
      if (quote.market === "US") {
        const listing = usListings.get(quote.symbol);
        return listing ? { ...quote, venue: listing } : quote;
      }
      return quote;
    });

    return Response.json(
      { quotes: clientQuotes, partial: quotes.length !== normalizedSymbols.length, staleOmitted: resolved.length !== quotes.length, source: "NAVER" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (isQuoteUnavailable(error)) {
      return Response.json({ error: "네이버증권 실시간 시세를 불러오지 못했습니다.", source: "NAVER" }, { status: 503, headers: { "retry-after": "30", "cache-control": "no-store" } });
    }
    return apiError(error);
  }
}
