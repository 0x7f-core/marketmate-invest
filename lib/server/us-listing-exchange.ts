import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { naverAutocompleteQueryForForeignCode, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";

export type UsListingExchange = "NAS" | "NYS" | "AMS" | "ARCA" | "CBOE" | "OTC";

const CACHE_TTL_MS = 24 * 60 * 60_000;
const exchangeCache = new Map<string, { exchange: UsListingExchange | ""; expiresAt: number }>();

function compact(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[\s._-]+/g, "");
}

export function normalizeUsListingExchange(value: unknown): UsListingExchange | "" {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const raw = String(value).normalize("NFKC").trim();
  if (!raw) return "";
  const normalized = compact(raw);

  // Generic country labels are not exchanges.
  if (["US", "USA", "UNITEDSTATES", "UNITEDSTATESOFAMERICA", "AMERICA", "미국"].includes(normalized)) return "";

  // More specific NYSE families must be checked before the generic NYSE match.
  if (
    normalized.includes("NYSEARCA")
    || normalized === "ARCA"
    || normalized === "PSE"
    || normalized.includes("PACIFICEXCHANGE")
  ) return "ARCA";
  if (
    normalized.includes("NYSEAMERICAN")
    || normalized.includes("AMERICANSTOCKEXCHANGE")
    || normalized.includes("AMEX")
    || ["AMS", "ASE"].includes(normalized)
  ) return "AMS";
  if (
    normalized.includes("CBOE")
    || normalized.includes("BATS")
    || normalized.includes("BZX")
    || normalized.includes("EDGX")
  ) return "CBOE";
  if (
    normalized.includes("OTCQX")
    || normalized.includes("OTCQB")
    || normalized.includes("OTCMARKETS")
    || normalized.includes("PINK")
    || normalized === "OTC"
  ) return "OTC";
  if (
    normalized === "NYS"
    || normalized === "NYQ"
    || normalized === "NYSE"
    || normalized.includes("NEWYORKSTOCKEXCHANGE")
  ) return "NYS";
  if (
    normalized === "NAS"
    || normalized === "NSQ"
    || normalized === "NMS"
    || normalized === "NGM"
    || normalized === "NCM"
    || normalized.includes("NASDAQ")
  ) return "NAS";

  return "";
}

export function usExchangeFromReutersCode(symbol: string): UsListingExchange | "" {
  const suffix = symbol.normalize("NFKC").trim().toUpperCase().match(/\.([OKNPA])(?:$|_)/)?.[1];
  if (suffix === "O" || suffix === "K") return "NAS";
  if (suffix === "N") return "NYS";
  if (suffix === "A") return "AMS";
  if (suffix === "P") return "ARCA";
  return "";
}

function text(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collectRecords(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 6 || output.length >= 300 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => /(?:item|stock|reuters|ticker|symbol|code|market|exchange|nation|type)/i.test(key))) output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") collectRecords(child, depth + 1, output);
  return output;
}

function exchangeFromRecord(record: Record<string, unknown>) {
  const preferred = [
    "exchangeCode", "exchangeName", "exchange", "stockExchangeType", "exchangeType",
    "listingExchange", "listingMarket", "marketCode", "marketName", "marketType",
    "tradeType", "typeCode", "typeName",
  ];
  for (const key of preferred) {
    const exchange = normalizeUsListingExchange(text(record, [key]));
    if (exchange) return exchange;
  }
  return "";
}

function tickerCore(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/_[A-Z]+(?:\.|$).*$/, "").replace(/\.[A-Z]{1,4}$/, "");
}

function recordIdentity(record: Record<string, unknown>) {
  return text(record, [
    "reutersCode", "reuterscode", "symbolCode", "stockCode", "itemCode", "itemcode",
    "ticker", "symbol", "code",
  ]);
}

function matchingRecords(payload: unknown, symbol: string) {
  const wanted = tickerCore(symbol);
  const rows = collectRecords(payload);
  const exact = rows.filter(record => {
    const identity = recordIdentity(record);
    return identity && tickerCore(identity) === wanted;
  });
  return exact.length ? exact : rows;
}

function resolveFromPayload(payload: unknown, symbol: string) {
  const rows = matchingRecords(payload, symbol);
  for (const row of rows) {
    const exchange = exchangeFromRecord(row);
    if (exchange) return exchange;
  }
  for (const row of rows) {
    const reuters = text(row, ["reutersCode", "reuterscode"]);
    const exchange = usExchangeFromReutersCode(reuters);
    if (exchange) return exchange;
  }
  return "";
}

function reutersFromPayload(payload: unknown, symbol: string) {
  const wanted = tickerCore(symbol);
  for (const row of collectRecords(payload)) {
    const reuters = text(row, ["reutersCode", "reuterscode"]);
    if (reuters && tickerCore(reuters) === wanted) return normalizeNaverReutersCode(reuters);
  }
  return "";
}

export async function getUsListingExchange(symbolInput: string, fallback?: string | null): Promise<UsListingExchange | ""> {
  const symbol = normalizeNaverReutersCode(symbolInput.normalize("NFKC").trim());
  if (!symbol) return "";

  const normalizedFallback = normalizeUsListingExchange(fallback);
  const suffixExchange = usExchangeFromReutersCode(symbol);

  // A specific exchange supplied by Naver or encoded in the Reuters suffix is already authoritative enough.
  if (normalizedFallback) return normalizedFallback;
  if (suffixExchange) return suffixExchange;

  const cacheKey = tickerCore(symbol);
  const cached = exchangeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.exchange;

  let exchange: UsListingExchange | "" = "";
  try {
    const basic = await naverJson<unknown>(
      `/api/securityService/stock/${encodeURIComponent(symbol)}/basic`,
      { ttlMs: CACHE_TTL_MS, staleMs: 7 * CACHE_TTL_MS },
    );
    exchange = resolveFromPayload(basic.data, symbol);
  } catch {}

  if (!exchange) {
    try {
      const query = naverAutocompleteQueryForForeignCode(symbol);
      const autocomplete = await naverJson<unknown>(
        buildNaverPath("/api/autocomplete/search/autoComplete", { query, target: "stock" }),
        { ttlMs: CACHE_TTL_MS, staleMs: 7 * CACHE_TTL_MS },
      );
      exchange = resolveFromPayload(autocomplete.data, symbol);
      if (!exchange) {
        const reuters = reutersFromPayload(autocomplete.data, symbol);
        exchange = usExchangeFromReutersCode(reuters);
      }
    } catch {}
  }

  exchangeCache.set(cacheKey, { exchange, expiresAt: Date.now() + CACHE_TTL_MS });
  return exchange;
}
