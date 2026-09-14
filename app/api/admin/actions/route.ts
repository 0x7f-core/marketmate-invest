import { env } from "cloudflare:workers";
import { apiError, requireAdmin } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";

type Body = { action?: string; userId?: string; competitionId?: string; participantId?: string; active?: boolean; status?: "active" | "ended" };

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "admin_action", 60, 60_000, admin.id);
    const body = await request.json() as Body;
    if (body.action === "user_status" && body.userId && typeof body.active === "boolean") {
      if (body.userId === admin.id && !body.active) return Response.json({ error: "현재 관리자 계정은 정지할 수 없습니다." }, { status: 409 });
      await env.DB!.batch([
        env.DB!.prepare("UPDATE users SET is_active=?,updated_at=? WHERE id=?").bind(body.active ? 1 : 0, Date.now(), body.userId),
        ...(!body.active ? [env.DB!.prepare("DELETE FROM sessions WHERE user_id=?").bind(body.userId)] : []),
      ]);
      await auditLog(request, "admin.user_status", "user", body.userId, admin.id, { active: body.active }).catch(() => undefined);
      return Response.json({ ok: true });
    }
    if (body.action === "delete_user" && body.userId) {
      if (body.userId === admin.id) return Response.json({ error: "현재 관리자 계정은 삭제할 수 없습니다." }, { status: 409 });
      const target = await env.DB!.prepare("SELECT id,nickname,role FROM users WHERE id=?").bind(body.userId).first<{id:string;nickname:string;role:string}>();
      if (!target) throw new Error("NOT_FOUND");
      if (target.role === "admin") return Response.json({ error: "관리자 계정은 삭제할 수 없습니다." }, { status: 409 });
      const owned = await env.DB!.prepare("SELECT id FROM competitions WHERE owner_user_id=?").bind(target.id).all<{id:string}>();
      for (const competition of owned.results) await deleteCompetition(competition.id);
      const joined = await env.DB!.prepare("SELECT id FROM participants WHERE user_id=?").bind(target.id).all<{id:string}>();
      for (const participant of joined.results) await deleteParticipant(participant.id);
      await env.DB!.batch([
        env.DB!.prepare("DELETE FROM watchlist_items WHERE user_id=?").bind(target.id),
        env.DB!.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id),
        env.DB!.prepare("UPDATE audit_logs SET actor_user_id=NULL WHERE actor_user_id=?").bind(target.id),
        env.DB!.prepare("DELETE FROM users WHERE id=?").bind(target.id),
      ]);
      await auditLog(request, "admin.user_deleted", "user", target.id, admin.id, { nickname: target.nickname }).catch(() => undefined);
      return Response.json({ ok: true });
    }
    if (body.action === "competition_status" && body.competitionId && ["active", "ended"].includes(body.status ?? "")) {
      await env.DB!.prepare("UPDATE competitions SET status=? WHERE id=?").bind(body.status, body.competitionId).run();
      await auditLog(request, "admin.competition_status", "competition", body.competitionId, admin.id, { status: body.status }).catch(() => undefined);
      return Response.json({ ok: true });
    }
    if (body.action === "remove_member" && body.participantId) {
      const target = await env.DB!.prepare(`SELECT p.id,c.owner_user_id AS ownerUserId,p.user_id AS userId FROM participants p JOIN competitions c ON c.id=p.competition_id WHERE p.id=?`).bind(body.participantId).first<{id:string;ownerUserId:string;userId:string}>();
      if (!target) throw new Error("NOT_FOUND");
      if (target.ownerUserId === target.userId) return Response.json({ error: "대회장은 멤버에서 제거할 수 없습니다. 대회를 삭제해주세요." }, { status: 409 });
      await deleteParticipant(target.id);
      await auditLog(request, "admin.member_removed", "participant", target.id, admin.id).catch(() => undefined);
      return Response.json({ ok: true });
    }
    if (body.action === "delete_competition" && body.competitionId) {
      await deleteCompetition(body.competitionId);
      await auditLog(request, "admin.competition_deleted", "competition", body.competitionId, admin.id).catch(() => undefined);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "관리 작업값을 확인해주세요." }, { status: 400 });
  } catch (error) { return apiError(error); }
}

async function deleteParticipant(id: string) {
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM fills WHERE participant_id=?").bind(id),
    env.DB!.prepare("DELETE FROM orders WHERE participant_id=?").bind(id),
    env.DB!.prepare("DELETE FROM positions WHERE participant_id=?").bind(id),
    env.DB!.prepare("DELETE FROM cash_ledger WHERE participant_id=?").bind(id),
    env.DB!.prepare("DELETE FROM participants WHERE id=?").bind(id),
  ]);
}

async function deleteCompetition(id: string) {
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM fills WHERE participant_id IN (SELECT id FROM participants WHERE competition_id=?)").bind(id),
    env.DB!.prepare("DELETE FROM orders WHERE participant_id IN (SELECT id FROM participants WHERE competition_id=?)").bind(id),
    env.DB!.prepare("DELETE FROM positions WHERE participant_id IN (SELECT id FROM participants WHERE competition_id=?)").bind(id),
    env.DB!.prepare("DELETE FROM cash_ledger WHERE participant_id IN (SELECT id FROM participants WHERE competition_id=?)").bind(id),
    env.DB!.prepare("DELETE FROM participants WHERE competition_id=?").bind(id),
    env.DB!.prepare("DELETE FROM competitions WHERE id=?").bind(id),
  ]);
}
