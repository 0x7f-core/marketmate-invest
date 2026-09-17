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

const NAVER_NEWS_OFFICES: Record<string, string> = {
  "001": "연합뉴스",
  "002": "프레시안",
  "003": "뉴시스",
  "005": "국민일보",
  "006": "미디어오늘",
  "007": "일다",
  "008": "머니투데이",
  "009": "매일경제",
  "011": "서울경제",
  "014": "파이낸셜뉴스",
  "015": "한국경제",
  "016": "헤럴드경제",
  "018": "이데일리",
  "020": "동아일보",
  "021": "문화일보",
  "022": "세계일보",
  "023": "조선일보",
  "025": "중앙일보",
  "028": "한겨레",
  "029": "디지털타임스",
  "030": "전자신문",
  "031": "아이뉴스24",
  "032": "경향신문",
  "036": "한겨레21",
  "037": "주간동아",
  "044": "코리아헤럴드",
  "047": "오마이뉴스",
  "050": "한경비즈니스",
  "052": "YTN",
  "053": "주간조선",
  "055": "SBS",
  "056": "KBS",
  "057": "MBN",
  "079": "노컷뉴스",
  "081": "서울신문",
  "082": "부산일보",
  "087": "강원일보",
  "088": "매일신문",
  "092": "지디넷코리아",
  "094": "월간산",
  "119": "데일리안",
  "123": "조세일보",
  "127": "기자협회보",
  "138": "디지털데일리",
  "152": "참세상",
  "214": "MBC",
  "215": "한국경제TV",
  "243": "이코노미스트",
  "262": "신동아",
  "277": "아시아경제",
  "293": "블로터",
  "296": "코메디닷컴",
  "308": "시사IN",
  "310": "여성신문",
  "346": "헬스조선",
  "353": "중앙SUNDAY",
  "366": "조선비즈",
  "374": "SBS Biz",
  "417": "머니S",
  "421": "뉴스1",
  "422": "연합뉴스TV",
  "437": "JTBC",
  "448": "TV조선",
  "449": "채널A",
  "469": "한국일보",
  "584": "동아사이언스",
  "586": "시사저널",
  "607": "뉴스타파",
  "629": "더팩트",
  "640": "코리아중앙데일리",
  "648": "비즈워치",
};

const SOURCE_NAME_KEYS = [
  "officeName", "pressName", "mediaName", "publisherName", "providerName", "sourceName",
  "newsOfficeName", "newsAgencyName", "companyName",
];
const SOURCE_CONTAINER_KEYS = ["office", "press", "media", "publisher", "provider", "source", "newsOffice", "newsAgency", "company"];
const SOURCE_CODE_KEYS = [
  "oid", "officeId", "officeCode", "pressId", "pressCode", "mediaId", "mediaCode",
  "publisherId", "publisherCode", "providerId", "providerCode", "sourceId", "sourceCode", "source",
];

function sourceFromOfficeCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const clean = String(value).trim();
  if (!/^\d{1,3}$/.test(clean)) return "";
  return NAVER_NEWS_OFFICES[clean.padStart(3, "0")] ?? "";
}

function cleanSourceName(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const clean = String(value).trim();
  if (!clean || /^(?:NAVER|네이버증권)$/i.test(clean)) return "";
  const mapped = sourceFromOfficeCode(clean);
  if (mapped) return mapped;
  if (/^\d+$/.test(clean)) return "";
  return clean;
}

function sourceValue(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return cleanSourceName(value);
  if (typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as Record<string, unknown>;
  for (const key of SOURCE_NAME_KEYS) {
    const direct = cleanSourceName(record[key]);
    if (direct) return direct;
  }
  for (const key of SOURCE_CODE_KEYS) {
    const mapped = sourceFromOfficeCode(record[key]);
    if (mapped) return mapped;
  }
  for (const key of SOURCE_CONTAINER_KEYS) {
    const nested = sourceValue(record[key], depth + 1);
    if (nested) return nested;
  }
  for (const [key, nestedValue] of Object.entries(record)) {
    if (!/(?:office|press|media|publisher|provider|source|agency|company)/i.test(key)) continue;
    const nested = sourceValue(nestedValue, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function newsSource(record: Record<string, unknown>) {
  for (const key of SOURCE_NAME_KEYS) {
    const direct = cleanSourceName(record[key]);
    if (direct) return direct;
  }
  for (const key of SOURCE_CODE_KEYS) {
    const mapped = sourceFromOfficeCode(record[key]);
    if (mapped) return mapped;
  }
  for (const key of SOURCE_CONTAINER_KEYS) {
    const nested = sourceValue(record[key]);
    if (nested) return nested;
  }
  for (const [key, value] of Object.entries(record)) {
    if (!/(?:office|press|media|publisher|provider|source|agency|company)/i.test(key)) continue;
    const nested = sourceValue(value);
    if (nested) return nested;
  }
  return "네이버증권";
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

function parseKstDateTime(value: string, timeValue = "") {
  const clean = value.trim();
  if (!clean) return 0;
  const combined = timeValue.trim() ? `${clean} ${timeValue.trim()}` : clean;

  // Naver Stock commonly returns Korean local wall-clock time without an offset.
  // Cloudflare Workers run in UTC, so Date.parse() on those strings makes them
  // appear about nine hours in the future and the UI collapses them to "방금 전".
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(combined)) {
    const explicit = Date.parse(combined);
    if (Number.isFinite(explicit)) return explicit;
  }

  if (/^\d{4}(?:[-./]?\d{1,2}){2}/.test(combined)) {
    const digits = combined.replace(/\D/g, "");
    if (digits.length >= 8) {
      const dateDigits = digits.slice(0, 8);
      const timeDigits = timeValue.trim()
        ? timeValue.replace(/\D/g, "").slice(0, 6).padEnd(6, "0")
        : digits.slice(8, 14).padEnd(6, "0");
      const normalized = Date.parse(
        `${dateDigits.slice(0,4)}-${dateDigits.slice(4,6)}-${dateDigits.slice(6,8)}T${timeDigits.slice(0,2)}:${timeDigits.slice(2,4)}:${timeDigits.slice(4,6)}+09:00`,
      );
      if (Number.isFinite(normalized)) return normalized;
    }
  }

  const parsed = Date.parse(combined);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePublishedAt(record: Record<string, unknown>) {
  const datePart = text(record, ["publishedDate", "publishDate", "writeDate", "createdDate", "regDate", "date"]);
  const timePart = text(record, ["publishedTime", "publishTime", "writeTime", "createdTime", "regTime", "time"]);
  if (datePart && timePart) {
    const paired = parseKstDateTime(datePart, timePart);
    if (paired) return paired;
  }

  for (const key of [
    "publishedAt", "publishDateTime", "publishedDateTime", "publishedDate", "publishDate", "releasedAt", "writeDateTime", "writeDate",
    "createdAt", "createdDateTime", "createdDate", "regDateTime", "regDate", "datetime", "dateTime", "date",
  ]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value >= 1_000_000_000_000) return value;
      if (value >= 1_000_000_000) return value * 1_000;
      const compactDate = String(Math.trunc(value));
      if (/^\d{8}$/.test(compactDate)) {
        const parsedDate = parseKstDateTime(compactDate, timePart);
        if (parsedDate) return parsedDate;
      }
      continue;
    }
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = parseKstDateTime(value, key.toLowerCase().endsWith("date") ? timePart : "");
    if (parsed) return parsed;
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
      source: newsSource(record),
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
