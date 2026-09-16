import { classifySupportedNation, hasUnsupportedForeignReutersSuffix, normalizeSupportedExchange } from "@/lib/server/instrument-policy";
import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, normalizeNaverMarketSymbol, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";
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
  const exchange = text(record, ["exchangeName", "exchangeType", "exchange", "marketName", "marketType", "typeCode", "typeName"]);
  const nation = text(record, ["nationCode", "nationName", "nationType", "nation", "country"]);
  const nationKind = classifySupportedNation(nation);
  const fqnf = text(record, ["fqnfTicker", "fqnf_ticker"]);
  const type = text(record, ["type", "category", "targetType", "assetType", "typeCode", "typeName"]);
  const url = text(record, ["url", "link", "href"]);
  const code = text(record, ["itemCode", "itemcode", "stockCode", "symbolCode", "code"]);

  if (fqnf || /UPBIT|BITHUMB|COIN|CRYPTO|가상자산/i.test(`${exchange} ${type}`)) return "CRYPTO";

  // Explicit country metadata wins. This prevents Japanese, Chinese, Hong Kong,
  // European and other world-stock rows from being relabeled as US stocks.
  if (nationKind === "FOREIGN") return null;
  if (nationKind === "KR") return "KR";
  if (nationKind === "US") return "US";

  // Naver domestic autocomplete rows also expose reutersCode (e.g. 005930), so
  // a non-empty reutersCode alone must never classify a row as a US instrument.
  if (/KOSPI|KOSDAQ|KRX|NXT|국내|코스피|코스닥/i.test(`${exchange} ${type}`)
      || /^\/domestic\//i.test(url)) return "KR";

  if (normalizeSupportedExchange("US", exchange)) return "US";
  if (hasUnsupportedForeignReutersSuffix(reuters)) return null;
  if (reuters.includes(".") && !/^\d{6}(?:\.|$)/.test(reuters)) return "US";

  if (/^[A-Za-z0-9]{6}$/.test(code)) return "KR";
  if (reuters && looksLikeCaseSensitiveReutersCode(reuters) && !hasUnsupportedForeignReutersSuffix(reuters)) return "US";
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
  else if (market === "US" && !symbol && reuters) symbol = reuters;
  if (market === "CRYPTO") symbol = normalizeNaverMarketSymbol("CRYPTO", symbol || fqnf);
  if (!name || !symbol) return null;

  if (market === "US" && hasUnsupportedForeignReutersSuffix(symbol)) return null;
  const normalizedSymbol = market === "US"
    ? normalizeNaverReutersCode(symbol)
    : market === "CRYPTO"
      ? normalizeNaverMarketSymbol("CRYPTO", symbol)
      : symbol.toUpperCase();
  const exchangeRaw = text(record, ["exchangeName", "exchangeType", "exchange", "marketName", "marketType", "typeCode", "typeName", "nationType"]);
  const nation = text(record, ["nationCode", "nationName", "nationType", "nation", "country"]);
  const nationKind = classifySupportedNation(nation);
  const exchange = market === "CRYPTO"
    ? "NAVER"
    : normalizeSupportedExchange(market, exchangeRaw)
      || (market === "KR" && nationKind === "KR" ? "KRX" : "")
      || (market === "US" && nationKind === "US" ? "USA" : "");
  if (!exchange) return null;
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
