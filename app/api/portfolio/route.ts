import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { getTradingQuote } from "@/lib/server/trading-quote";

type StalePositionQuote = {
  id: string;
  market: Market;
  symbol: string;
  exchange: string;
  receivedAt: number;
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
    if (instrument.market === "KR" && quote.venue) {
      await env.DB!.prepare("UPDATE instruments SET exchange=? WHERE id=?").bind(quote.venue, instrument.id).run();
    }
    await persistQuoteSnapshot(quote);
  } catch {
    if (claimed) {
      await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
        .bind(instrument.receivedAt, instrument.id, refreshStartedAt).run().catch(() => undefined);
    }
    // Keep the previous validated valuation when Naver is temporarily unavailable.
  }
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
    ).bind(participantId).all();
    const fills = await env.DB!.prepare(
      `SELECT f.id,f.side,f.quantity_micros AS quantityMicros,f.price_micros AS priceMicros,
              f.fx_rate_micros AS fxRateMicros,
              f.executed_at AS executedAt,i.market,i.symbol,i.name,i.currency
       FROM fills f JOIN instruments i ON i.id=f.instrument_id
       WHERE f.participant_id=? ORDER BY f.executed_at DESC LIMIT 100`
    ).bind(participantId).all();
    const reserved = await env.DB!.prepare(`SELECT COALESCE(SUM((o.quantity_micros/1000000.0)*(o.limit_price_micros/1000000.0)*(COALESCE(q.fx_rate_micros,1000000)/1000000.0)),0) AS reservedCashKrw
      FROM orders o LEFT JOIN quote_snapshots q ON q.instrument_id=o.instrument_id
      WHERE o.participant_id=? AND o.status='pending' AND o.side='buy'`).bind(participantId).first<{reservedCashKrw:number}>();
    const marketValueKrw = positions.results.reduce((sum, row) => sum + Number(row.marketValueKrw ?? 0), 0);
    return Response.json({
      account: { ...account, reservedCashKrw: Number(reserved?.reservedCashKrw ?? 0), availableCashKrw: Math.max(0, Number(account.cashKrw ?? 0) - Number(reserved?.reservedCashKrw ?? 0)), marketValueKrw, totalAssetKrw: Number(account.cashKrw ?? 0) + marketValueKrw },
      positions: positions.results,
      fills: fills.results,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
