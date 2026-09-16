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
  if (depth > 5 || output.length >= 400 || value === null || value === undefined) return output;
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

  // For US instruments the Reuters code is Naver's canonical identity and logo
  // key (for example AAPL.O / QQQ.O). The prior case-sensitive heuristic kept
  // many autocomplete rows as plain AAPL/QQQ, which broke both quote/logo
  // resolution and persisted stale ticker-only rows.
  if (market === "US" && reuters) symbol = reuters;
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
    ? "UPBIT"
    : normalizeSupportedExchange(market, exchangeRaw)
      || (market === "KR" && nationKind === "KR" ? "KRX" : "")
      || (market === "US" && nationKind === "US" ? "USA" : "");
  if (!exchange) return null;
  return { market, symbol: normalizedSymbol, name, exchange, currency: market === "US" ? "USD" : "KRW" };
}

function searchableSymbol(item: SearchInstrument) {
  return item.market === "US" ? item.symbol.replace(/\.(?:O|K|N|P|A)$/i, "") : item.symbol;
}

function searchRank(item: SearchInstrument, query: string) {
  const needle = query.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const symbol = searchableSymbol(item).normalize("NFKC").toLocaleLowerCase("en-US");
  const name = item.name.normalize("NFKC").toLocaleLowerCase("en-US");
  if (symbol === needle) return 0;
  if (name === needle) return 1;
  if (symbol.startsWith(needle)) return 2;
  if (name.startsWith(needle)) return 3;
  if (symbol.includes(needle)) return 4;
  if (name.includes(needle)) return 5;
  return 6;
}

export async function searchNaverMarket(query: string, market?: Market) {
  const target = market === "CRYPTO" ? "coin" : market === "KR" || market === "US" ? "stock" : "stock,coin";
  const requests = await Promise.allSettled([
    naverJson<unknown>(
      buildNaverPath("/api/autocomplete/search/autoComplete", { query, target }),
      { ttlMs: 30_000, staleMs: 10 * 60_000 },
    ),
    naverJson<unknown>(
      buildNaverPath("/api/autocomplete/search", { q: query, target, size: 100, page: 1 }),
      { ttlMs: 30_000, staleMs: 10 * 60_000 },
    ),
  ]);

  const successful = requests.filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof naverJson<unknown>>>> => entry.status === "fulfilled");
  if (!successful.length) throw requests[0].status === "rejected" ? requests[0].reason : new Error("NAVER_SEARCH_UNAVAILABLE");

  const unique = new Map<string, SearchInstrument>();
  for (const response of successful) {
    for (const record of collect(response.value.data)) {
      const item = normalize(record);
      if (!item || (market && item.market !== market)) continue;
      unique.set(`${item.market}:${item.symbol}`, item);
    }
  }

  const instruments = [...unique.values()]
    .sort((a, b) => searchRank(a, query) - searchRank(b, query) || a.name.localeCompare(b.name, "ko"))
    .slice(0, 40);

  return { instruments, stale: successful.some(response => response.value.stale) };
}
