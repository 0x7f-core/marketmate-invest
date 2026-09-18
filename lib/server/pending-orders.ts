import { env } from "cloudflare:workers";
import { calculateTradingCosts } from "@/lib/trading-costs";
import { getDomesticSecurityClassification } from "@/lib/server/domestic-security-type";
import { getCheckedMarketSession } from "@/lib/server/market-hours";
import { isExecutableTradingQuote, type TradingQuote } from "@/lib/server/trading-quote";

type PendingOrder = { id: string; participantId: string; side: "buy" | "sell"; venue?: "KRX" | "NXT" | null; quantityMicros: number; limitPriceMicros: number };

export async function matchPendingOrders(quote: TradingQuote) {
  if (!env.DB || !isExecutableTradingQuote(quote)) return;

  const instrumentId = `${quote.market}:${quote.symbol}`;
  const nativePriceMicros = Math.round(quote.price * 1_000_000);

  // Most quote refreshes have no executable pending order. Check D1 first so
  // normal price rendering does not pay for an additional market-session lookup.
  const domesticVenue = quote.market === "KR"
    ? (quote.venue === "NXT" ? "NXT" : "KRX")
    : null;
  const candidate = await env.DB.prepare(`SELECT id FROM orders
    WHERE instrument_id=? AND status='pending'
      AND (? IS NULL OR COALESCE(venue,'KRX')=?)
      AND ((side='buy' AND limit_price_micros>=?) OR (side='sell' AND limit_price_micros<=?))
    LIMIT 1`).bind(instrumentId, domesticVenue, domesticVenue, nativePriceMicros, nativePriceMicros).first<{ id: string }>();
  if (!candidate) return;

  const session = await getCheckedMarketSession(quote.market, domesticVenue ?? undefined);
  if (!session.isOpen || session.stale || !isExecutableTradingQuote(quote)) return;
  if (quote.market === "KR" && quote.venue && session.exchange && quote.venue !== session.exchange) return;

  const rows = await env.DB.prepare(`SELECT id,participant_id AS participantId,side,venue,quantity_micros AS quantityMicros,limit_price_micros AS limitPriceMicros
    FROM orders WHERE instrument_id=? AND status='pending'
      AND (? IS NULL OR COALESCE(venue,'KRX')=?)
      AND ((side='buy' AND limit_price_micros>=?) OR (side='sell' AND limit_price_micros<=?))
    ORDER BY created_at LIMIT 20`).bind(instrumentId, domesticVenue, domesticVenue, nativePriceMicros, nativePriceMicros).all<PendingOrder>();
  for (const order of rows.results) await fillPendingOrder(order, quote, nativePriceMicros);
}

