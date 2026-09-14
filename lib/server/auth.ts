import { env } from "cloudflare:workers";

export type RequestUser = { id: string; nickname: string };

const SESSION_COOKIE = "marketmate_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PIN_ITERATIONS = 100_000;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function parseCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function sha256(value: string) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export function normalizeNickname(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
}

export function validateCredentials(nickname: string, pin: string) {
  const display = nickname.normalize("NFKC").trim();
  if (!/^[가-힣a-zA-Z0-9_]{2,12}$/.test(display)) return "닉네임은 한글·영문·숫자·밑줄 2~12자로 입력해주세요.";
  if (!/^\d{4}$/.test(pin)) return "비밀번호는 숫자 4자리로 입력해주세요.";
  return null;
}

export async function hashPin(pin: string, salt?: string) {
  const saltValue = salt ?? bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(saltValue), iterations: PIN_ITERATIONS },
    key,
    256,
  );
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt: saltValue };
}

export async function verifyPin(pin: string, salt: string, expectedHash: string) {
  const { hash } = await hashPin(pin, salt);
  if (hash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < hash.length; index += 1) difference |= hash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}

export async function createSession(userId: string) {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = Date.now();
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
    env.DB!.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)")
      .bind(tokenHash, userId, now + SESSION_MAX_AGE_SECONDS * 1000, now, now),
  ]);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getSessionUser(request: Request): Promise<RequestUser | null> {
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const user = await env.DB!.prepare(
    `SELECT u.id,u.nickname,s.expires_at AS expiresAt
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=?`,
  ).bind(tokenHash).first<{ id: string; nickname: string; expiresAt: number }>();
  if (!user || user.expiresAt <= now) {
    await env.DB!.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
    return null;
  }
  await env.DB!.prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=? AND last_seen_at<?")
    .bind(now, tokenHash, now - 60 * 60 * 1000).run();
  return { id: user.id, nickname: user.nickname };
}

export async function deleteSession(request: Request) {
  const token = parseCookie(request, SESSION_COOKIE);
  if (token) await env.DB!.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
}

export async function requireUser(request: Request): Promise<RequestUser> {
  const user = await getSessionUser(request);
  if (!user) throw new Error("AUTH_REQUIRED");
  return user;
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "NOT_FOUND") return Response.json({ error: "요청한 정보를 찾을 수 없습니다." }, { status: 404 });
  if (message === "FORBIDDEN") return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  return Response.json({ error: "요청을 처리하지 못했습니다." }, { status: 500 });
}
