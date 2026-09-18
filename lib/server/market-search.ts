import { canonicalCryptoDisplayName } from "@/lib/crypto-display-name";
import { normalizeDomesticListingMarket } from "@/lib/server/domestic-listing-market";
import { classifySupportedNation, hasUnsupportedForeignReutersSuffix, normalizeSupportedExchange } from "@/lib/server/instrument-policy";
import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, normalizeNaverMarketSymbol, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";
import { getUsListingExchange } from "@/lib/server/us-listing-exchange";
import type { Market, SearchInstrument } from "@/lib/server/market-data";


const HANGUL_INITIALS = ["ᄀ","ᄁ","ᄂ","ᄃ","ᄄ","ᄅ","ᄆ","ᄇ","ᄈ","ᄉ","ᄊ","ᄋ","ᄌ","ᄍ","ᄎ","ᄏ","ᄐ","ᄑ","ᄒ"] as const;
const DOMESTIC_INITIAL_PAGE_SIZE = 100;
const DOMESTIC_INITIAL_MAX_PAGES = 40;
const DOMESTIC_INITIAL_BATCH_SIZE = 4;

function compactSearchText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("en-US");
}

function queryInitialIndex(char: string) {
  return HANGUL_INITIALS.indexOf(char.normalize("NFKC") as (typeof HANGUL_INITIALS)[number]);
}

function syllableInitialIndex(char: string) {
  const normalized = char.normalize("NFKC");
  const direct = HANGUL_INITIALS.indexOf(normalized as (typeof HANGUL_INITIALS)[number]);
  if (direct >= 0) return direct;
  const code = normalized.codePointAt(0) ?? 0;
  return code >= 0xac00 && code <= 0xd7a3 ? Math.floor((code - 0xac00) / 588) : -1;
}

function hasHangulInitialQuery(value: string) {
  return [...compactSearchText(value)].some(char => queryInitialIndex(char) >= 0);
}

function literalPrefixBeforeInitial(value: string) {
  const output: string[] = [];
  for (const char of [...compactSearchText(value)]) {
    if (queryInitialIndex(char) >= 0) break;
    output.push(char);
  }
  return output.join("");
}

