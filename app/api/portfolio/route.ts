import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const participantId = new URL(request.url).searchParams.get("participantId");
    if (!participantId) return Response.json({ error: "participantId가 필요합니다." }, { status: 400 });
    const account = await env.DB!.prepare("SELECT cash_krw AS cashKrw,realized_pnl_krw AS realizedPnlKrw FROM participants WHERE id=? AND user_id=?").bind(participantId, user.id).first();
    if (!account) throw new Error("FORBIDDEN");
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
    });
  } catch (error) { return apiError(error); }
}
