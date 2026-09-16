import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";
import { persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { getTradingQuote } from "@/lib/server/trading-quote";

const watchlistSql = `SELECT w.id,i.market,i.symbol,i.name,i.exchange,i.currency,
  q.price_micros AS priceKrwMicros,q.change_rate_ppm AS changeRatePpm,q.fx_rate_micros AS fxRateMicros,q.received_at AS receivedAt
  FROM watchlist_items w JOIN instruments i ON i.id=w.instrument_id LEFT JOIN quote_snapshots q ON q.instrument_id=i.id
  WHERE w.user_id=? ORDER BY w.sort_order,w.created_at LIMIT 50`;

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "watchlist_read", 20, 60_000, user.id);
    const result = await env.DB!.prepare(watchlistSql).bind(user.id).all<{market:Market;symbol:string;exchange:string;receivedAt?:number}>();
    const stale = result.results.filter(item => !item.receivedAt || item.receivedAt < Date.now()-15_000).slice(0,6);
    if (stale.length) {
      await Promise.allSettled(stale.map(item => getTradingQuote(item.market,item.symbol,item.exchange).then(quote => quote.stale ? undefined : persistQuoteSnapshot(quote))));
    }
    const fresh = stale.length ? await env.DB!.prepare(watchlistSql).bind(user.id).all() : result;
    return Response.json({ items:fresh.results }, { headers:{"cache-control":"no-store"} });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "watchlist", 40, 60_000, user.id);
    const body = await request.json() as { market?:Market; symbol?:string; name?:string; exchange?:string; currency?:"KRW"|"USD" };
    if (!body.market || !["KR","US","CRYPTO"].includes(body.market) || !body.symbol || !body.name || !body.exchange || !["KRW","USD"].includes(body.currency ?? "")) return Response.json({error:"종목 정보를 확인해주세요."},{status:400});
    const symbol = normalizeNaverMarketSymbol(body.market, body.symbol);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) return Response.json({error:"종목 정보를 확인해주세요."},{status:400});
    const instrumentId = `${body.market}:${symbol}`;
    await env.DB!.batch([
      env.DB!.prepare(`INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active) VALUES (?,?,?,?,?,?,1)
        ON CONFLICT(market,symbol) DO UPDATE SET name=excluded.name,currency=excluded.currency,exchange=excluded.exchange,is_active=1`)
        .bind(instrumentId, body.market, symbol, body.name.slice(0,80), body.currency, body.exchange),
      env.DB!.prepare(`INSERT INTO watchlist_items (id,user_id,instrument_id,sort_order,created_at)
        SELECT ?,?,?,COALESCE((SELECT MAX(sort_order)+1 FROM watchlist_items WHERE user_id=?),0),?
        WHERE changes()>0 OR EXISTS(SELECT 1 FROM instruments WHERE id=?) ON CONFLICT(user_id,instrument_id) DO NOTHING`)
        .bind(crypto.randomUUID(), user.id, instrumentId, user.id, Date.now(), instrumentId),
    ]);
    await auditLog(request,"watchlist.added","instrument",instrumentId,user.id).catch(()=>undefined);
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
