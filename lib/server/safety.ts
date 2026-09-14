import { env } from "cloudflare:workers";

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes.slice(0, 12), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try { if (new URL(origin).host === new URL(request.url).host) return; } catch { /* rejected below */ }
  throw new Error("INVALID_ORIGIN");
}

export async function enforceRateLimit(request: Request, bucket: string, limit: number, windowMs: number, userId?: string) {
  if (!env.DB) return;
  const identity = userId || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${bucket}:${await sha256(identity)}`;
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO rate_limits (key,count,window_started_at,expires_at) VALUES (?,1,?,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.expires_at<=? THEN 1 ELSE rate_limits.count+1 END,
      window_started_at=CASE WHEN rate_limits.expires_at<=? THEN excluded.window_started_at ELSE rate_limits.window_started_at END,
      expires_at=CASE WHEN rate_limits.expires_at<=? THEN excluded.expires_at ELSE rate_limits.expires_at END`)
    .bind(key, now, now + windowMs, now, now, now).run();
  const row = await env.DB.prepare("SELECT count,expires_at AS expiresAt FROM rate_limits WHERE key=?").bind(key).first<{count:number;expiresAt:number}>();
  if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(now - 86_400_000).run().catch(() => undefined);
  }
  if (row && row.count > limit) {
    const error = new Error("RATE_LIMITED");
    (error as Error & { retryAfter?: number }).retryAfter = Math.max(1, Math.ceil((row.expiresAt - now) / 1000));
    throw error;
  }
}

export async function auditLog(request: Request, action: string, targetType: string, targetId?: string | null, actorUserId?: string | null, details: Record<string, unknown> = {}) {
  if (!env.DB) return;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const safeDetails = JSON.stringify(details).slice(0, 1_000);
  await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,action,target_type,target_id,details,ip_hash,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actorUserId ?? null, action, targetType, targetId ?? null, safeDetails, await sha256(ip), Date.now()).run();
}
