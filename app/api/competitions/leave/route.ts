import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const competitionId = new URL(request.url).searchParams.get("competitionId");
    if (!competitionId) return Response.json({ error: "competitionId가 필요합니다." }, { status: 400 });
    const membership = await env.DB!.prepare(`SELECT p.id AS participantId,c.owner_user_id AS ownerUserId,
      (SELECT COUNT(*) FROM participants WHERE competition_id=c.id) AS memberCount
      FROM participants p JOIN competitions c ON c.id=p.competition_id WHERE p.competition_id=? AND p.user_id=?`)
      .bind(competitionId, user.id).first<{participantId:string;ownerUserId:string;memberCount:number}>();
    if (!membership) throw new Error("NOT_FOUND");
    if (membership.ownerUserId === user.id && membership.memberCount > 1) {
      return Response.json({ error: "대회장은 다른 참가자가 있는 대회에서 나갈 수 없습니다. 관리자에게 대회 종료 또는 삭제를 요청해주세요." }, { status: 409 });
    }
    const id = membership.participantId;
    const statements = [
      env.DB!.prepare("DELETE FROM fills WHERE participant_id=?").bind(id),
      env.DB!.prepare("DELETE FROM orders WHERE participant_id=?").bind(id),
      env.DB!.prepare("DELETE FROM positions WHERE participant_id=?").bind(id),
      env.DB!.prepare("DELETE FROM cash_ledger WHERE participant_id=?").bind(id),
      env.DB!.prepare("DELETE FROM participants WHERE id=? AND user_id=?").bind(id, user.id),
    ];
    if (membership.ownerUserId === user.id) statements.push(env.DB!.prepare("DELETE FROM competitions WHERE id=? AND owner_user_id=?").bind(competitionId, user.id));
    await env.DB!.batch(statements);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
