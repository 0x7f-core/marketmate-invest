import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { getLiveQuote, type Market } from "@/lib/server/market-data";

type OrderBody = {
  participantId?: string; clientOrderId?: string; market?: Market; symbol?: string;
  name?: string; exchange?: string; side?: "buy" | "sell"; orderType?: "market";
  quantity?: number;
};

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const body = await request.json() as OrderBody;
    if (!body.participantId || !body.clientOrderId || !body.market || !body.symbol || !body.name ||
        !["KR", "US", "CRYPTO"].includes(body.market) || !["buy", "sell"].includes(body.side ?? "") ||
        body.orderType !== "market" || !Number.isFinite(body.quantity) || Number(body.quantity) <= 0 || Number(body.quantity) > 1_000_000) {
      return Response.json({ error: "주문값을 확인해주세요." }, { status: 400 });
    }
    const participant = await env.DB!.prepare(
      `SELECT p.id,p.cash_krw AS cashKrw,c.status,c.starts_at AS startsAt,c.ends_at AS endsAt
       FROM participants p JOIN competitions c ON c.id=p.competition_id
       WHERE p.id=? AND p.user_id=?`
    ).bind(body.participantId, user.id).first<{id:string;cashKrw:number;status:string;startsAt:number;endsAt:number}>();
    if (!participant) throw new Error("FORBIDDEN");
    const duplicate = await env.DB!.prepare(
      "SELECT id,status,filled_quantity_micros AS filledQuantityMicros,updated_at AS updatedAt FROM orders WHERE participant_id=? AND client_order_id=?"
    ).bind(body.participantId, body.clientOrderId).first();
    if (duplicate) return Response.json({ order: duplicate, duplicate: true });
    const now = Date.now();
    if (participant.status !== "active" || now < participant.startsAt || now > participant.endsAt) {
      return Response.json({ error: "현재 주문 가능한 대회가 아닙니다." }, { status: 409 });
    }
    const quote = await getLiveQuote(body.market, body.symbol.toUpperCase());
    const sourceTime = quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1000 : quote.timestamp;
    if (Math.abs(now - sourceTime) > 60_000) return Response.json({ error: "시세가 지연되어 주문을 중단했습니다." }, { status: 503 });
    const fxRate = quote.exchangeRate;
    if (!Number.isFinite(fxRate) || fxRate <= 0) return Response.json({ error: "한국투자증권 환율을 확인할 수 없어 미국주식 주문을 중단했습니다." }, { status: 503 });

    const quantityMicros = Math.round(Number(body.quantity) * 1_000_000);
    const nativePriceMicros = Math.round(quote.price * 1_000_000);
    const fxRateMicros = Math.round(fxRate * 1_000_000);
    const priceKrwMicros = Math.round(quote.price * fxRate * 1_000_000);
    const tradeValueKrw = Number((BigInt(quantityMicros) * BigInt(priceKrwMicros) + 500_000_000_000n) / 1_000_000_000_000n);
    if (tradeValueKrw <= 0 || quantityMicros <= 0) return Response.json({ error: "최소 주문금액을 확인해주세요." }, { status: 400 });

    const instrumentId = `${body.market}:${body.symbol.toUpperCase()}`;
    const orderId = crypto.randomUUID();
    const fillId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    const isBuy = body.side === "buy";
    const position = await env.DB!.prepare(
      "SELECT quantity_micros AS quantityMicros,average_price_micros AS averagePriceMicros,realized_pnl_krw AS realizedPnlKrw FROM positions WHERE participant_id=? AND instrument_id=?"
    ).bind(body.participantId, instrumentId).first<{quantityMicros:number;averagePriceMicros:number;realizedPnlKrw:number}>();
    if (!isBuy && (!position || position.quantityMicros < quantityMicros)) return Response.json({ error: "보유수량이 부족합니다." }, { status: 409 });
    if (isBuy && participant.cashKrw < tradeValueKrw) return Response.json({ error: "주문 가능 금액이 부족합니다." }, { status: 409 });

    await env.DB!.prepare(
      "INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active) VALUES (?,?,?,?,?,?,1) ON CONFLICT(market,symbol) DO UPDATE SET name=excluded.name,exchange=excluded.exchange,is_active=1"
    ).bind(instrumentId, body.market, body.symbol.toUpperCase(), body.name.slice(0, 80), quote.currency, body.exchange ?? body.market).run();

    const expectedCash = participant.cashKrw;
    const nextCash = isBuy ? expectedCash - tradeValueKrw : expectedCash + tradeValueKrw;
    const oldQty = position?.quantityMicros ?? 0;
    const oldAvg = position?.averagePriceMicros ?? 0;
    const nextQty = isBuy ? oldQty + quantityMicros : oldQty - quantityMicros;
    const nextAvg = isBuy
      ? Number((BigInt(oldQty) * BigInt(oldAvg) + BigInt(quantityMicros) * BigInt(priceKrwMicros)) / BigInt(oldQty + quantityMicros))
      : (nextQty === 0 ? 0 : oldAvg);
    const realized = !isBuy
      ? Number((BigInt(quantityMicros) * BigInt(priceKrwMicros - oldAvg)) / 1_000_000_000_000n)
      : 0;
    const ledgerAmount = isBuy ? -tradeValueKrw : tradeValueKrw;

    const statements = [
      env.DB!.prepare("UPDATE participants SET cash_krw=?,realized_pnl_krw=realized_pnl_krw+? WHERE id=? AND cash_krw=?").bind(nextCash, realized, body.participantId, expectedCash),
      env.DB!.prepare(`INSERT INTO orders (id,client_order_id,participant_id,instrument_id,side,order_type,quantity_micros,limit_price_micros,filled_quantity_micros,status,rejection_reason,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0`).bind(orderId, body.clientOrderId, body.participantId, instrumentId, body.side, "market", quantityMicros, null, quantityMicros, "filled", null, now, now),
      env.DB!.prepare(`INSERT INTO fills (id,order_id,participant_id,instrument_id,side,quantity_micros,price_micros,fx_rate_micros,fee_krw,executed_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)`).bind(fillId, orderId, body.participantId, instrumentId, body.side, quantityMicros, nativePriceMicros, fxRateMicros, 0, now, orderId),
      env.DB!.prepare(`INSERT INTO positions (id,participant_id,instrument_id,quantity_micros,average_price_micros,realized_pnl_krw,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)
        ON CONFLICT(participant_id,instrument_id) DO UPDATE SET quantity_micros=excluded.quantity_micros,average_price_micros=excluded.average_price_micros,realized_pnl_krw=positions.realized_pnl_krw+?,updated_at=excluded.updated_at`).bind(positionId, body.participantId, instrumentId, nextQty, nextAvg, realized, now, fillId, realized),
      env.DB!.prepare(`INSERT INTO cash_ledger (id,participant_id,type,amount_krw,reference_id,balance_after_krw,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)`).bind(crypto.randomUUID(), body.participantId, body.side, ledgerAmount, fillId, nextCash, now, fillId),
      env.DB!.prepare(`INSERT INTO quote_snapshots (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)
        ON CONFLICT(instrument_id) DO UPDATE SET price_micros=excluded.price_micros,change_micros=excluded.change_micros,change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros,source=excluded.source,source_timestamp=excluded.source_timestamp,received_at=excluded.received_at`)
        .bind(instrumentId, priceKrwMicros, Math.round(quote.change * fxRate * 1_000_000), Math.round(quote.changeRate * 10_000), fxRateMicros, quote.source, sourceTime, now, fillId),
    ];
    const result = await env.DB!.batch(statements);
    if ((result[0].meta.changes ?? 0) !== 1) return Response.json({ error: "자산이 변경되어 주문을 다시 확인해주세요." }, { status: 409 });
    return Response.json({ order: { id: orderId, status: "filled", side: body.side, quantity: body.quantity, price: quote.price, currency: quote.currency, exchangeRate: fxRate, valueKrw: tradeValueKrw, executedAt: now } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && ["KIS_NOT_CONFIGURED", "KIS_AUTH_FAILED", "KIS_AUTH_BUSY", "KIS_QUOTE_FAILED", "UPBIT_QUOTE_FAILED"].includes(error.message)) {
      return Response.json({ error: "실시간 시세 제공자에 연결할 수 없어 주문을 중단했습니다." }, { status: 503 });
    }
    return apiError(error);
  }
}