async function fillPendingOrder(order: PendingOrder, quote: TradingQuote, nativePriceMicros: number) {
  const claimed = await env.DB!.prepare("UPDATE orders SET status='partial',updated_at=? WHERE id=? AND status='pending'").bind(Date.now(), order.id).run();
  if ((claimed.meta.changes ?? 0) !== 1) return;
  const participant = await env.DB!.prepare(`SELECT p.cash_krw AS cashKrw,c.status,c.starts_at AS startsAt,c.ends_at AS endsAt
    FROM participants p JOIN competitions c ON c.id=p.competition_id WHERE p.id=?`).bind(order.participantId).first<{cashKrw:number;status:string;startsAt:number;endsAt:number}>();
  const instrumentId = `${quote.market}:${quote.symbol}`;
  const position = await env.DB!.prepare("SELECT quantity_micros AS quantityMicros,average_price_micros AS averagePriceMicros,realized_pnl_krw AS realizedPnlKrw FROM positions WHERE participant_id=? AND instrument_id=?")
    .bind(order.participantId, instrumentId).first<{quantityMicros:number;averagePriceMicros:number;realizedPnlKrw:number}>();
  const now = Date.now();
  const priceKrwMicros = Math.round(quote.price * quote.exchangeRate * 1_000_000);
  const tradeValueKrw = Number((BigInt(order.quantityMicros) * BigInt(priceKrwMicros) + BigInt(500_000_000_000)) / BigInt(1_000_000_000_000));
  const isBuy = order.side === "buy";
  const executionExchange = order.venue ?? quote.venue ?? (quote.market === "CRYPTO" ? "UPBIT" : quote.market === "KR" ? "KRX" : "US");
  const domesticSecurity = quote.market === "KR" && !isBuy
    ? await getDomesticSecurityClassification(quote.symbol)
    : null;
  const costs = calculateTradingCosts({
    market: quote.market,
    exchange: executionExchange,
    side: order.side,
    tradeValueKrw,
    securityType: domesticSecurity?.type,
  });
  const buySettlementKrw = tradeValueKrw + costs.totalCostKrw;
  let reason = "";
  if (!participant || participant.status !== "active" || now < participant.startsAt || now > participant.endsAt) reason = "대회가 종료되어 체결되지 않았습니다.";
  else if (isBuy && participant.cashKrw < buySettlementKrw) reason = "수수료를 포함한 주문 가능 금액이 부족해 체결되지 않았습니다.";
  else if (!isBuy && (!position || position.quantityMicros < order.quantityMicros)) reason = "보유수량이 부족해 체결되지 않았습니다.";
  if (reason) {
    await env.DB!.prepare("UPDATE orders SET status='rejected',rejection_reason=?,updated_at=? WHERE id=? AND status='partial'").bind(reason, now, order.id).run();
    return;
  }
  const oldQty = position?.quantityMicros ?? 0;
  const oldAvg = position?.averagePriceMicros ?? 0;
  const nextQty = isBuy ? oldQty + order.quantityMicros : oldQty - order.quantityMicros;
  const buyCostPriceKrwMicros = isBuy && costs.totalCostKrw > 0
    ? priceKrwMicros + Number((BigInt(costs.totalCostKrw) * 1_000_000_000_000n) / BigInt(order.quantityMicros))
    : priceKrwMicros;
  const nextAvg = isBuy ? Number((BigInt(oldQty) * BigInt(oldAvg) + BigInt(order.quantityMicros) * BigInt(buyCostPriceKrwMicros)) / BigInt(oldQty + order.quantityMicros)) : (nextQty === 0 ? 0 : oldAvg);
  const grossRealized = !isBuy ? Number((BigInt(order.quantityMicros) * BigInt(priceKrwMicros - oldAvg)) / BigInt(1_000_000_000_000)) : 0;
  const realized = !isBuy ? grossRealized - costs.totalCostKrw : 0;
  const ledgerAmount = isBuy ? -(tradeValueKrw + costs.totalCostKrw) : tradeValueKrw - costs.totalCostKrw;
  const nextCash = participant!.cashKrw + ledgerAmount;
  const fillId = crypto.randomUUID();
  const statements = [
    env.DB!.prepare("UPDATE participants SET cash_krw=?,realized_pnl_krw=realized_pnl_krw+? WHERE id=? AND cash_krw=?").bind(nextCash, realized, order.participantId, participant!.cashKrw),
    env.DB!.prepare("UPDATE orders SET status='filled',filled_quantity_micros=quantity_micros,updated_at=? WHERE id=? AND status='partial' AND changes()>0").bind(now, order.id),
    env.DB!.prepare(`INSERT INTO fills (id,order_id,participant_id,instrument_id,side,venue,quantity_micros,price_micros,fx_rate_micros,fee_krw,executed_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND status='filled')`).bind(fillId, order.id, order.participantId, instrumentId, order.side, order.venue ?? (quote.market === "KR" ? quote.venue ?? "KRX" : null), order.quantityMicros, nativePriceMicros, Math.round(quote.exchangeRate * 1_000_000), costs.totalCostKrw, now, order.id),
    env.DB!.prepare(`INSERT INTO positions (id,participant_id,instrument_id,quantity_micros,average_price_micros,realized_pnl_krw,updated_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?) ON CONFLICT(participant_id,instrument_id) DO UPDATE SET quantity_micros=excluded.quantity_micros,average_price_micros=excluded.average_price_micros,realized_pnl_krw=positions.realized_pnl_krw+?,updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), order.participantId, instrumentId, nextQty, nextAvg, realized, now, fillId, realized),
    env.DB!.prepare(`INSERT INTO cash_ledger (id,participant_id,type,amount_krw,reference_id,balance_after_krw,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)`).bind(crypto.randomUUID(), order.participantId, order.side, ledgerAmount, fillId, nextCash, now, fillId),
  ];
  const result = await env.DB!.batch(statements);
  if ((result[0].meta.changes ?? 0) !== 1) await env.DB!.prepare("UPDATE orders SET status='pending',updated_at=? WHERE id=? AND status='partial'").bind(Date.now(), order.id).run();
}
