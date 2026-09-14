import { env } from "cloudflare:workers";
import { createSession, hashPin, normalizeNickname, validateCredentials } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";

export async function POST(request: Request) {
  try { assertSameOrigin(request); await enforceRateLimit(request, "register", 5, 60 * 60 * 1000); }
  catch { return Response.json({ error: "가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 }); }
  const body = await request.json().catch(() => ({})) as { nickname?: string; pin?: string };
  const nickname = String(body.nickname ?? "").normalize("NFKC").trim();
  const pin = String(body.pin ?? "");
  const validationError = validateCredentials(nickname, pin);
  if (validationError) return Response.json({ error: validationError }, { status: 400 });

  const normalized = normalizeNickname(nickname);
  const existing = await env.DB!.prepare("SELECT 1 FROM users WHERE nickname_normalized=?").bind(normalized).first();
  if (existing) return Response.json({ error: "이미 사용 중인 닉네임입니다." }, { status: 409 });

  const id = crypto.randomUUID();
  const now = Date.now();
  const credentials = await hashPin(pin);
  try {
    await env.DB!.prepare(
      `INSERT INTO users (id,email,nickname,nickname_normalized,pin_hash,pin_salt,role,is_active,failed_login_count,locked_until,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'member',1,0,0,?,?)`,
    ).bind(id, `${id}@marketmate.local`, nickname, normalized, credentials.hash, credentials.salt, now, now).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) return Response.json({ error: "이미 사용 중인 닉네임입니다." }, { status: 409 });
    throw error;
  }

  await auditLog(request, "auth.registered", "user", id, id, { nickname }).catch(() => undefined);
  return Response.json(
    { user: { id, nickname, role: "member" } },
    { status: 201, headers: { "set-cookie": await createSession(id), "cache-control": "no-store" } },
  );
}
