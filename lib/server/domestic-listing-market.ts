import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";

export type DomesticListingMarket = "KOSPI" | "KOSDAQ" | "KONEX";

const DOMESTIC_SYMBOL = /^\d{6}$/;
const LISTING_MARKETS = new Set<DomesticListingMarket>(["KOSPI", "KOSDAQ", "KONEX"]);

export function normalizeDomesticListingMarket(value: unknown): DomesticListingMarket | "" {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const raw = String(value).normalize("NFKC").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/[\s._-]+/g, "");
  if (compact === "KOSPI" || compact.includes("코스피")) return "KOSPI";
  if (compact === "KOSDAQ" || compact.includes("코스닥")) return "KOSDAQ";
  if (compact === "KONEX" || compact.includes("코넥스")) return "KONEX";
  return "";
}

function marketFromPayload(payload: unknown) {
  const seen = new Set<object>();
  const visit = (value: unknown, key = "", depth = 0): DomesticListingMarket | "" => {
    if (depth > 6 || value === null || value === undefined) return "";
    const direct = normalizeDomesticListingMarket(value);
    if (direct) return direct;
    if ((typeof value === "number" || typeof value === "string") && /sosok/i.test(key)) {
      const code = String(value).trim();
      if (code === "0") return "KOSPI";
      if (code === "1") return "KOSDAQ";
      if (code === "2") return "KONEX";
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, key, depth + 1);
        if (found) return found;
      }
      return "";
    }
    if (typeof value !== "object") return "";
    if (seen.has(value as object)) return "";
    seen.add(value as object);
    const record = value as Record<string, unknown>;
    const preferred = ["marketType", "marketName", "typeCode", "typeName", "sosok", "sosokCode", "sosokName", "stockExchangeType", "exchangeType", "exchangeName"];
    for (const candidate of preferred) {
      if (!(candidate in record)) continue;
      const found = visit(record[candidate], candidate, depth + 1);
      if (found) return found;
    }
    for (const [childKey, child] of Object.entries(record)) {
      const found = visit(child, childKey, depth + 1);
      if (found) return found;
    }
    return "";
  };
  return visit(payload);
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
  if (Object.keys(record).some(key => /(?:item|stock|reuters|ticker|symbol|code|market|exchange|sosok)/i.test(key))) output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") collectRecords(child, depth + 1, output);
  return output;
}

function marketFromAutocomplete(payload: unknown, symbol: string) {
  for (const record of collectRecords(payload)) {
    const code = text(record, ["itemCode", "itemcode", "stockCode", "symbolCode", "code", "ticker", "symbol", "reutersCode", "reuterscode"])
      .replace(/^A(?=\d{6}$)/, "")
      .split(".")[0];
    if (code !== symbol) continue;
    const market = marketFromPayload(record);
    if (market) return market;
  }
  return "";
}

async function getListingFromAutocomplete(symbol: string) {
  const paths = [
    buildNaverPath("/api/autocomplete/search/autoComplete", { query: symbol, target: "stock" }),
    buildNaverPath("/api/autocomplete/search", { q: symbol, target: "stock", size: 20, page: 1 }),
  ];
  for (const path of paths) {
    try {
      const response = await naverJson<unknown>(path, { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 });
      const market = marketFromAutocomplete(response.data, symbol);
      if (market) return market;
    } catch {}
  }
  return "";
}

export async function getDomesticListingMarket(symbolInput: string, fallback?: string | null): Promise<DomesticListingMarket | ""> {
  const fallbackMarket = normalizeDomesticListingMarket(fallback);
  if (fallbackMarket) return fallbackMarket;
  const symbol = symbolInput.normalize("NFKC").trim().replace(/^A(?=\d{6}$)/, "");
  if (!DOMESTIC_SYMBOL.test(symbol)) return "";
  try {
    const sosok = await naverJson<unknown>(`/api/domestic/detail/${symbol}/sosok`, { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 });
    const market = marketFromPayload(sosok.data);
    if (market) return market;
  } catch {}
  const autocomplete = await getListingFromAutocomplete(symbol);
  if (autocomplete) return autocomplete;
  try {
    const basic = await naverJson<unknown>(`/api/securityService/stock/${symbol}/basic`, { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 });
    return marketFromPayload(basic.data);
  } catch {
    return "";
  }
}

export function isDomesticListingMarket(value: string | null | undefined): value is DomesticListingMarket {
  return LISTING_MARKETS.has((value ?? "").toUpperCase() as DomesticListingMarket);
}
