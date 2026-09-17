import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { getDomesticListingMarket } from "@/lib/server/domestic-listing-market";
import { persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { getTradingQuote } from "@/lib/server/trading-quote";

type StalePositionQuote = {
  id: string;
  market: Market;
  symbol: string;
  exchange: string;
  receivedAt: number;
};

type PositionRow = {
  market: Market;
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  quantityMicros: number;
  averagePriceKrwMicros: number;
  realizedPnlKrw: number;
  currentPriceKrwMicros?: number | null;
  quoteReceivedAt?: number | null;
  marketValueKrw?: number | null;
  unrealizedPnlKrw?: number | null;
};

async function refreshPortfolioQuote(instrument: StalePositionQuote, refreshStartedAt: number) {
  let claimed = false;
  if (instrument.receivedAt > 0) {
    const claim = await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
      .bind(refreshStartedAt, instrument.id, instrument.receivedAt).run();
    if ((claim.meta.changes ?? 0) !== 1) return;
    claimed = true;
  }

  try {
    const quote = await getTradingQuote(instrument.market, instrument.symbol, instrument.exchange);
    if (quote.stale) throw new Error("NAVER_STALE_QUOTE");
    await persistQuoteSnapshot(quote);
  } catch {
    if (claimed) {
      await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
        .bind(instrument.receivedAt, instrument.id, refreshStartedAt).run().catch(() => undefined);
    }
    // Keep the previous validated valuation when Naver is temporarily unavailable.
  }
}

async function repairDomesticListings(items: PositionRow[]) {
  const repaired = await Promise.all(items.map(async item => {
    if (item.market !== "KR") return item;
    const listing = await getDomesticListingMarket(item.symbol, item.exchange);
    return listing ? { ...item, exchange: listing } : item;
  }));
  const changed = repaired.filter((item, index) => item.market === "KR" && item.exchange !== items[index].exchange);
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
    const participantId = new URL(request.url).searchParams.get("participantId");
    if (!participantId) return Response.json({ error: "participantId가 필요합니다." }, { status: 400 });
    const account = await env.DB!.prepare("SELECT cash_krw AS cashKrw,realized_pnl_krw AS realizedPnlKrw FROM participants WHERE id=? AND user_id=?").bind(participantId, user.id).first();
    if (!account) throw new Error("FORBIDDEN");

    const refreshStartedAt = Date.now();
    const staleBefore = refreshStartedAt - 15_000;
    const stale = await env.DB!.prepare(
      `SELECT i.id,i.market,i.symbol,i.exchange,COALESCE(q.received_at,0) AS receivedAt
       FROM positions pos JOIN instruments i ON i.id=pos.instrument_id
       LEFT JOIN quote_snapshots q ON q.instrument_id=i.id
       WHERE pos.participant_id=? AND pos.quantity_micros>0 AND (q.received_at IS NULL OR q.received_at<?)
       ORDER BY COALESCE(q.received_at,0) ASC LIMIT 8`,
    ).bind(participantId, staleBefore).all<StalePositionQuote>();
    await Promise.allSettled(stale.results.map(instrument => refreshPortfolioQuote(instrument, refreshStartedAt)));

    const positions = await env.DB!.prepare(
      `SELECT i.market,i.symbol,i.name,i.currency,i.exchange,pos.quantity_micros AS quantityMicros,
              pos.average_price_micros AS averagePriceKrwMicros,pos.realized_pnl_krw AS realizedPnlKrw,
              q.price_micros AS currentPriceKrwMicros,q.received_at AS quoteReceivedAt,
              (pos.quantity_micros / 1000000.0) * (q.price_micros / 1000000.0) AS marketValueKrw,
              ((pos.quantity_micros / 1000000.0) * ((q.price_micros - pos.average_price_micros) / 1000000.0)) AS unrealizedPnlKrw
       FROM positions pos JOIN instruments i ON i.id=pos.instrument_id
       LEFT JOIN quote_snapshots q ON q.instrument_id=i.id
       WHERE pos.participant_id=? AND pos.quantity_micros>0 ORDER BY i.market,i.name`
    ).bind(participantId).all<PositionRow>();
    const repairedPositions = await repairDomesticListings(positions.results);
    const fills = await env.DB!.prepare(
      `SELECT f.id,f.side,f.quantity_micros AS quantityMicros,f.price_micros AS priceMicros,
              f.fx_rate_micros AS fxRateMicros,f.fee_krw AS feeKrw,
              f.executed_at AS executedAt,i.market,i.symbol,i.name,i.currency
       FROM fills f JOIN instruments i ON i.id=f.instrument_id
       WHERE f.participant_id=? ORDER BY f.executed_at DESC LIMIT 100`
    ).bind(participantId).all();
    const reserved = await env.DB!.prepare(`SELECT COALESCE(SUM(
        (o.quantity_micros/1000000.0)*(o.limit_price_micros/1000000.0)*(COALESCE(q.fx_rate_micros,1000000)/1000000.0) *
        CASE
          WHEN i.market='US' THEN 1.0007
          WHEN i.market='CRYPTO' THEN 1.0005
          WHEN i.market='KR' AND UPPER(i.exchange)='NXT' THEN 1.000145
          ELSE 1.00015
        END
      ),0) AS reservedCashKrw
      FROM orders o JOIN instruments i ON i.id=o.instrument_id
      LEFT JOIN quote_snapshots q ON q.instrument_id=o.instrument_id
      WHERE o.participant_id=? AND o.status='pending' AND o.side='buy'`).bind(participantId).first<{reservedCashKrw:number}>();
    const reservedCashKrw = Math.ceil(Number(reserved?.reservedCashKrw ?? 0));
    const marketValueKrw = repairedPositions.reduce((sum, row) => sum + Number(row.marketValueKrw ?? 0), 0);
    return Response.json({
      account: { ...account, reservedCashKrw, availableCashKrw: Math.max(0, Number(account.cashKrw ?? 0) - reservedCashKrw), marketValueKrw, totalAssetKrw: Number(account.cashKrw ?? 0) + marketValueKrw },
      positions: repairedPositions,
      fills: fills.results,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
