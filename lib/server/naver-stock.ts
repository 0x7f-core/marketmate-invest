const NAVER_STOCK_BASE_URL = "https://stock.naver.com";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

const PUBLIC_PREFIXES = [
  "/api/coin/",
  "/api/content/",
  "/api/domestic/",
  "/api/foreign/",
  "/api/polling/",
  "/api/securityAi/",
  "/api/securityFe/",
  "/api/securityService/",
  "/api/stockDomestic/",
  "/api/stockSecurity/",
];
const PUBLIC_EXACT_PATHS = new Set([
  "/api/autocomplete/search",
  "/api/autocomplete/search/autocomplete",
]);

const DENIED_SEGMENTS = new Set([
  "account", "accounts", "auth", "authorization", "block", "bookmark", "cancel", "create", "delete",
  "favorite", "favorites", "follow", "holding", "holdings", "like", "login", "logout", "member", "members",
  "myasset", "mystock", "notification", "notification-settings", "notifications", "order", "orders", "personal",
  "portfolio", "profile", "profiles", "reaction", "register", "report", "session", "settings", "subscribe",
  "unsubscribe", "update", "user", "users",
]);
const ENCODED_PATH_CONTROL = /%(?:00|0a|0d|2e|2f|5c)/i;

export class NaverStockError extends Error {
  statusCode?: number;
  kind: "http" | "timeout" | "network" | "invalid_json" | "empty" | "api" | "validation";
  path: string;
  retryAfterMs?: number;

  constructor(message: string, options: { path: string; statusCode?: number; retryAfterMs?: number; kind: NaverStockError["kind"] }) {
    super(message);
    this.name = "NaverStockError";
    this.path = options.path;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.kind = options.kind;
  }
}

type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
  pollingInterval?: number;
};

export type NaverResult<T> = {
  data: T;
  fetchedAt: number;
  stale: boolean;
  pollingInterval?: number;
};

type RequestOptions = {
  ttlMs?: number;
  staleMs?: number;
  timeoutMs?: number;
  respectPollingInterval?: boolean;
};

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<NaverResult<unknown>>>();

