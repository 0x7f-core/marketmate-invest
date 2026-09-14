import { env } from "cloudflare:workers";
import { apiError, hashPin, requireAdmin, verifyPin } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "admin_pin", 5, 10 * 60 * 1000, admin.id);
    const body = await request.json() as { currentPin?: string; newPin?: string };
    if (!/^\d{4}$/.test(body.currentPin ?? "") || !/^\d{4}$/.test(body.newPin ?? "")) return Response.json({ error: "PIN은 숫자 4자리여야 합니다." }, { status: 400 });
    const credentials = await env.DB!.prepare("SELECT pin_hash AS pinHash,pin_salt AS pinSalt FROM users WHERE id=?").bind(admin.id).first<{pinHash:string;pinSalt:string}>();
    if (!credentials || !await verifyPin(body.currentPin!, credentials.pinSalt, credentials.pinHash)) return Response.json({ error: "현재 PIN이 맞지 않습니다." }, { status: 401 });
    const next = await hashPin(body.newPin!);
    await env.DB!.prepare("UPDATE users SET pin_hash=?,pin_salt=?,updated_at=? WHERE id=?").bind(next.hash, next.salt, Date.now(), admin.id).run();
    await auditLog(request, "admin.pin_changed", "user", admin.id, admin.id).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
