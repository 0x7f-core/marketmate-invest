import { env } from "cloudflare:workers";
import { apiError, hashPin, normalizeNickname, requireUser, verifyPin } from "@/lib/server/auth";
import { assertSameOrigin, auditLog, enforceRateLimit } from "@/lib/server/safety";

function validateNickname(value: string) {
  const display = value.normalize("NFKC").trim();
  return /^[가-힣a-zA-Z0-9_]{2,12}$/.test(display)
    ? null
    : "닉네임은 한글·영문·숫자·밑줄 2~12자로 입력해주세요.";
}

function validatePin(value: string) {
  return /^\d{4}$/.test(value) ? null : "비밀번호는 숫자 4자리로 입력해주세요.";
}

async function hasActiveCompetition(userId: string) {
  const row = await env.DB!.prepare(
    `SELECT COUNT(*) AS count
     FROM participants p
     JOIN competitions c ON c.id=p.competition_id
     WHERE p.user_id=? AND c.status='active' AND c.ends_at>?`,
  ).bind(userId, Date.now()).first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "account_read", 60, 60_000, user.id);
    return Response.json(
      { user, nicknameLocked: await hasActiveCompetition(user.id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    assertSameOrigin(request);
    await enforceRateLimit(request, "account_update", 10, 60 * 60 * 1000, user.id);

    const body = await request.json().catch(() => ({})) as {
      currentPin?: string;
      nickname?: string;
      newPin?: string;
    };
    const currentPin = String(body.currentPin ?? "");
    const requestedNickname = body.nickname === undefined
      ? user.nickname
      : String(body.nickname).normalize("NFKC").trim();
    const newPin = body.newPin === undefined ? "" : String(body.newPin);

    if (validatePin(currentPin)) {
      return Response.json({ error: "현재 비밀번호를 확인해주세요." }, { status: 400 });
    }

    const account = await env.DB!.prepare(
      "SELECT nickname,pin_hash AS pinHash,pin_salt AS pinSalt FROM users WHERE id=? AND is_active=1",
    ).bind(user.id).first<{ nickname: string; pinHash: string; pinSalt: string }>();
    if (!account || !await verifyPin(currentPin, account.pinSalt, account.pinHash)) {
      return Response.json({ error: "현재 비밀번호가 일치하지 않습니다." }, { status: 401 });
    }

    const nicknameChanged = requestedNickname !== account.nickname;
    const pinChanged = newPin.length > 0;
    if (!nicknameChanged && !pinChanged) {
      return Response.json({ error: "변경할 내용을 입력해주세요." }, { status: 400 });
    }

    if (nicknameChanged) {
      const nicknameError = validateNickname(requestedNickname);
      if (nicknameError) return Response.json({ error: nicknameError }, { status: 400 });
      if (await hasActiveCompetition(user.id)) {
        return Response.json(
          { error: "참가 중인 대회가 있을 때는 닉네임을 변경할 수 없습니다.", nicknameLocked: true },
          { status: 409 },
        );
      }
      const normalized = normalizeNickname(requestedNickname);
      const duplicate = await env.DB!.prepare(
        "SELECT 1 FROM users WHERE nickname_normalized=? AND id<>?",
      ).bind(normalized, user.id).first();
      if (duplicate) return Response.json({ error: "이미 사용 중인 닉네임입니다." }, { status: 409 });
    }

    if (pinChanged) {
      const pinError = validatePin(newPin);
      if (pinError) return Response.json({ error: pinError }, { status: 400 });
      if (newPin === currentPin) {
        return Response.json({ error: "새 비밀번호는 현재 비밀번호와 다르게 설정해주세요." }, { status: 400 });
      }
    }

    const now = Date.now();
    const statements = [];
    if (nicknameChanged) {
      statements.push(
        env.DB!.prepare("UPDATE users SET nickname=?,nickname_normalized=?,updated_at=? WHERE id=?")
          .bind(requestedNickname, normalizeNickname(requestedNickname), now, user.id),
      );
    }
    if (pinChanged) {
      const credentials = await hashPin(newPin);
      statements.push(
        env.DB!.prepare("UPDATE users SET pin_hash=?,pin_salt=?,failed_login_count=0,locked_until=0,updated_at=? WHERE id=?")
          .bind(credentials.hash, credentials.salt, now, user.id),
      );
    }

    try {
      await env.DB!.batch(statements);
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return Response.json({ error: "이미 사용 중인 닉네임입니다." }, { status: 409 });
      }
      throw error;
    }

    const nickname = nicknameChanged ? requestedNickname : account.nickname;
    await auditLog(request, "auth.account_updated", "user", user.id, user.id, {
      nicknameChanged,
      pinChanged,
    }).catch(() => undefined);

    return Response.json(
      { user: { ...user, nickname }, nicknameLocked: await hasActiveCompetition(user.id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