function koreanPatternIndex(name: string, query: string) {
  const candidate = [...compactSearchText(name)];
  const pattern = [...compactSearchText(query)];
  if (!pattern.length || pattern.length > candidate.length) return -1;

  for (let start = 0; start <= candidate.length - pattern.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < pattern.length; offset += 1) {
      const patternChar = pattern[offset];
      const candidateChar = candidate[start + offset];
      const initial = queryInitialIndex(patternChar);
      if (initial >= 0 ? syllableInitialIndex(candidateChar) !== initial : candidateChar !== patternChar) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

function domesticCatalogRoot(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  let current = payload as Record<string, unknown>;
  for (let depth = 0; depth < 3; depth += 1) {
    if (Array.isArray(current.items)) return current;
    const next = [current.data, current.result, current.body].find(value => value && typeof value === "object" && !Array.isArray(value));
    if (!next) break;
    current = next as Record<string, unknown>;
  }
  return current;
}

function domesticCatalogItem(value: unknown): SearchInstrument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const normalized = normalize(record);
  if (normalized?.market === "KR") return normalized;

  const name = text(record, ["itemName", "itemname", "stockName", "name", "displayName", "koreanName", "korName"]);
  const symbol = text(record, ["itemCode", "itemcode", "stockCode", "symbolCode", "code"]).toUpperCase();
  if (!name || !/^[A-Z0-9]{6}$/.test(symbol)) return null;
  const exchange = domesticListingExchange(record) || "KRX";
  return { market: "KR", symbol, name, exchange, currency: "KRW" };
}

function domesticCatalogRows(payload: unknown) {
  const root = domesticCatalogRoot(payload);
  return root && Array.isArray(root.items) ? root.items : [];
}

function domesticCatalogHasNext(payload: unknown) {
  const raw = domesticCatalogRoot(payload)?.hasNext;
  return raw === true || String(raw ?? "").toLocaleLowerCase("en-US") === "true";
}

function domesticCatalogTotalCount(payload: unknown) {
  const raw = Number(domesticCatalogRoot(payload)?.totalCount);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

async function searchDomesticInitialCatalog(query: string) {
  const matches = new Map<string, SearchInstrument>();
  let stale = false;
  const addPage = (response: Awaited<ReturnType<typeof naverJson<unknown>>>) => {
    stale ||= response.stale;
    for (const raw of domesticCatalogRows(response.data)) {
      const item = domesticCatalogItem(raw);
      if (!item || koreanPatternIndex(item.name, query) < 0) continue;
      matches.set(`${item.market}:${item.symbol}`, item);
    }
  };
  const fetchPage = (index: number) => naverJson<unknown>(
    buildNaverPath("/api/stockSecurity/individual-stocks/v3/domestic", {
      listingType: "tradingValueDesc",
      exchangeType: "consolidated",
      index,
      size: DOMESTIC_INITIAL_PAGE_SIZE,
    }),
    { ttlMs: 6 * 60 * 60_000, staleMs: 24 * 60 * 60_000, timeoutMs: 8_000 },
  );

  const first = await fetchPage(0);
  addPage(first);
  const totalCount = domesticCatalogTotalCount(first.data);
  const pageLimit = totalCount
    ? Math.min(DOMESTIC_INITIAL_MAX_PAGES, Math.ceil(totalCount / DOMESTIC_INITIAL_PAGE_SIZE))
    : domesticCatalogHasNext(first.data) ? DOMESTIC_INITIAL_MAX_PAGES : 1;

  for (let index = 1; index < pageLimit && matches.size < 40; index += DOMESTIC_INITIAL_BATCH_SIZE) {
    const indexes = Array.from(
      { length: Math.min(DOMESTIC_INITIAL_BATCH_SIZE, pageLimit - index) },
      (_, offset) => index + offset,
    );
    const batch = await Promise.allSettled(indexes.map(fetchPage));
    let fulfilled = 0;
    for (const entry of batch) {
      if (entry.status !== "fulfilled") continue;
      fulfilled += 1;
      addPage(entry.value);
    }
    if (!fulfilled) break;
  }

  return { instruments: [...matches.values()], stale };
}

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

function domesticListingExchange(record: Record<string, unknown>) {
  const listingFields = ["marketType", "marketName", "typeCode", "typeName", "stockExchangeType", "exchangeType", "exchangeName", "exchange"];
  for (const key of listingFields) {
    const value = text(record, [key]);
    const listing = normalizeDomesticListingMarket(value);
    if (listing) return listing;
  }
  for (const key of listingFields) {
    const normalized = normalizeSupportedExchange("KR", text(record, [key]));
    if (normalized) return normalized;
  }
  return "";
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
    : market === "KR"
      ? domesticListingExchange(record) || (nationKind === "KR" ? "KRX" : "")
      : normalizeSupportedExchange(market, exchangeRaw)
        || (nationKind === "US" ? "USA" : "");
  if (!exchange) return null;
  return { market, symbol: normalizedSymbol, name: market === "CRYPTO" ? canonicalCryptoDisplayName(normalizedSymbol, name) : name, exchange, currency: market === "US" ? "USD" : "KRW" };
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
  if (item.market === "KR") {
    const patternIndex = koreanPatternIndex(item.name, query);
    if (patternIndex === 0) return 3;
    if (patternIndex > 0) return 5;
  }
  if (symbol.includes(needle)) return 4;
  if (name.includes(needle)) return 5;
  return 6;
}

export async function searchNaverMarket(query: string, market?: Market) {
  const initialSearch = market !== "US" && market !== "CRYPTO" && hasHangulInitialQuery(query);
  const target = market === "CRYPTO" ? "coin" : market === "KR" || market === "US" ? "stock" : "stock,coin";
  const literalPrefix = initialSearch ? literalPrefixBeforeInitial(query) : "";
  const upstreamQueries = initialSearch ? (literalPrefix ? [literalPrefix] : []) : [query];
  const requests = await Promise.allSettled(upstreamQueries.flatMap(upstreamQuery => [
    naverJson<unknown>(
      buildNaverPath("/api/autocomplete/search/autoComplete", { query: upstreamQuery, target }),
      { ttlMs: 30_000, staleMs: 10 * 60_000 },
    ),
    naverJson<unknown>(
      buildNaverPath("/api/autocomplete/search", { q: upstreamQuery, target, size: 100, page: 1 }),
      { ttlMs: 30_000, staleMs: 10 * 60_000 },
    ),
  ]));

  const successful = requests.filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof naverJson<unknown>>>> => entry.status === "fulfilled");
  const catalog = initialSearch
    ? await searchDomesticInitialCatalog(query).catch(() => null)
    : null;
  if (!successful.length && !catalog) {
    const rejected = requests.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
    throw rejected?.reason ?? new Error("NAVER_SEARCH_UNAVAILABLE");
  }

  const unique = new Map<string, SearchInstrument>();
  for (const response of successful) {
    for (const record of collect(response.value.data)) {
      const item = normalize(record);
      if (!item || (market && item.market !== market)) continue;
      if (initialSearch && (item.market !== "KR" || koreanPatternIndex(item.name, query) < 0)) continue;
      unique.set(`${item.market}:${item.symbol}`, item);
    }
  }
  if (catalog) {
    for (const item of catalog.instruments) {
      if (!market || market === "KR") unique.set(`${item.market}:${item.symbol}`, item);
    }
  }

  const ranked = [...unique.values()]
    .sort((a, b) => searchRank(a, query) - searchRank(b, query) || a.name.localeCompare(b.name, "ko"))
    .slice(0, 40);
  const instruments = await Promise.all(ranked.map(async item => {
    if (item.market !== "US") return item;
    const exchange = await getUsListingExchange(item.symbol, item.exchange);
    return exchange ? { ...item, exchange } : item;
  }));

  return {
    instruments,
    stale: successful.some(response => response.value.stale) || Boolean(catalog?.stale),
  };
}
