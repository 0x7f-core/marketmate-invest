import { env } from "cloudflare:workers";
import { canonicalCryptoDisplayName, normalizeCryptoNamedItem } from "@/lib/crypto-display-name";
import { apiError, requireUser } from "@/lib/server/auth";
import { getDomesticListingMarket } from "@/lib/server/domestic-listing-market";
import { isSupportedUsSymbolInput, normalizeSupportedExchange } from "@/lib/server/instrument-policy";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";
import { type Market } from "@/lib/server/market-data";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { getTradingQuote, type TradingQuote } from "@/lib/server/trading-quote";
import { getUsListingExchange, normalizeUsListingExchange } from "@/lib/server/us-listing-exchange";

const watchlistSql = `SELECT w.id,i.market,i.symbol,i.name,i.exchange,i.currency,
  q.price_micros AS priceKrwMicros,q.change_rate_ppm AS changeRatePpm,q.fx_rate_micros AS fxRateMicros,q.received_at AS receivedAt
  FROM watchlist_items w JOIN instruments i ON i.id=w.instrument_id LEFT JOIN quote_snapshots q ON q.instrument_id=i.id
  WHERE w.user_id=? AND i.is_active=1 ORDER BY w.sort_order,w.created_at LIMIT 50`;

type WatchlistRow = {
  id: string;
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
  currency: "KRW" | "USD";
  priceKrwMicros?: number | null;
  changeRatePpm?: number | null;
  fxRateMicros?: number | null;
  receivedAt?: number | null;
};

type RefreshedWatchlistQuote = { watchlistId: string; quote: TradingQuote; receivedAt: number };

function snapshotStatement(item: RefreshedWatchlistQuote) {
  const { quote, receivedAt } = item;
  const instrumentId = `${quote.market}:${quote.symbol}`;
  const sourceTimestamp = quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1_000 : quote.timestamp;
  return env.DB!.prepare(`INSERT INTO quote_snapshots
    (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(instrument_id) DO UPDATE SET
      price_micros=excluded.price_micros,
      change_micros=excluded.change_micros,
      change_rate_ppm=excluded.change_rate_ppm,
      fx_rate_micros=excluded.fx_rate_micros,
      source=excluded.source,
      source_timestamp=excluded.source_timestamp,
      received_at=excluded.received_at`)
    .bind(
      instrumentId,
      Math.round(quote.price * quote.exchangeRate * 1_000_000),
      Math.round(quote.change * quote.exchangeRate * 1_000_000),
      Math.round(quote.changeRate * 10_000),
      Math.round(quote.exchangeRate * 1_000_000),
      quote.source,
      sourceTimestamp,
      receivedAt,
    );
}

