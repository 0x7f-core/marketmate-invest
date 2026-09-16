import { buildNaverPath, naverJson, type NaverResult } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, naverAutocompleteQueryForForeignCode, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";

export type MarketInsightKind =
  | "domestic-detail"
  | "domestic-price"
  | "domestic-investor"
  | "domestic-broker"
  | "domestic-disclosure"
  | "domestic-consensus"
  | "domestic-finance-menu"
  | "domestic-esg"
  | "domestic-etf-list"
  | "domestic-etf-detail"
  | "domestic-etf-components"
  | "domestic-ranking"
  | "foreign-basic"
  | "foreign-overview"
  | "foreign-consensus"
  | "foreign-finance"
  | "foreign-etf-list"
  | "foreign-etf-components"
  | "foreign-sector-ranking"
  | "crypto-ranking"
  | "indicators";

export type MarketInsightParams = {
  code?: string;
  symbol?: string;
  exchange?: string;
  section?: string;
  period?: string;
  category?: string;
  sort?: string;
  cursor?: string;
  size?: number;
  indicatorCodes?: string;
};

const DOMESTIC_CODE = /^[A-Z0-9]{6}$/;
const SYMBOL = /^[A-Za-z0-9._-]{1,32}$/;
const CURSOR = /^[A-Za-z0-9._~+=:/-]{1,512}$/;
const INDICATOR = /^\.?[A-Za-z0-9][A-Za-z0-9._=-]{0,31}$/;
const DOMESTIC_RANKING_CATEGORIES = new Set(["industries", "themes", "groups"]);
const DOMESTIC_RANKING_SORTS = new Set(["changeRate", "marketCap"]);
const FOREIGN_FINANCE_SECTIONS = new Set(["summary", "finance", "ratios", "balance", "income", "cash"]);
const FINANCE_PERIODS = new Set(["annual", "quarter"]);
const CRYPTO_SORTS = new Set(["top", "up", "down", "marketValue"]);

function boundedSize(value?: number, fallback = 20, max = 100) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function domesticCode(value?: string) {
  const code = (value ?? "").trim().toUpperCase().replace(/^A(?=\d{6}$)/, "");
  if (!DOMESTIC_CODE.test(code)) throw new Error("INVALID_DOMESTIC_CODE");
  return code;
}

function safeSymbol(value?: string) {
  const symbol = (value ?? "").trim();
  if (!SYMBOL.test(symbol)) throw new Error("INVALID_SYMBOL");
  return symbol;
}

function foreignEtfTicker(value?: string) {
  return safeSymbol(value).toUpperCase().replace(/\.(?:O|N|A)$/i, "");
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collectRecords(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 5 || output.length > 250 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => /(?:reuters|ticker|symbol|code|name)/i.test(key))) output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") collectRecords(child, depth + 1, output);
  return output;
}

