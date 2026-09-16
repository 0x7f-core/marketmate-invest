import { env } from "cloudflare:workers";
import type { LiveQuote } from "@/lib/server/market-data";
import { getCheckedMarketSession } from "@/lib/server/market-hours";

type PendingOrder = { id: string; participantId: string; side: "buy" | "sell"; quantityMicros: number; limitPriceMicros: number };

export async function matchPendingOrders(quote: LiveQuote) {
  if (!env.DB) return;
  const session = await getCheckedMarketSession(quote.market);
  if (!session.isOpen) return;
  const instrumentId = `${quote.market}:${quote.symbol}`;
  const nativePriceMicros = Math.round(quote.price * 1_000_000);
  const rows = await env.DB.prepare(`SELECT id,participant_id AS participantId,side,quantity_micros AS quantityMicros,limit_price_micros AS limitPriceMicros
    FROM orders WHERE instrument_id=? AND status='pending' AND ((side='buy' AND limit_price_micros>=?) OR (side='sell' AND limit_price_micros<=?))
    ORDER BY created_at LIMIT 20`).bind(instrumentId, nativePriceMicros, nativePriceMicros).all<PendingOrder>();
  for (const order of rows.results) await fillPendingOrder(order, quote, nativePriceMicros);
}

async function fillPendingOrder(order: PendingOrder, quote: LiveQuote, nativePriceMicros: number) {
  const claimed = await env.DB!.prepare("UPDATE orders SET status='partial',updated_at=? WHERE id=? AND status='pending'").bind(Date.now(), order.id).run();
  if ((claimed.meta.changes ?? 0) !== 1) return;
  const participant = await env.DB!.prepare(`SELECT p.cash_krw AS cashKrw,c.status,c.starts_at AS startsAt,c.ends_at AS endsAt
    FROM participants p JOIN competitions c ON c.id=p.competition_id WHERE p.id=?`).bind(order.participantId).first<{cashKrw:number;status:string;startsAt:number;endsAt:number}>();
  const position = await env.DB!.prepare("SELECT quantity_micros AS quantityMicros,average_price_micros AS averagePriceMicros,realized_pnl_krw AS realizedPnlKrw FROM positions WHERE participant_id=? AND instrument_id=?")
    .bind(order.participantId, `${quote.market}:${quote.symbol}`).first<{quantityMicros:number;averagePriceMicros:number;realizedPnlKrw:number}>();
  const now = Date.now();
  const priceKrwMicros = Math.round(quote.price * quote.exchangeRate * 1_000_000);
  const tradeValueKrw = Number((BigInt(order.quantityMicros) * BigInt(priceKrwMicros) + BigInt(500_000_000_000)) / BigInt(1_000_000_000_000));
  const isBuy = order.side === "buy";
  let reason = "";
  if (!participant || participant.status !== "active" || now < participant.startsAt || now > participant.endsAt) reason = "대회가 종료되어 체결되지 않았습니다.";
  else if (isBuy && participant.cashKrw < tradeValueKrw) reason = "주문 가능 금액이 부족해 체결되지 않았습니다.";
  else if (!isBuy && (!position || position.quantityMicros < order.quantityMicros)) reason = "보유수량이 부족해 체결되지 않았습니다.";
  if (reason) {
    await env.DB!.prepare("UPDATE orders SET status='rejected',rejection_reason=?,updated_at=? WHERE id=? AND status='partial'").bind(reason, now, order.id).run();
    return;
  }
  const oldQty = position?.quantityMicros ?? 0;
  const oldAvg = position?.averagePriceMicros ?? 0;
  const nextQty = isBuy ? oldQty + order.quantityMicros : oldQty - order.quantityMicros;
  const nextAvg = isBuy ? Number((BigInt(oldQty) * BigInt(oldAvg) + BigInt(order.quantityMicros) * BigInt(priceKrwMicros)) / BigInt(oldQty + order.quantityMicros)) : (nextQty === 0 ? 0 : oldAvg);
  const realized = !isBuy ? Number((BigInt(order.quantityMicros) * BigInt(priceKrwMicros - oldAvg)) / BigInt(1_000_000_000_000)) : 0;
  const nextCash = isBuy ? participant!.cashKrw - tradeValueKrw : participant!.cashKrw + tradeValueKrw;
  const fillId = crypto.randomUUID();
  const result = await env.DB!.batch([
    env.DB!.prepare("UPDATE participants SET cash_krw=?,realized_pnl_krw=realized_pnl_krw+? WHERE id=? AND cash_krw=?").bind(nextCash, realized, order.participantId, participant!.cashKrw),
    env.DB!.prepare("UPDATE orders SET status='filled',filled_quantity_micros=quantity_micros,updated_at=? WHERE id=? AND status='partial' AND changes()>0").bind(now, order.id),
    env.DB!.prepare(`INSERT INTO fills (id,order_id,participant_id,instrument_id,side,quantity_micros,price_micros,fx_rate_micros,fee_krw,executed_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND status='filled')`).bind(fillId, order.id, order.participantId, `${quote.market}:${quote.symbol}`, order.side, order.quantityMicros, nativePriceMicros, Math.round(quote.exchangeRate * 1_000_000), 0, now, order.id),
    env.DB!.prepare(`INSERT INTO positions (id,participant_id,instrument_id,quantity_micros,average_price_micros,realized_pnl_krw,updated_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?) ON CONFLICT(participant_id,instrument_id) DO UPDATE SET quantity_micros=excluded.quantity_micros,average_price_micros=excluded.average_price_micros,realized_pnl_krw=positions.realized_pnl_krw+?,updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), order.participantId, `${quote.market}:${quote.symbol}`, nextQty, nextAvg, realized, now, fillId, realized),
    env.DB!.prepare(`INSERT INTO cash_ledger (id,participant_id,type,amount_krw,reference_id,balance_after_krw,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fills WHERE id=?)`).bind(crypto.randomUUID(), order.participantId, order.side, isBuy ? -tradeValueKrw : tradeValueKrw, fillId, nextCash, now, fillId),
  ]);
  if ((result[0].meta.changes ?? 0) !== 1) await env.DB!.prepare("UPDATE orders SET status='pending',updated_at=? WHERE id=? AND status='partial'").bind(Date.now(), order.id).run();
}
