import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, naverAutocompleteQueryForForeignCode, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";

type NewsItem = { title: string; link: string; publishedAt: number; source: string };

type FetchResult = { data: unknown; stale: boolean };

function text(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collect(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 7 || output.length >= 400 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") collect(child, depth + 1, output);
  return output;
}

function codeKey(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

async function resolveReutersCode(symbol: string, exchange: string) {
  if (symbol.includes(".") || looksLikeCaseSensitiveReutersCode(symbol)) return normalizeNaverReutersCode(symbol);
  try {
    const query = naverAutocompleteQueryForForeignCode(symbol);
    const result = await naverJson<unknown>(buildNaverPath("/api/autocomplete/search/autoComplete", { query, target: "stock" }), {
      ttlMs: 24 * 60 * 60_000,
      staleMs: 7 * 24 * 60 * 60_000,
      timeoutMs: 2_000,
    });
    const wanted = codeKey(query);
    const rows = collect(result.data).map(record => ({
      reuters: text(record, ["reutersCode", "reuterscode"]),
      ticker: text(record, ["ticker", "symbol", "itemCode", "stockCode", "code"]),
      nation: text(record, ["nationType", "nation", "country", "marketType"]),
    })).filter(item => item.reuters);
    const found = rows.find(item => codeKey(item.ticker) === wanted || codeKey(item.reuters.split(".")[0]) === wanted)
      ?? rows.find(item => /USA|US|미국/i.test(item.nation))
      ?? rows[0];
    if (found?.reuters) return normalizeNaverReutersCode(found.reuters);
  } catch {
    // Continue with the exchange-based Reuters suffix fallback.
  }
  const venue = exchange.toUpperCase();
  const suffix = venue.includes("NYS") || venue.includes("NYSE") ? ".N" : venue.includes("AMS") || venue.includes("AMEX") ? ".A" : ".O";
  return normalizeNaverReutersCode(`${symbol.replaceAll("_", ".")}${suffix}`);
}

function parsePublishedAt(record: Record<string, unknown>) {
  for (const key of [
    "publishedAt", "publishDateTime", "publishedDate", "publishDate", "releasedAt", "writeDate",
    "createdAt", "createdDate", "regDate", "datetime", "dateTime", "date",
  ]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1_000 : value;
    if (typeof value !== "string" || !value.trim()) continue;
    const clean = value.trim();
    const parsed = Date.parse(clean);
    if (Number.isFinite(parsed)) return parsed;
    const digits = clean.replace(/\D/g, "");
    if (digits.length >= 8) {
      const hhmmss = digits.slice(8, 14).padEnd(6, "0");
      const normalized = Date.parse(`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${hhmmss.slice(0,2)}:${hhmmss.slice(2,4)}:${hhmmss.slice(4,6)}+09:00`);
      if (Number.isFinite(normalized)) return normalized;
    }
  }
  return 0;
}

function articleLink(record: Record<string, unknown>, title: string) {
  const raw = text(record, ["url", "link", "href", "articleUrl", "articleLink", "newsUrl"]);
  if (/^https:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://stock.naver.com${raw}`;
  const oid = text(record, ["oid", "officeId", "officeCode"]);
  const aid = text(record, ["aid", "articleId", "newsId", "id"]);
  if (/^\d+$/.test(oid) && /^[A-Za-z0-9_-]+$/.test(aid)) return `https://n.news.naver.com/mnews/article/${oid}/${aid}`;
  return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(title)}`;
}

function normalize(payload: unknown) {
  const items = collect(payload).map((record): NewsItem | null => {
    const title = text(record, ["title", "articleTitle", "headline", "newsTitle", "subject", "articleSubject", "contentTitle"]);
    if (!title || title.length < 4) return null;
    return {
      title,
      link: articleLink(record, title),
      publishedAt: parsePublishedAt(record),
      source: text(record, ["officeName", "pressName", "press", "source", "providerName", "mediaName", "publisherName"]) || "네이버증권",
    };
  }).filter((item): item is NewsItem => Boolean(item));

  return items
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item, index, all) => all.findIndex(other => other.title === item.title) === index);
}

async function settled(path: string): Promise<FetchResult | null> {
  try {
    const result = await naverJson<unknown>(path, { ttlMs: 90_000, staleMs: 15 * 60_000, timeoutMs: 2_500 });
    return { data: result.data, stale: result.stale };
  } catch {
    return null;
  }
}

async function usNews(symbol: string, exchange: string) {
  const code = await resolveReutersCode(symbol, exchange);
  const paths = [
    buildNaverPath("/api/foreign/worldStock/list", { reutersCode: code, page: 1, pageSize: 20 }),
    buildNaverPath("/api/domestic/detail/news", { itemCode: code, page: 1, pageSize: 20 }),
  ];
  const related = await Promise.all(paths.map(settled));
  let items = related.flatMap(result => result ? normalize(result.data) : []);
  let stale = related.some(result => result?.stale);
  items = items.filter((item, index, all) => all.findIndex(other => other.title === item.title) === index)
    .sort((a, b) => b.publishedAt - a.publishedAt);

  if (!items.length) {
    const fallback = await settled(buildNaverPath("/api/foreign/news/worldNews", { page: 1, pageSize: 20 }));
    if (fallback) {
      items = normalize(fallback.data);
      stale = stale || fallback.stale;
    }
  }
  return { items: items.slice(0, 20), stale };
}

export async function getNaverMarketNews(market: "KR" | "US" | "CRYPTO", symbol: string, name: string, exchange: string) {
  if (market === "US") return usNews(symbol, exchange);
  if (market === "CRYPTO") {
    const ticker = symbol.replace(/^KRW-/, "").split("_")[0] || "BTC";
    const result = await settled(buildNaverPath(`/api/coin/globalNews/${encodeURIComponent(ticker)}`, { pageSize: 20 }));
    return { items: result ? normalize(result.data).slice(0, 20) : [], stale: Boolean(result?.stale) };
  }

  const primary = symbol
    ? await settled(buildNaverPath("/api/domestic/detail/news", { itemCode: symbol, page: 1, pageSize: 20 }))
    : await settled(buildNaverPath("/api/domestic/news/list", { category: "MAINNEWS", page: 1, pageSize: 20 }));
  let items = primary ? normalize(primary.data) : [];
  let stale = Boolean(primary?.stale);
  if (!items.length && name) {
    const fallback = await settled(buildNaverPath("/api/domestic/news/search", { query: name, page: 1, pageSize: 20 }));
    if (fallback) {
      items = normalize(fallback.data);
      stale = stale || fallback.stale;
    }
  }
  return { items: items.slice(0, 20), stale };
}