function compareCode(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

const foreignCodeCache = new Map<string, { code: string; expiresAt: number }>();

async function resolveForeignCode(symbolInput?: string, exchangeInput?: string) {
  const symbol = safeSymbol(symbolInput);
  if (symbol.includes(".") || looksLikeCaseSensitiveReutersCode(symbol)) return normalizeNaverReutersCode(symbol);
  const cacheKey = `${symbol}:${(exchangeInput ?? "").toUpperCase()}`;
  const cached = foreignCodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.code;

  try {
    const query = naverAutocompleteQueryForForeignCode(symbol);
    const result = await naverJson<unknown>(
      buildNaverPath("/api/autocomplete/search/autoComplete", { query, target: "stock" }),
      { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 },
    );
    const wanted = compareCode(query);
    const candidates = collectRecords(result.data).map(record => ({
      code: stringValue(record, ["reutersCode", "reuterscode", "code"]),
      ticker: stringValue(record, ["ticker", "symbol", "itemCode", "stockCode", "code"]),
      nation: stringValue(record, ["nationType", "nation", "country", "marketType"]),
    })).filter(item => item.code.length > 0);
    const match = candidates.find(item => compareCode(item.ticker) === wanted || compareCode(item.code.split(".")[0]) === wanted)
      ?? candidates.find(item => /USA|US|미국/i.test(item.nation))
      ?? candidates[0];
    if (match?.code) {
      const code = normalizeNaverReutersCode(match.code);
      foreignCodeCache.set(cacheKey, { code, expiresAt: Date.now() + 24 * 60 * 60_000 });
      return code;
    }
  } catch {
    // Autocomplete changes must not turn a read-only detail request into a different provider fallback.
  }

  if (looksLikeCaseSensitiveReutersCode(symbol)) return normalizeNaverReutersCode(symbol);
  const exchange = (exchangeInput ?? "").toUpperCase();
  const suffix = exchange.includes("NYS") || exchange.includes("NYSE") ? ".N"
    : exchange.includes("AMS") || exchange.includes("AMEX") ? ".A" : ".O";
  return normalizeNaverReutersCode(`${symbol.replaceAll("_", ".")}${suffix}`);
}

function insight<T>(result: NaverResult<T>, kind: MarketInsightKind) {
  return {
    kind,
    source: "NAVER" as const,
    data: result.data,
    stale: result.stale,
    fetchedAt: result.fetchedAt,
    pollingInterval: result.pollingInterval,
  };
}

export async function getNaverMarketInsight(kind: MarketInsightKind, params: MarketInsightParams) {
  const size = boundedSize(params.size);

  switch (kind) {
    case "domestic-detail": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(buildNaverPath(`/api/domestic/detail/${code}/detail`, { codeType: "KRX" }), { ttlMs: 60_000, staleMs: 15 * 60_000 }), kind);
    }
    case "domestic-price": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(`/api/domestic/detail/${code}/price`, { ttlMs: 30_000, staleMs: 5 * 60_000 }), kind);
    }
    case "domestic-investor": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(buildNaverPath(`/api/domestic/detail/${code}/trend`, { tradeType: "KRX", startIdx: 0, pageSize: size }), { ttlMs: 60_000, staleMs: 10 * 60_000 }), kind);
    }
    case "domestic-broker": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(`/api/domestic/detail/${code}/traderInfo`, { ttlMs: 60_000, staleMs: 10 * 60_000 }), kind);
    }
    case "domestic-disclosure": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(buildNaverPath("/api/domestic/detail/notice", { itemCode: code, startIdx: 0, pageSize: size }), { ttlMs: 60_000, staleMs: 15 * 60_000 }), kind);
    }
    case "domestic-consensus": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(`/api/domestic/detail/${code}/consensus`, { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }), kind);
    }
    case "domestic-finance-menu": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(`/api/stockSecurity/finances/v1/domestic/${code}/menu-info`, { ttlMs: 10 * 60_000, staleMs: 6 * 60 * 60_000 }), kind);
    }
    case "domestic-esg": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(`/api/stockSecurity/finances/v1/domestic/${code}/esg`, { ttlMs: 30 * 60_000, staleMs: 24 * 60 * 60_000 }), kind);
    }
    case "domestic-etf-list": {
      return insight(await naverJson<unknown>(buildNaverPath("/api/stockSecurity/etfs/v2/domestic", { listingType: "tradingValueDesc", size, index: 0 }), { ttlMs: 60_000, staleMs: 15 * 60_000 }), kind);
    }
    case "domestic-etf-detail": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(`/api/domestic/detail/${code}/ETFBase`, { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }), kind);
    }
    case "domestic-etf-components": {
      const code = domesticCode(params.code ?? params.symbol);
      return insight(await naverJson<unknown>(buildNaverPath(`/api/domestic/detail/${code}/ETFComponent`, { startIdx: 0, pageSize: size }), { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }), kind);
    }
    case "domestic-ranking": {
      const category = DOMESTIC_RANKING_CATEGORIES.has(params.category ?? "") ? params.category! : "themes";
      const sortType = DOMESTIC_RANKING_SORTS.has(params.sort ?? "") ? params.sort! : "changeRate";
      const cursor = params.cursor && CURSOR.test(params.cursor) ? params.cursor : undefined;
      return insight(await naverJson<unknown>(buildNaverPath(`/api/stockSecurity/rankings/v2/domestic/${category}`, {
        sortType,
        size,
        excludeCodes: 25,
        period: "daily",
        cursor,
      }), { ttlMs: 30_000, staleMs: 10 * 60_000 }), kind);
    }
    case "foreign-basic":
    case "foreign-overview":
    case "foreign-consensus": {
      const code = await resolveForeignCode(params.symbol ?? params.code, params.exchange);
      const section = kind === "foreign-basic" ? "basic" : kind === "foreign-overview" ? "overview" : "consensus";
      return insight(await naverJson<unknown>(`/api/securityService/stock/${encodeURIComponent(code)}/${section}`, { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }), kind);
    }
    case "foreign-finance": {
      const code = await resolveForeignCode(params.symbol ?? params.code, params.exchange);
      const section = FOREIGN_FINANCE_SECTIONS.has(params.section ?? "") ? params.section! : "summary";
      const period = FINANCE_PERIODS.has(params.period ?? "") ? params.period! : "annual";
      const path = section === "summary"
        ? "/api/securityService/stock/finance/summary"
        : section === "finance"
          ? `/api/securityService/stock/finance/${period}`
          : `/api/securityService/stock/finance/${section}/${period}`;
      return insight(await naverJson<unknown>(buildNaverPath(path, { reutersCode: code }), { ttlMs: 10 * 60_000, staleMs: 6 * 60 * 60_000 }), kind);
    }
    case "foreign-etf-list": {
      return insight(await naverJson<unknown>(buildNaverPath("/api/foreign/market/etf/usa", {
        orderType: "marketValue",
        largeCode: "all",
        middleCode: "all",
        startIdx: 0,
        pageSize: size,
      }), { ttlMs: 60_000, staleMs: 15 * 60_000 }), kind);
    }
    case "foreign-etf-components": {
      const code = foreignEtfTicker(params.symbol ?? params.code);
      return insight(await naverJson<unknown>(`/api/stockSecurity/etfs/v2/foreign/${encodeURIComponent(code)}/composition`, { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }), kind);
    }
    case "foreign-sector-ranking": {
      const sortType = params.sort === "marketCap" ? "marketCap" : "changeRate";
      const cursor = params.cursor && CURSOR.test(params.cursor) ? params.cursor : undefined;
      return insight(await naverJson<unknown>(buildNaverPath("/api/stockSecurity/rankings/v2/foreign/USA/sectors", {
        sortType,
        size,
        period: "daily",
        cursor,
      }), { ttlMs: 30_000, staleMs: 10 * 60_000 }), kind);
    }
    case "crypto-ranking": {
      const sortType = CRYPTO_SORTS.has(params.sort ?? "") ? params.sort! : "marketValue";
      return insight(await naverJson<unknown>(buildNaverPath("/api/coin/rank/UPBIT", { sortType, page: 1, pageSize: size }), { ttlMs: 30_000, staleMs: 5 * 60_000 }), kind);
    }
    case "indicators": {
      const raw = params.indicatorCodes || "KOSPI,KOSDAQ,.IXIC,.INX,FX_USDKRW";
      const codes = raw.split(",").map(value => value.trim()).filter(Boolean);
      if (!codes.length || codes.length > 20 || codes.some(code => !INDICATOR.test(code))) throw new Error("INVALID_INDICATOR_CODES");
      return insight(await naverJson<unknown>(buildNaverPath("/api/securityService/integration/indicators", { indicatorCodes: codes.join(",") }), { ttlMs: 30_000, staleMs: 10 * 60_000 }), kind);
    }
    default:
      throw new Error("INVALID_INSIGHT_KIND");
  }
}
