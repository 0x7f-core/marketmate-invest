import { env } from "cloudflare:workers";
import { normalizeCryptoNamedItem } from "@/lib/crypto-display-name";
import { apiError, requireUser } from "@/lib/server/auth";
import { getDomesticListingMarket } from "@/lib/server/domestic-listing-market";
import { annotateFillReturns } from "@/lib/server/fill-returns";
import { getUsListingExchange, normalizeUsListingExchange } from "@/lib/server/us-listing-exchange";

type ActivityPosition = {
  market: "KR" | "US" | "CRYPTO";
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  quantityMicros: number;
  averagePriceKrwMicros: number;
  currentPriceKrwMicros?: number | null;
  unrealizedPnlKrw?: number | null;
};

type ActivityFill = {
  id: string;
  instrumentId: string;
  side: "buy" | "sell";
  venue?: "KRX" | "NXT" | null;
  quantityMicros: number;
  priceMicros: number;
  fxRateMicros: number;
  feeKrw: number;
  executedAt: number;
  market: "KR" | "US" | "CRYPTO";
  symbol: string;
  name: string;
  currency: string;
  currentPriceKrwMicros?: number | null;
};

async function repairListingExchanges(items: ActivityPosition[]) {
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
    const participantId = new URL(request.url).searchParams.get("participantId");
    if (!participantId) return Response.json({ error: "participantId가 필요합니다." }, { status: 400 });

    const participant = await env.DB!.prepare(
      `SELECT target.id,target.competition_id AS competitionId,u.nickname
       FROM participants target JOIN users u ON u.id=target.user_id
       WHERE target.id=? AND EXISTS(
         SELECT 1 FROM participants viewer
         WHERE viewer.competition_id=target.competition_id AND viewer.user_id=?
       )`,
    ).bind(participantId, user.id).first<{ id: string; competitionId: string; nickname: string }>();
    if (!participant) throw new Error("FORBIDDEN");

    const positions = await env.DB!.prepare(
      `SELECT i.market,i.symbol,i.name,i.currency,i.exchange,pos.quantity_micros AS quantityMicros,
              pos.average_price_micros AS averagePriceKrwMicros,q.price_micros AS currentPriceKrwMicros,
              ((pos.quantity_micros / 1000000.0) * ((q.price_micros - pos.average_price_micros) / 1000000.0)) AS unrealizedPnlKrw
       FROM positions pos JOIN instruments i ON i.id=pos.instrument_id
       LEFT JOIN quote_snapshots q ON q.instrument_id=i.id
       WHERE pos.participant_id=? AND pos.quantity_micros>0 ORDER BY i.market,i.name`,
    ).bind(participantId).all<ActivityPosition>();
    const repairedPositions = (await repairListingExchanges(positions.results)).map(item => normalizeCryptoNamedItem(item));
    const fills = await env.DB!.prepare(
      `SELECT f.id,f.instrument_id AS instrumentId,f.side,f.venue,f.quantity_micros AS quantityMicros,f.price_micros AS priceMicros,
              f.fx_rate_micros AS fxRateMicros,f.fee_krw AS feeKrw,f.executed_at AS executedAt,
              i.market,i.symbol,i.name,i.currency,q.price_micros AS currentPriceKrwMicros
       FROM fills f JOIN instruments i ON i.id=f.instrument_id
       LEFT JOIN quote_snapshots q ON q.instrument_id=f.instrument_id
       WHERE f.participant_id=? ORDER BY f.executed_at ASC,f.id ASC`,
    ).bind(participantId).all<ActivityFill>();
    const fillsWithReturns = annotateFillReturns(fills.results.map(item => normalizeCryptoNamedItem(item)))
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, 100);
    return Response.json({ participant, positions: repairedPositions, fills: fillsWithReturns }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
