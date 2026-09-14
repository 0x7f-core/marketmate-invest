import { env } from "cloudflare:workers";
import { apiError, requireAdmin } from "@/lib/server/auth";

type Body = { action?: string; userId?: string; competitionId?: string; participantId?: string; active?: boolean; status?: "active" | "ended" };

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json() as Body;
    if (body.action === "user_status" && body.userId && typeof body.active === "boolean") {
      if (body.userId === admin.id && !body.active) return Response.json({ error: "현재 관리자 계정은 정지할 수 없습니다." }, { status: 409 });
      await env.DB!.batch([
        env.DB!.prepare("UPDATE users SET is_active=?,updated_at=? WHERE id=?").bind(body.active ? 1 : 0, Date.now(), body.userId),
        ...(!body.active ? [env.DB!.prepare("DELETE FROM sessions WHERE user_id=?").bind(body.userId)] : []),
      ]);
      return Response.json({ ok: true });
    }
    if (body.action === "competition_status" && body.competitionId && ["active", "ended"].includes(body.status ?? "")) {
      await env.DB!.prepare("UPDATE competitions SET status=? WHERE id=?").bind(body.status, body.competitionId).run();
      return Response.json({ ok: true });
    }
    if (body.action === "remove_member" && body.participantId) {
      const target = await env.DB!.prepare(`SELECT p.id,c.owner_user_id AS ownerUserId,p.user_id AS userId FROM participants p JOIN competitions c ON c.id=p.competition_id WHERE p.id=?`).bind(body.participantId).first<{id:string;ownerUserId:string;userId:string}>();
      if (!target) throw new Error("NOT_FOUND");
      if (target.ownerUserId === target.userId) return Response.json({ error: "대회장은 멤버에서 제거할 수 없습니다. 대회를 삭제해주세요." }, { status: 409 });
      await deleteParticipant(target.id);
      return Response.json({ ok: true });
    }
    if (body.action === "delete_competition" && body.competitionId) {
      await deleteCompetition(body.competitionId);
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
