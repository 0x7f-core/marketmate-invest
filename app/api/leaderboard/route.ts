import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const competitionId = new URL(request.url).searchParams.get("competitionId");
    if (!competitionId) return Response.json({ error: "competitionId가 필요합니다." }, { status: 400 });
    const member = await env.DB!.prepare("SELECT 1 FROM participants WHERE competition_id=? AND user_id=?").bind(competitionId, user.id).first();
    if (!member) throw new Error("FORBIDDEN");
    const rows = await env.DB!.prepare(
      `SELECT p.id AS participantId,u.nickname,p.cash_krw AS cashKrw,p.realized_pnl_krw AS realizedPnlKrw,
              c.initial_cash_krw AS initialCashKrw,
              p.cash_krw + COALESCE(SUM((pos.quantity_micros / 1000000.0) * (q.price_micros / 1000000.0)),0) AS totalAssetKrw
       FROM participants p JOIN users u ON u.id=p.user_id JOIN competitions c ON c.id=p.competition_id
       LEFT JOIN positions pos ON pos.participant_id=p.id AND pos.quantity_micros>0
       LEFT JOIN quote_snapshots q ON q.instrument_id=pos.instrument_id
       WHERE p.competition_id=? GROUP BY p.id,u.nickname,p.cash_krw,p.realized_pnl_krw,c.initial_cash_krw
       ORDER BY totalAssetKrw DESC,p.joined_at ASC LIMIT 100`
    ).bind(competitionId).all();
    return Response.json({ leaderboard: rows.results.map((row, index) => ({ ...row, rank: index + 1 })) });
  } catch (error) { return apiError(error); }
}
