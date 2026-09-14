import { env } from "cloudflare:workers";
import { apiError, requireAdmin } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const [users, competitions, participants] = await Promise.all([
      env.DB!.prepare(`SELECT u.id,u.nickname,u.role,u.is_active AS isActive,u.created_at AS createdAt,
        COUNT(DISTINCT p.competition_id) AS competitionCount,COUNT(DISTINCT f.id) AS fillCount
        FROM users u LEFT JOIN participants p ON p.user_id=u.id LEFT JOIN fills f ON f.participant_id=p.id
        GROUP BY u.id ORDER BY u.created_at DESC`).all(),
      env.DB!.prepare(`SELECT c.id,c.name,c.invite_code AS inviteCode,c.status,c.starts_at AS startsAt,c.ends_at AS endsAt,
        u.nickname AS ownerNickname,COUNT(DISTINCT p.id) AS participantCount,COUNT(DISTINCT f.id) AS fillCount
        FROM competitions c JOIN users u ON u.id=c.owner_user_id LEFT JOIN participants p ON p.competition_id=c.id
        LEFT JOIN fills f ON f.participant_id=p.id GROUP BY c.id ORDER BY c.created_at DESC`).all(),
      env.DB!.prepare(`SELECT p.id,p.competition_id AS competitionId,u.nickname,p.cash_krw AS cashKrw,
        CASE WHEN c.owner_user_id=p.user_id THEN 1 ELSE 0 END AS isOwner
        FROM participants p JOIN users u ON u.id=p.user_id JOIN competitions c ON c.id=p.competition_id
        ORDER BY p.joined_at`).all(),
    ]);
    return Response.json({ users: users.results, competitions: competitions.results, participants: participants.results }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
