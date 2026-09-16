import { apiError, requireUser } from "@/lib/server/auth";
import { buildNaverPath, isNaverStockUnavailable, naverJson } from "@/lib/server/naver-stock";
import { enforceRateLimit } from "@/lib/server/safety";

type NewsItem = { title: string; link: string; publishedAt: number; source: string };

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collectRows(payload: unknown) {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === "object") as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["items", "contents", "news", "articles", "list", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(item => item && typeof item === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

function publishedAt(record: Record<string, unknown>, index: number) {
  for (const key of ["publishedAt", "publishDateTime", "releasedAt", "datetime", "dateTime", "createdAt", "date"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1_000 : value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
      const digits = value.replace(/\D/g, "");
      if (digits.length >= 8) {
        const time = digits.slice(8, 14).padEnd(6, "0");
        const normalized = Date.parse(`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}+09:00`);
        if (Number.isFinite(normalized)) return normalized;
      }
    }
  }
  return Date.now() - index;
}

function articleLink(record: Record<string, unknown>, title: string) {
  const raw = stringValue(record, ["url", "link", "href", "articleUrl", "newsUrl"]);
  if (raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `https://stock.naver.com${raw}`;
  const oid = stringValue(record, ["oid", "officeId"]);
  const aid = stringValue(record, ["aid", "articleId", "id"]);
  if (oid && aid && /^\d+$/.test(oid) && /^[A-Za-z0-9_-]+$/.test(aid)) return `https://n.news.naver.com/mnews/article/${oid}/${aid}`;
  return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(title)}`;
}

function normalizeNews(payload: unknown) {
  const items = collectRows(payload).map((record, index): NewsItem | null => {
    const title = stringValue(record, ["title", "articleTitle", "headline", "newsTitle", "subject"]);
    if (!title) return null;
    return {
      title,
      link: articleLink(record, title),
      publishedAt: publishedAt(record, index),
      source: stringValue(record, ["officeName", "pressName", "source", "providerName", "mediaName"]) || "네이버증권",
    };
  }).filter((item): item is NewsItem => Boolean(item));
  return items.sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item, index, all) => all.findIndex(other => other.title === item.title) === index)
    .slice(0, 20);
}

async function fetchNaverNews(market: string, symbol: string, name: string) {
  if (market === "CRYPTO") {
    const ticker = symbol.replace(/^KRW-/, "").split("_")[0] || "BTC";
    return naverJson<unknown>(buildNaverPath(`/api/coin/globalNews/${encodeURIComponent(ticker)}`, { pageSize: 20 }), { ttlMs: 90_000, staleMs: 15 * 60_000 });
  }
  if (name) {
    return naverJson<unknown>(buildNaverPath("/api/domestic/news/search", { query: name, page: 1, pageSize: 20 }), { ttlMs: 90_000, staleMs: 15 * 60_000 });
  }
  if (market === "US") {
    return naverJson<unknown>(buildNaverPath("/api/foreign/news/worldNews", { page: 1, pageSize: 20 }), { ttlMs: 90_000, staleMs: 15 * 60_000 });
  }
  if (symbol) {
    return naverJson<unknown>(buildNaverPath("/api/domestic/detail/news", { itemCode: symbol, page: 1, pageSize: 20 }), { ttlMs: 90_000, staleMs: 15 * 60_000 });
  }
  return naverJson<unknown>(buildNaverPath("/api/domestic/news/list", { category: "MAINNEWS", page: 1, pageSize: 20 }), { ttlMs: 90_000, staleMs: 15 * 60_000 });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "news", 40, 5 * 60_000, user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") ?? "KR";
    const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().slice(0, 32);
    const name = (url.searchParams.get("name") ?? "").slice(0, 80);
    if (!["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "시장을 확인해주세요." }, { status: 400 });
    const result = await fetchNaverNews(market, symbol, name);
    const items = normalizeNews(result.data);
    return Response.json({ items, source: "NAVER", stale: result.stale }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (error) {
    if (isNaverStockUnavailable(error)) {
      return Response.json({ items: [], source: "NAVER", error: "네이버증권 뉴스를 불러오지 못했습니다." }, { status: 503, headers: { "retry-after": "30" } });
    }
    return apiError(error);
  }
}
