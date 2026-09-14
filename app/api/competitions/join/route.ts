import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as { inviteCode?: string };
    const code = body.inviteCode?.trim().toUpperCase() ?? "";
    const competition = await env.DB!.prepare("SELECT id,initial_cash_krw AS initialCashKrw,status,ends_at AS endsAt FROM competitions WHERE invite_code=?").bind(code).first<{id:string;initialCashKrw:number;status:string;endsAt:number}>();
    if (!competition) throw new Error("NOT_FOUND");
    if (competition.status !== "active" || competition.endsAt <= Date.now()) return Response.json({ error: "참가할 수 없는 대회입니다." }, { status: 409 });
    const now = Date.now();
    const participantId = crypto.randomUUID();
    await env.DB!.batch([
      env.DB!.prepare("INSERT INTO participants (id,competition_id,user_id,cash_krw,realized_pnl_krw,joined_at) VALUES (?,?,?,?,?,?) ON CONFLICT(competition_id,user_id) DO NOTHING").bind(participantId, competition.id, user.id, competition.initialCashKrw, 0, now),
      env.DB!.prepare("INSERT INTO cash_ledger (id,participant_id,type,amount_krw,reference_id,balance_after_krw,created_at) SELECT ?,?,?,?,?,?,? WHERE changes() > 0").bind(crypto.randomUUID(), participantId, "initial", competition.initialCashKrw, competition.id, competition.initialCashKrw, now),
    ]);
    const joined = await env.DB!.prepare("SELECT id FROM participants WHERE competition_id=? AND user_id=?").bind(competition.id, user.id).first<{id:string}>();
    return Response.json({ joined: true, competitionId: competition.id, participantId: joined?.id }, { status: 201 });
  } catch (error) { return apiError(error); }
}