export function buildNaverPath(path: string, params?: Record<string, string | number | boolean | Array<string | number> | null | undefined>) {
  if (!params) return path;
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) query.append(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function validatePath(path: string) {
  const rawPathname = path.split("?", 1)[0];
  if (!path.startsWith("/api/") || path.includes("\\") || path.includes("\n") || path.includes("\r") || ENCODED_PATH_CONTROL.test(rawPathname)) {
    throw new NaverStockError("네이버증권 API 경로가 올바르지 않습니다.", { path, kind: "validation" });
  }
  const url = new URL(path, NAVER_STOCK_BASE_URL);
  if (url.origin !== NAVER_STOCK_BASE_URL || url.pathname.includes("..")) {
    throw new NaverStockError("네이버증권 API 경로가 허용 범위를 벗어났습니다.", { path, kind: "validation" });
  }
  const pathnameLower = url.pathname.toLocaleLowerCase("en-US");
  const segments = pathnameLower.split("/").filter(Boolean);
  if (segments.some(segment => DENIED_SEGMENTS.has(segment))) {
    throw new NaverStockError("개인화 또는 변경 API는 호출하지 않습니다.", { path, kind: "validation" });
  }
  const allowed = PUBLIC_EXACT_PATHS.has(pathnameLower)
    || PUBLIC_PREFIXES.some(prefix => pathnameLower.startsWith(prefix.toLocaleLowerCase("en-US")));
  if (!allowed) throw new NaverStockError("공개 읽기 전용 API만 호출할 수 있습니다.", { path, kind: "validation" });
  return `${url.pathname}${url.search}`;
}

function pollingInterval(payload: unknown, fallback: number) {
  if (!payload || typeof payload !== "object") return fallback;
  const raw = Number((payload as Record<string, unknown>).pollingInterval);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  // 현재 공개 API는 ms 단위를 사용하지만 비정상적으로 작은 값은 초 단위 가능성까지 방어한다.
  const millis = raw < 100 ? raw * 1_000 : raw;
  return Math.max(1_000, Math.min(120_000, Math.round(millis)));
}

function retryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

async function fetchJson(path: string, timeoutMs: number) {
  const safePath = validatePath(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${NAVER_STOCK_BASE_URL}${safePath}`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
        referer: "https://stock.naver.com/",
        "user-agent": "Mozilla/5.0 MarketMate/2.0 (+public-read-only)",
      },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new NaverStockError("네이버증권 API 요청 시간이 초과되었습니다.", { path: safePath, kind: "timeout" });
    throw new NaverStockError("네이버증권 API에 연결할 수 없습니다.", { path: safePath, kind: "network" });
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new NaverStockError("네이버증권 API가 리다이렉트를 반환했습니다.", { path: safePath, statusCode: response.status, kind: "http" });
  }
  if (!response.ok) {
    throw new NaverStockError(
      response.status === 403 || response.status === 429
        ? `네이버증권 API가 HTTP ${response.status}로 요청을 제한했습니다.`
        : `네이버증권 API가 HTTP ${response.status}를 반환했습니다.`,
      { path: safePath, statusCode: response.status, retryAfterMs: retryAfterMs(response), kind: "http" },
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new NaverStockError("네이버증권 API 응답 크기가 제한을 초과했습니다.", { path: safePath, kind: "network" });
  }
  const text = await response.text();
  if (!text.trim()) throw new NaverStockError("네이버증권 API가 빈 응답을 반환했습니다.", { path: safePath, kind: "empty" });
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new NaverStockError("네이버증권 API 응답 크기가 제한을 초과했습니다.", { path: safePath, kind: "network" });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new NaverStockError("네이버증권 API가 JSON이 아닌 응답을 반환했습니다.", { path: safePath, kind: "invalid_json" });
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (record.detailCode || record.error) {
      throw new NaverStockError("네이버증권 API 오류 응답을 받았습니다.", { path: safePath, kind: "api" });
    }
  }
  return payload;
}

export async function naverJson<T>(path: string, options: RequestOptions = {}): Promise<NaverResult<T>> {
  const safePath = validatePath(path);
  const now = Date.now();
  const existing = cache.get(safePath) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return { data: existing.data, fetchedAt: existing.fetchedAt, stale: false, pollingInterval: existing.pollingInterval };
  }
  const pending = inflight.get(safePath) as Promise<NaverResult<T>> | undefined;
  if (pending) return pending;

  const ttlMs = Math.max(250, options.ttlMs ?? 5_000);
  const staleMs = Math.max(0, options.staleMs ?? 5 * 60_000);
  const timeoutMs = Math.max(1_000, Math.min(15_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const request = (async () => {
    try {
      const data = await fetchJson(safePath, timeoutMs) as T;
      const fetchedAt = Date.now();
      const interval = options.respectPollingInterval ? pollingInterval(data, ttlMs) : undefined;
      const expiresIn = interval ?? ttlMs;
      cache.set(safePath, { data, fetchedAt, expiresAt: fetchedAt + expiresIn, staleUntil: fetchedAt + expiresIn + staleMs, pollingInterval: interval });
      return { data, fetchedAt, stale: false, pollingInterval: interval };
    } catch (error) {
      const fallback = cache.get(safePath) as CacheEntry<T> | undefined;
      if (fallback && fallback.staleUntil > Date.now()) {
        return { data: fallback.data, fetchedAt: fallback.fetchedAt, stale: true, pollingInterval: fallback.pollingInterval };
      }
      throw error;
    } finally {
      inflight.delete(safePath);
    }
  })();
  inflight.set(safePath, request as Promise<NaverResult<unknown>>);
  return request;
}

export function naverPolling<T>(path: string, options: Omit<RequestOptions, "respectPollingInterval"> = {}) {
  return naverJson<T>(path, { ...options, ttlMs: options.ttlMs ?? 2_000, respectPollingInterval: true });
}

export function isNaverStockUnavailable(error: unknown) {
  return error instanceof NaverStockError && ["http", "timeout", "network", "invalid_json", "empty", "api"].includes(error.kind);
}
