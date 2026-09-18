import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { getDomesticSecurityClassification } from "@/lib/server/domestic-security-type";
import { isSupportedUsSymbolInput, normalizeSupportedExchange } from "@/lib/server/instrument-policy";
import { persistQuoteSnapshot, type DomesticTradingVenue, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession } from "@/lib/server/market-hours";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { normalizeNaverMarketSymbol } from "@/lib/server/naver-symbol";
import { getTradingQuote, isExecutableTradingQuote } from "@/lib/server/trading-quote";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";
import { calculateTradingCosts } from "@/lib/trading-costs";

type OrderBody = {
  participantId?: string; clientOrderId?: string; market?: Market; symbol?: string;
  name?: string; exchange?: string; side?: "buy" | "sell"; orderType?: "market" | "limit";
  quantity?: number; limitPrice?: number; venue?: DomesticTradingVenue;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isQuoteUnavailable(error: unknown) {
  return isNaverStockUnavailable(error) || (error instanceof Error && ["NAVER_FX_UNAVAILABLE", "NAVER_EMPTY_QUOTE", "NAVER_INVALID_QUOTE", "NAVER_NXT_TIMESTAMP_UNAVAILABLE", "NAVER_NXT_UNAVAILABLE"].includes(error.message));
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const participantId = new URL(request.url).searchParams.get("participantId");
    if (!participantId) return Response.json({ error: "participantId가 필요합니다." }, { status: 400 });
    const allowed = await env.DB!.prepare("SELECT 1 FROM participants WHERE id=? AND user_id=?").bind(participantId, user.id).first();
    if (!allowed) throw new Error("FORBIDDEN");
    const result = await env.DB!.prepare(`SELECT o.id,o.side,o.order_type AS orderType,o.quantity_micros AS quantityMicros,
      o.limit_price_micros AS limitPriceMicros,o.filled_quantity_micros AS filledQuantityMicros,o.status,o.rejection_reason AS rejectionReason,
      o.venue,o.created_at AS createdAt,o.updated_at AS updatedAt,i.market,i.symbol,i.name,i.currency
      FROM orders o JOIN instruments i ON i.id=o.instrument_id WHERE o.participant_id=? ORDER BY o.created_at DESC LIMIT 100`).bind(participantId).all();
    return Response.json({ orders: result.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "order_cancel", 30, 60_000, user.id);
    const orderId = new URL(request.url).searchParams.get("orderId");
    if (!orderId) return Response.json({ error: "orderId가 필요합니다." }, { status: 400 });
    const result = await env.DB!.prepare(`UPDATE orders SET status='cancelled',updated_at=? WHERE id=? AND status='pending'
      AND participant_id IN (SELECT id FROM participants WHERE user_id=?)`).bind(Date.now(), orderId, user.id).run();
    if ((result.meta.changes ?? 0) !== 1) return Response.json({ error: "취소할 수 있는 대기 주문이 아닙니다." }, { status: 409 });
    await auditLog(request, "order.cancelled", "order", orderId, user.id).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "order_create", 30, 60_000, user.id);
    const body = await request.json() as OrderBody;
    const participantId = typeof body.participantId === "string" ? body.participantId.trim() : "";
    const clientOrderId = typeof body.clientOrderId === "string" ? body.clientOrderId.trim() : "";
    const rawSymbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    let exchange = typeof body.exchange === "string" ? body.exchange.trim() : body.exchange === undefined ? undefined : "";
    const requestedVenue = body.venue === "KRX" || body.venue === "NXT" ? body.venue : undefined;
    if (!SAFE_ID.test(participantId) || !SAFE_ID.test(clientOrderId) || !body.market || !rawSymbol || !name || name.length > 80 ||
        (exchange !== undefined && (!exchange || exchange.length > 40 || /[\u0000-\u001F\u007F]/.test(exchange))) ||
        (body.venue !== undefined && !requestedVenue) || (requestedVenue && body.market !== "KR") ||
        !["KR", "US", "CRYPTO"].includes(body.market) || !["buy", "sell"].includes(body.side ?? "") ||
        !["market", "limit"].includes(body.orderType ?? "") || !Number.isFinite(body.quantity) || Number(body.quantity) <= 0 || Number(body.quantity) > 1_000_000 ||
        (body.orderType === "limit" && (!Number.isFinite(body.limitPrice) || Number(body.limitPrice) <= 0))) {
      return Response.json({ error: "주문값을 확인해주세요." }, { status: 400 });
    }
    if (exchange !== undefined) {
      exchange = normalizeSupportedExchange(body.market, exchange);
      if (!exchange) return Response.json({ error: "한국·미국주식과 가상자산만 거래할 수 있습니다." }, { status: 400 });
    }
    const symbol = normalizeNaverMarketSymbol(body.market, rawSymbol);
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol) || (body.market === "US" && !isSupportedUsSymbolInput(symbol))) {
      return Response.json({ error: "한국·미국주식과 가상자산만 거래할 수 있습니다." }, { status: 400 });
    }

    const participant = await env.DB!.prepare(
      `SELECT p.id,p.cash_krw AS cashKrw,c.status,c.starts_at AS startsAt,c.ends_at AS endsAt
       FROM participants p JOIN competitions c ON c.id=p.competition_id
       WHERE p.id=? AND p.user_id=?`
    ).bind(participantId, user.id).first<{id:string;cashKrw:number;status:string;startsAt:number;endsAt:number}>();
    if (!participant) throw new Error("FORBIDDEN");
    const duplicate = await env.DB!.prepare(
      "SELECT id,status,filled_quantity_micros AS filledQuantityMicros,updated_at AS updatedAt FROM orders WHERE participant_id=? AND client_order_id=?"
    ).bind(participantId, clientOrderId).first();
    if (duplicate) return Response.json({ order: duplicate, duplicate: true });
    const now = Date.now();
    if (participant.status !== "active" || now < participant.startsAt || now > participant.endsAt) {
      return Response.json({ error: "현재 주문 가능한 대회가 아닙니다." }, { status: 409 });
    }
    const marketSession = await getCheckedMarketSession(body.market, body.market === "KR" ? requestedVenue : undefined);
    if (!marketSession.isOpen) return Response.json({ error: marketSession.notice }, { status: 409 });
    const quote = await getTradingQuote(
      body.market,
      symbol,
      exchange,
      marketSession,
      body.market === "KR" ? requestedVenue : undefined,
    );
    const sourceTime = quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1000 : quote.timestamp;
    if (!isExecutableTradingQuote(quote, now)) return Response.json({ error: "네이버증권 시세가 지연되어 주문을 중단했습니다." }, { status: 503 });
    const fxRate = quote.exchangeRate;
    if (!Number.isFinite(fxRate) || fxRate <= 0) return Response.json({ error: "네이버증권 환율을 확인할 수 없어 미국주식 주문을 중단했습니다." }, { status: 503 });

    const quantityMicros = Math.round(Number(body.quantity) * 1_000_000);
    const nativePriceMicros = Math.round(quote.price * 1_000_000);
    const fxRateMicros = Math.round(fxRate * 1_000_000);
    const priceKrwMicros = Math.round(quote.price * fxRate * 1_000_000);
    const tradeValueKrw = Number((BigInt(quantityMicros) * BigInt(priceKrwMicros) + BigInt(500_000_000_000)) / BigInt(1_000_000_000_000));
    if (tradeValueKrw <= 0 || quantityMicros <= 0) return Response.json({ error: "최소 주문금액을 확인해주세요." }, { status: 400 });

    const instrumentId = `${body.market}:${symbol}`;
    const orderId = crypto.randomUUID();
    const fillId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    const isBuy = body.side === "buy";
    const limitPriceMicros = body.orderType === "limit" ? Math.round(Number(body.limitPrice) * 1_000_000) : null;
    const marketable = body.orderType === "market" || (isBuy ? nativePriceMicros <= Number(limitPriceMicros) : nativePriceMicros >= Number(limitPriceMicros));
    const activeExchange = quote.venue ?? exchange ?? body.market;
    const executionVenue = body.market === "KR" && (activeExchange === "KRX" || activeExchange === "NXT") ? activeExchange : null;
    const instrumentExchange = exchange ?? (body.market === "CRYPTO" ? "UPBIT" : body.market);

    await env.DB!.prepare(
      `INSERT INTO instruments (id,market,symbol,name,currency,exchange,is_active) VALUES (?,?,?,?,?,?,1)
       ON CONFLICT(market,symbol) DO UPDATE SET name=excluded.name,
       exchange=CASE
         WHEN instruments.market='KR' AND instruments.exchange IN ('KOSPI','KOSDAQ','KONEX') THEN instruments.exchange
         ELSE excluded.exchange
       END,is_active=1`
    ).bind(instrumentId, body.market, symbol, name, quote.currency, instrumentExchange).run();
    await persistQuoteSnapshot(quote);

    const position = await env.DB!.prepare(
      "SELECT quantity_micros AS quantityMicros,average_price_micros AS averagePriceMicros,realized_pnl_krw AS realizedPnlKrw FROM positions WHERE participant_id=? AND instrument_id=?"
    ).bind(participantId, instrumentId).first<{quantityMicros:number;averagePriceMicros:number;realizedPnlKrw:number}>();
    const reserved = await env.DB!.prepare(`SELECT
      COALESCE(SUM(CASE WHEN o.side='buy' THEN
        (o.quantity_micros/1000000.0)*(o.limit_price_micros/1000000.0)*(COALESCE(q.fx_rate_micros,1000000)/1000000.0) *
        CASE
          WHEN i.market='US' THEN 1.0007
          WHEN i.market='CRYPTO' THEN 1.0005
          WHEN i.market='KR' AND UPPER(COALESCE(o.venue,i.exchange))='NXT' THEN 1.000145
          ELSE 1.00015
        END
        ELSE 0 END),0) AS cashKrw,
      COALESCE(SUM(CASE WHEN o.side='sell' AND o.instrument_id=? THEN o.quantity_micros ELSE 0 END),0) AS sellQuantityMicros
      FROM orders o JOIN instruments i ON i.id=o.instrument_id
      LEFT JOIN quote_snapshots q ON q.instrument_id=o.instrument_id
      WHERE o.participant_id=? AND o.status='pending'`)
      .bind(instrumentId, participantId).first<{cashKrw:number;sellQuantityMicros:number}>();
    const reservedCashKrw = Math.ceil(Number(reserved?.cashKrw ?? 0));
    const orderCheckValueKrw = body.orderType === "limit"
      ? Number((BigInt(quantityMicros) * BigInt(Math.round(Number(body.limitPrice) * fxRate * 1_000_000)) + BigInt(500_000_000_000)) / BigInt(1_000_000_000_000))
      : tradeValueKrw;
    const orderCheckCosts = calculateTradingCosts({ market: body.market, exchange: activeExchange, side: "buy", tradeValueKrw: orderCheckValueKrw });
    const orderCheckSettlementKrw = orderCheckValueKrw + orderCheckCosts.totalCostKrw;
    if (!isBuy && (!position || position.quantityMicros - Number(reserved?.sellQuantityMicros ?? 0) < quantityMicros)) return Response.json({ error: "주문 가능한 보유수량이 부족합니다." }, { status: 409 });
    if (isBuy && participant.cashKrw - reservedCashKrw < orderCheckSettlementKrw) return Response.json({ error: "수수료를 포함한 주문 가능 금액이 부족합니다." }, { status: 409 });

    if (!marketable) {
      await env.DB!.prepare(`INSERT INTO orders (id,client_order_id,participant_id,instrument_id,side,order_type,venue,quantity_micros,limit_price_micros,filled_quantity_micros,status,rejection_reason,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,'pending',NULL,?,?)`).bind(orderId, clientOrderId, participantId, instrumentId, body.side, "limit", executionVenue, quantityMicros, limitPriceMicros, now, now).run();
      await auditLog(request, "order.pending", "order", orderId, user.id, { market: body.market, symbol, side: body.side, quantity: body.quantity, limitPrice: body.limitPrice, exchange: activeExchange }).catch(() => undefined);
      return Response.json({ order: { id: orderId, status: "pending", side: body.side, quantity: body.quantity, limitPrice: body.limitPrice, exchange: activeExchange } }, { status: 201 });
    }

    const domesticSecurity = body.market === "KR" && !isBuy
      ? await getDomesticSecurityClassification(symbol)
      : null;
    const costs = calculateTradingCosts({
      market: body.market,
      exchange: activeExchange,
      side: body.side!,
      tradeValueKrw,
      securityType: domesticSecurity?.type,
    });
    const expectedCash = participant.cashKrw;
    const ledgerAmount = isBuy ? -(tradeValueKrw + costs.totalCostKrw) : tradeValueKrw - costs.totalCostKrw;
    const nextCash = expectedCash + ledgerAmount;
    const oldQty = position?.quantityMicros ?? 0;
    const oldAvg = position?.averagePriceMicros ?? 0;
    const nextQty = isBuy ? oldQty + quantityMicros : oldQty - quantityMicros;
    const buyCostPriceKrwMicros = isBuy && costs.totalCostKrw > 0
      ? priceKrwMicros + Number((BigInt(costs.totalCostKrw) * 1_000_000_000_000n) / BigInt(quantityMicros))
      : priceKrwMicros;
    const nextAvg = isBuy
      ? Number((BigInt(oldQty) * BigInt(oldAvg) + BigInt(quantityMicros) * BigInt(buyCostPriceKrwMicros)) / BigInt(oldQty + quantityMicros))
      : (nextQty === 0 ? 0 : oldAvg);
    const grossRealized = !isBuy
      ? Number((BigInt(quantityMicros) * BigInt(priceKrwMicros - oldAvg)) / BigInt(1_000_000_000_000))
      : 0;
    const realized = !isBuy ? grossRealized - costs.totalCostKrw : 0;

    const statements = [
      env.DB!.prepare("UPDATE participants SET cash_krw=?,realized_pnl_krw=realized_pnl_krw+? WHERE id=? AND cash_krw=?").bind(nextCash, realized, participantId, expectedCash),
      env.DB!.prepare(`INSERT INTO orders (id,client_order_id,participant_id,instrument_id,side,order_type,venue,quantity_micros,limit_price_micros,filled_quantity_micros,status,rejection_reason,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0`).bind(orderId, clientOrderId, participantId, instrumentId, body.side, body.orderType, executionVenue, quantityMicros, limitPriceMicros, quantityMicros, "filled", null, now, now),
      env.DB!.prepare(`INSERT INTO fills (id,order_id,participant_id,instrument_id,side,venue,quantity_micros,price_micros,fx_rate_micros,fee_krw,executed_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)`).bind(fillId, orderId, participantId, instrumentId, body.side, executionVenue, quantityMicros, nativePriceMicros, fxRateMicros, costs.totalCostKrw, now, orderId),
      env.DB!.prepare(`INSERT INTO positions (id,participant_id,instrument_id,quantity_micros,average_price_micros,realized_pnl_krw,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)
        ON CONFLICT(participant_id,instrument_id) DO UPDATE SET quantity_micros=excluded.quantity_micros,average_price_micros=excluded.average_price_micros,realized_pnl_krw=positions.realized_pnl_krw+?,updated_at=excluded.updated_at`).bind(positionId, participantId, instrumentId, nextQty, nextAvg, realized, now, fillId, realized),
      env.DB!.prepare(`INSERT INTO cash_ledger (id,participant_id,type,amount_krw,reference_id,balance_after_krw,created_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)`).bind(crypto.randomUUID(), participantId, body.side, ledgerAmount, fillId, nextCash, now, fillId),
      env.DB!.prepare(`INSERT INTO quote_snapshots (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)
        ON CONFLICT(instrument_id) DO UPDATE SET price_micros=excluded.price_micros,change_micros=excluded.change_micros,change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros,source=excluded.source,source_timestamp=excluded.source_timestamp,received_at=excluded.received_at`)
        .bind(instrumentId, priceKrwMicros, Math.round(quote.change * fxRate * 1_000_000), Math.round(quote.changeRate * 10_000), fxRateMicros, quote.source, sourceTime, now, fillId),
    ];
    const result = await env.DB!.batch(statements);
    if ((result[0].meta.changes ?? 0) !== 1) return Response.json({ error: "자산이 변경되어 주문을 다시 확인해주세요." }, { status: 409 });
    await auditLog(request, "order.filled", "order", orderId, user.id, {
      market: body.market, symbol, side: body.side, orderType: body.orderType, quantity: body.quantity, exchange: activeExchange, venue: executionVenue,
      securityType: domesticSecurity?.type, securityTypeSource: domesticSecurity?.source,
      commissionKrw: costs.commissionKrw, taxKrw: costs.taxKrw, totalCostKrw: costs.totalCostKrw,
    }).catch(() => undefined);
    return Response.json({ order: {
      id: orderId, status: "filled", side: body.side, quantity: body.quantity, price: quote.price, currency: quote.currency,
      exchangeRate: fxRate, exchange: activeExchange, valueKrw: tradeValueKrw, commissionKrw: costs.commissionKrw,
      taxKrw: costs.taxKrw, totalCostKrw: costs.totalCostKrw, settlementKrw: Math.abs(ledgerAmount),
      securityType: domesticSecurity?.type, executedAt: now,
    } }, { status: 201 });
  } catch (error) {
    if (isQuoteUnavailable(error)) {
      return Response.json({ error: "네이버증권 실시간 시세를 확인할 수 없어 주문을 중단했습니다." }, { status: 503, headers: { "retry-after": "30" } });
    }
    return apiError(error);
  }
}
