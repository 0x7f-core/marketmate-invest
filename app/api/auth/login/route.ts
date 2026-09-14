import { env } from "cloudflare:workers";
import { createSession, normalizeNickname, validateCredentials, verifyPin } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";

export async function POST(request: Request) {
  try { assertSameOrigin(request); await enforceRateLimit(request, "login", 12, 10 * 60 * 1000); }
  catch { return Response.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 }); }
  const body = await request.json().catch(() => ({})) as { nickname?: string; pin?: string };
  const nickname = String(body.nickname ?? "").normalize("NFKC").trim();
  const pin = String(body.pin ?? "");
  const validationError = validateCredentials(nickname, pin);
  if (validationError) return Response.json({ error: "닉네임 또는 비밀번호를 확인해주세요." }, { status: 401 });

  const user = await env.DB!.prepare(
    `SELECT id,nickname,pin_hash AS pinHash,pin_salt AS pinSalt,
            failed_login_count AS failedLoginCount,locked_until AS lockedUntil,role,is_active AS isActive
     FROM users WHERE nickname_normalized=?`,
  ).bind(normalizeNickname(nickname)).first<{
    id: string; nickname: string; pinHash: string; pinSalt: string; failedLoginCount: number; lockedUntil: number; role: "member" | "admin"; isActive: number;
  }>();
  const now = Date.now();
  if (!user || !user.isActive || user.lockedUntil > now || !await verifyPin(pin, user.pinSalt, user.pinHash)) {
    if (user && user.lockedUntil <= now) {
      const failures = user.failedLoginCount + 1;
      const lockedUntil = failures >= 5 ? now + 10 * 60 * 1000 : 0;
      await env.DB!.prepare("UPDATE users SET failed_login_count=?,locked_until=?,updated_at=? WHERE id=?")
        .bind(failures >= 5 ? 0 : failures, lockedUntil, now, user.id).run();
    }
    await auditLog(request, "auth.login_failed", "user", user?.id, user?.id, { nickname: normalizeNickname(nickname) }).catch(() => undefined);
    return Response.json({ error: "닉네임 또는 비밀번호를 확인해주세요. 5회 실패하면 10분간 잠깁니다." }, { status: 401 });
  }

  await env.DB!.prepare("UPDATE users SET failed_login_count=0,locked_until=0,updated_at=? WHERE id=?").bind(now, user.id).run();
  await auditLog(request, "auth.login_succeeded", "user", user.id, user.id).catch(() => undefined);
  return Response.json(
    { user: { id: user.id, nickname: user.nickname, role: user.role } },
    { headers: { "set-cookie": await createSession(user.id), "cache-control": "no-store" } },
  );
}
