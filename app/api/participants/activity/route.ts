import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";

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
    ).bind(participantId).all();
    const fills = await env.DB!.prepare(
      `SELECT f.id,f.side,f.quantity_micros AS quantityMicros,f.price_micros AS priceMicros,
              f.fx_rate_micros AS fxRateMicros,f.executed_at AS executedAt,
              i.market,i.symbol,i.name,i.currency,i.exchange
       FROM fills f JOIN instruments i ON i.id=f.instrument_id
       WHERE f.participant_id=? ORDER BY f.executed_at DESC LIMIT 100`,
    ).bind(participantId).all();
    return Response.json({ participant, positions: positions.results, fills: fills.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
