import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";
import type { Market, SearchInstrument } from "@/lib/server/market-data";

function text(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collect(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 5 || output.length >= 200 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => /(?:item|stock|reuters|ticker|symbol|code|name|fqnf)/i.test(key))) output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") collect(child, depth + 1, output);
  return output;
}

function marketOf(record: Record<string, unknown>): Market | null {
  const reuters = text(record, ["reutersCode", "reuterscode"]);
  const exchange = text(record, ["exchangeType", "exchange", "marketType", "nationType", "nation", "country"]);
  const fqnf = text(record, ["fqnfTicker", "fqnf_ticker"]);
  const type = text(record, ["type", "category", "targetType", "assetType"]);
  if (fqnf || /UPBIT|BITHUMB|COIN|CRYPTO|가상자산/i.test(`${exchange} ${type}`)) return "CRYPTO";
  if (reuters || /USA|NASDAQ|NYSE|AMEX|미국/i.test(exchange)) return "US";
  const code = text(record, ["itemCode", "itemcode", "stockCode", "symbolCode", "code"]);
  if (/^[A-Za-z0-9]{6}$/.test(code) || /KOSPI|KOSDAQ|KRX|NXT|국내/i.test(`${exchange} ${type}`)) return "KR";
  return null;
}

function normalize(record: Record<string, unknown>): SearchInstrument | null {
  const market = marketOf(record);
  if (!market) return null;
  const name = text(record, ["itemName", "itemname", "stockName", "name", "displayName", "koreanName", "korName"]);
  const reuters = text(record, ["reutersCode", "reuterscode"]);
  const fqnf = text(record, ["fqnfTicker", "fqnf_ticker"]);
  let symbol = text(record, ["ticker", "symbol", "itemCode", "itemcode", "stockCode", "symbolCode", "code"]);

  if (market === "US" && reuters && looksLikeCaseSensitiveReutersCode(reuters)) symbol = reuters;
  else if (market === "US" && !symbol && reuters) symbol = reuters.split(".")[0];
  if (market === "CRYPTO") {
    const ticker = (symbol || fqnf.split("_")[0]).replace(/^KRW-/, "");
    symbol = ticker ? `KRW-${ticker}` : "";
  }
  if (!name || !symbol) return null;

  const normalizedSymbol = market === "US" ? normalizeNaverReutersCode(symbol) : symbol.toUpperCase();
  const exchangeRaw = text(record, ["exchangeName", "exchangeType", "exchange", "marketName", "marketType", "nationType"]);
  const exchange = market === "KR" ? (exchangeRaw || "KRX") : market === "US" ? (exchangeRaw || "USA") : "NAVER";
  return { market, symbol: normalizedSymbol, name, exchange, currency: market === "US" ? "USD" : "KRW" };
}

export async function searchNaverMarket(query: string, market?: Market) {
  const target = market === "CRYPTO" ? "coin" : market === "KR" || market === "US" ? "stock" : "stock,coin";
  const result = await naverJson<unknown>(
    buildNaverPath("/api/autocomplete/search/autoComplete", { query, target }),
    { ttlMs: 30_000, staleMs: 10 * 60_000 },
  );

  const unique = new Map<string, SearchInstrument>();
  for (const record of collect(result.data)) {
    const item = normalize(record);
    if (!item || (market && item.market !== market)) continue;
    unique.set(`${item.market}:${item.symbol}`, item);
    if (unique.size >= 20) break;
  }
  return { instruments: [...unique.values()], stale: result.stale };
}