async function repairListingExchanges(items: WatchlistRow[]) {
  const repaired = await Promise.all(items.map(async item => {
    if (item.market === "KR") {
      const listing = await getDomesticListingMarket(item.symbol, item.exchange);
      return listing ? { ...item, exchange: listing } : item;
    }
    if (item.market === "US") {
      const normalized = normalizeUsListingExchange(item.exchange);
      const listing = normalized || await getUsListingExchange(item.symbol, item.exchange);
      return listing ? { ...item, exchange: listing } : item;
    }
    return item;
  }));
  const changed = repaired.filter((item, index) => item.exchange !== items[index].exchange);
  if (changed.length) {
    await env.DB!.batch(changed.map(item =>
      env.DB!.prepare("UPDATE instruments SET exchange=? WHERE id=?").bind(item.exchange, `${item.market}:${item.symbol}`),
    )).catch(() => undefined);
  }
  return repaired;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "watchlist_read", 20, 60_000, user.id);
    const result = await env.DB!.prepare(watchlistSql).bind(user.id).all<WatchlistRow>();
    const rows = result.results;
    const stale = rows.filter(item => !item.receivedAt || item.receivedAt < Date.now() - 15_000).slice(0, 6);

    if (!stale.length) {
      const items = (await repairListingExchanges(rows)).map(item => normalizeCryptoNamedItem(item));
      return Response.json({ items }, { headers: { "cache-control": "no-store" } });
    }

    const refreshed = await Promise.allSettled(stale.map(async item => {
      const resolvedExchange = item.market === "US"
        ? await getUsListingExchange(item.symbol, item.exchange) || item.exchange
        : item.exchange;
      const quote = await getTradingQuote(item.market, item.symbol, resolvedExchange);
      if (quote.stale) return null;
      return { watchlistId: item.id, quote, receivedAt: Date.now() } satisfies RefreshedWatchlistQuote;
    }));

    const successful = refreshed.flatMap(entry => entry.status === "fulfilled" && entry.value ? [entry.value] : []);
    if (successful.length) {
      await env.DB!.batch(successful.map(snapshotStatement)).catch(() => undefined);
    }

    const latestById = new Map(successful.map(item => [item.watchlistId, item] as const));
    const refreshedItems = rows.map(item => {
      const refreshedItem = latestById.get(item.id);
      if (!refreshedItem) return item;
      const { quote, receivedAt } = refreshedItem;
      return {
        ...item,
        priceKrwMicros: Math.round(quote.price * quote.exchangeRate * 1_000_000),
        changeRatePpm: Math.round(quote.changeRate * 10_000),
        fxRateMicros: Math.round(quote.exchangeRate * 1_000_000),
        receivedAt,
      };
    });
    const items = (await repairListingExchanges(refreshedItems)).map(item => normalizeCryptoNamedItem(item));

    return Response.json({ items }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "watchlist", 40, 60_000, user.id);
    const body = await request.json() as { market?:Market; symbol?:string; name?:string; exchange?:string; currency?:"KRW"|"USD" };
    if (!body.market || !["KR","US","CRYPTO"].includes(body.market) || typeof body.symbol !== "string" || typeof body.name !== "string" || typeof body.exchange !== "string") {
      return Response.json({error:"종목 정보를 확인해주세요."},{status:400});
    }
    const symbol = normalizeNaverMarketSymbol(body.market, body.symbol);
    const name = body.market === "CRYPTO" ? canonicalCryptoDisplayName(symbol, body.name) : body.name.trim().slice(0,80);
    let exchange = normalizeSupportedExchange(body.market, body.exchange);
    const currency = body.market === "US" ? "USD" : "KRW";
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol) || !exchange || !body.name.trim() || (body.market === "US" && !isSupportedUsSymbolInput(symbol))) {
      return Response.json({error:"한국·미국주식과 가상자산만 등록할 수 있습니다."},{status:400});
    }
    if (body.market === "KR") {
      exchange = await getDomesticListingMarket(symbol, exchange) || exchange;
    } else if (body.market === "US") {
      exchange = await getUsListingExchange(symbol, exchange) || exchange;
    }
    const instrumentId = `${body.market}:${symbol}`;
    await env.DB!.batch([
      env.DB!.prepare(`INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active) VALUES (?,?,?,?,?,?,1)
        ON CONFLICT(market,symbol) DO UPDATE SET name=excluded.name,currency=excluded.currency,exchange=excluded.exchange,is_active=1`)
        .bind(instrumentId, body.market, symbol, name, currency, exchange),
      env.DB!.prepare(`INSERT INTO watchlist_items (id,user_id,instrument_id,sort_order,created_at)
        SELECT ?,?,?,COALESCE((SELECT MAX(sort_order)+1 FROM watchlist_items WHERE user_id=?),0),?
        WHERE changes()>0 OR EXISTS(SELECT 1 FROM instruments WHERE id=?) ON CONFLICT(user_id,instrument_id) DO NOTHING`)
        .bind(crypto.randomUUID(), user.id, instrumentId, user.id, Date.now(), instrumentId),
    ]);
    await auditLog(request,"watchlist.added","instrument",instrumentId,user.id,{market:body.market,exchange}).catch(()=>undefined);
    return Response.json({ok:true},{status:201});
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "watchlist", 40, 60_000, user.id);
    const instrumentId = new URL(request.url).searchParams.get("instrumentId");
    if (!instrumentId) return Response.json({error:"instrumentId가 필요합니다."},{status:400});
    await env.DB!.prepare("DELETE FROM watchlist_items WHERE user_id=? AND instrument_id=?").bind(user.id,instrumentId).run();
    await auditLog(request,"watchlist.removed","instrument",instrumentId,user.id).catch(()=>undefined);
    return Response.json({ok:true});
  } catch (error) { return apiError(error); }
}
