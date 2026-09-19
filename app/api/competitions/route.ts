import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "competition_read", 120, 60 * 1000, user.id);
    const result = await env.DB!.prepare(
      `SELECT c.id, c.name, c.invite_code AS inviteCode, c.status,
              c.initial_cash_krw AS initialCashKrw, c.starts_at AS startsAt,
              c.ends_at AS endsAt, p.id AS participantId, p.cash_krw AS cashKrw
       FROM competitions c
       JOIN participants p ON p.competition_id = c.id
       WHERE p.user_id = ? ORDER BY c.created_at DESC`
    ).bind(user.id).all();
    return Response.json({ competitions: result.results });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "competition_create", 10, 60 * 60 * 1000, user.id);
    const body = await request.json() as { name?: string; initialCashKrw?: number; startsAt?: number; endsAt?: number };
    const name = body.name?.trim().slice(0, 60) ?? "";
    const initialCashKrw = Math.round(Number(body.initialCashKrw));
    const startsAt = Number(body.startsAt);
    const endsAt = Number(body.endsAt);
    if (!name || initialCashKrw < 1_000_000 || initialCashKrw > 10_000_000_000 || !startsAt || endsAt <= startsAt) {
      return Response.json({ error: "대회 설정값을 확인해주세요." }, { status: 400 });
    }
    const now = Date.now();
    const existingCompetition = await env.DB!.prepare(
      `SELECT c.id,c.name
       FROM participants p
       JOIN competitions c ON c.id=p.competition_id
       WHERE p.user_id=? AND c.status='active' AND c.ends_at>?
       ORDER BY c.created_at DESC LIMIT 1`,
    ).bind(user.id, now).first<{id:string;name:string}>();
    if (existingCompetition) {
      return Response.json(
        { error: `이미 '${existingCompetition.name}' 대회에 참가 중입니다. 현재 대회에서 나간 뒤 새 대회를 만들 수 있습니다.` },
        { status: 409 },
      );
    }

    const competitionId = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const inviteCode = `MATE-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await env.DB!.batch([
      env.DB!.prepare(
        `INSERT INTO competitions (id,owner_user_id,name,invite_code,status,initial_cash_krw,starts_at,ends_at,created_at)
         SELECT ?,?,?,?,?,?,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM participants p
           JOIN competitions c ON c.id=p.competition_id
           WHERE p.user_id=? AND c.status='active' AND c.ends_at>?
         )`,
      ).bind(competitionId, user.id, name, inviteCode, "active", initialCashKrw, startsAt, endsAt, now, user.id, now),
      env.DB!.prepare(
        `INSERT INTO participants (id,competition_id,user_id,cash_krw,realized_pnl_krw,joined_at)
         SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM competitions WHERE id=?)`,
      ).bind(participantId, competitionId, user.id, initialCashKrw, 0, now, competitionId),
      env.DB!.prepare(
        "INSERT INTO cash_ledger (id,participant_id,type,amount_krw,reference_id,balance_after_krw,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM participants WHERE id=?)",
      ).bind(crypto.randomUUID(), participantId, "initial", initialCashKrw, competitionId, initialCashKrw, now, participantId),
    ]);
    const created = await env.DB!.prepare(
      "SELECT c.id FROM competitions c JOIN participants p ON p.competition_id=c.id WHERE c.id=? AND p.user_id=?",
    ).bind(competitionId, user.id).first<{id:string}>();
    if (!created) {
      return Response.json({ error: "이미 다른 대회에 참가 중입니다. 현재 대회에서 나간 뒤 다시 시도해주세요." }, { status: 409 });
    }
    await auditLog(request, "competition.created", "competition", competitionId, user.id, { name }).catch(() => undefined);
    return Response.json({ competition: { id: competitionId, participantId, name, inviteCode, initialCashKrw, startsAt, endsAt } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
