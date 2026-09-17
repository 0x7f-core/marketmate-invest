import { getDomesticListingMarket, normalizeDomesticListingMarket } from "@/lib/server/domestic-listing-market";
import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";

export type RankingMarket = "KR" | "US" | "CRYPTO";
export type RankingCategory = "tradingValue" | "volume" | "up" | "down" | "marketCap";

export type MarketRankingItem = {
  market: RankingMarket;
  rank: number;
  symbol: string;
  name: string;
  exchange: string;
  currency: "KRW" | "USD";
  price: number;
  change: number;
  changeRate: number;
  volume: number;
  tradingValue: number;
  marketCap: number;
};

export type MarketRankingResult = {
  market: RankingMarket;
  category: RankingCategory;
  items: MarketRankingItem[];
  source: "NAVER";
  fetchedAt: number;
  stale: boolean;
  pollingInterval: number;
};

type Row = Record<string, unknown>;

const CATEGORY_SET = new Set<RankingCategory>(["tradingValue", "volume", "up", "down", "marketCap"]);

function rowValue(row: Row, keys: string[]) {
  for (const key of keys) {
    const raw = row[key];
    if (raw !== null && raw !== undefined && raw !== "") return raw;
  }
  const actualKeys = new Map(Object.keys(row).map(key => [key.toLowerCase(), key]));
  for (const key of keys) {
    const actualKey = actualKeys.get(key.toLowerCase());
    if (!actualKey) continue;
    const raw = row[actualKey];
    if (raw !== null && raw !== undefined && raw !== "") return raw;
  }
  return undefined;
}

function numberValue(row: Row, keys: string[]) {
  const raw = rowValue(row, keys);
  if (raw === null || raw === undefined || raw === "") return 0;
  const value = typeof raw === "string"
    ? Number(raw.replace(/[,%₩원$]/g, "").replaceAll(",", "").trim())
    : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function textValue(row: Row, keys: string[]) {
  const raw = rowValue(row, keys);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

function candidateRows(payload: unknown) {
  const rows: Row[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    const row = value as Row;
    const keys = Object.keys(row);
    const hasIdentity = keys.some(key => /^(?:itemCode|stockCode|symbolCode|reutersCode|symbol|ticker|code|name|stockName|itemName|koreanName|coinName|nfTicker|fqnfTicker)$/i.test(key));
    const hasPrice = keys.some(key => /(?:price|close|tradePrice|marketPrice)/i.test(key));
    if (hasIdentity && hasPrice) rows.push(row);
    for (const child of Object.values(row)) if (child && typeof child === "object") visit(child, depth + 1);
  };
  visit(payload);
  return rows;
}

function normalizeSymbol(market: RankingMarket, row: Row) {
  const raw = textValue(row, market === "KR"
    ? ["itemCode", "stockCode", "symbolCode", "symbol", "code"]
    : market === "US"
      ? ["reutersCode", "symbolCode", "symbol", "ticker", "stockCode", "code"]
      : ["ticker", "symbol", "coinCode", "code", "nfTicker", "fqnfTicker"]);
  if (!raw) return "";
  if (market === "KR") return raw.replace(/^A(?=\d{6}$)/, "").toUpperCase();
  if (market === "CRYPTO") return raw.toUpperCase().replace(/^KRW-/, "").replace(/_KRW_(?:UPBIT|BITHUMB)$/, "");
  return raw;
}

function normalizeName(row: Row, symbol: string) {
  return textValue(row, [
    "stockName", "stockNameKo", "stockNameKor", "itemName", "itemname", "koreanName", "coinName",
    "displayName", "localName", "name", "stockNameEng", "englishName",
  ]) || symbol;
}

function domesticExchange(row: Row) {
  const sosok = textValue(row, ["sosok", "sosokCode"]);
  if (sosok === "0") return "KOSPI";
  if (sosok === "1") return "KOSDAQ";
  if (sosok === "2") return "KONEX";
  for (const key of ["marketType", "marketName", "typeCode", "typeName", "stockExchangeType", "exchangeType", "exchange", "tradeType"]) {
    const listing = normalizeDomesticListingMarket(textValue(row, [key]));
    if (listing) return listing;
  }
  return textValue(row, ["marketType", "exchange", "tradeType", "marketName"]) || "KRX";
}

function normalizeUsExchange(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (!normalized || normalized === "USA" || normalized === "US" || normalized === "UNITEDSTATES") return "";
  if (normalized === "NAS" || normalized.includes("NASDAQ") || ["NMS", "NGM", "NCM", "NSQ"].includes(normalized)) return "NAS";
  if (normalized === "NYS" || normalized === "NYSE" || normalized.includes("NEWYORKSTOCKEXCHANGE")) return "NYS";
  if (normalized === "ASE" || normalized === "AMEX" || normalized.includes("NYSEAMERICAN") || normalized.includes("AMERICANSTOCKEXCHANGE")) return "ASE";
  return value.trim();
}

function usExchangeFromSymbol(symbol: string) {
  const suffix = symbol.toUpperCase().match(/\.([OKNPA])$/)?.[1];
  if (suffix === "O" || suffix === "K") return "NAS";
  if (suffix === "N" || suffix === "P") return "NYS";
  if (suffix === "A") return "ASE";
  return "USA";
}

function usExchange(row: Row, symbol: string) {
  for (const key of ["exchangeCode", "exchangeName", "exchange", "stockExchangeType", "exchangeType", "tradeType", "marketType", "marketName"]) {
    const exchange = normalizeUsExchange(textValue(row, [key]));
    if (exchange) return exchange;
  }
  return usExchangeFromSymbol(symbol);
}

function normalizeRow(market: RankingMarket, row: Row): Omit<MarketRankingItem, "rank"> | null {
  const symbol = normalizeSymbol(market, row);
  if (!symbol) return null;
  const name = normalizeName(row, symbol);
  const price = numberValue(row, ["closePrice", "currentPrice", "tradePrice", "nowPrice", "price", "lastPrice", "last"]);
  if (price <= 0) return null;
  const exchange = market === "KR"
    ? domesticExchange(row)
    : market === "US"
      ? usExchange(row, symbol)
      : textValue(row, ["exchangeType", "exchange", "market"]) || "UPBIT";

  return {
    market,
    symbol: market === "CRYPTO" ? `KRW-${symbol}` : symbol,
    name,
    exchange,
    currency: market === "US" ? "USD" : "KRW",
    price,
    change: numberValue(row, ["compareToPreviousClosePrice", "changePrice", "signedChangePrice", "changeValue", "change", "netChange", "prevChange"]),
    changeRate: numberValue(row, ["fluctuationsRatio", "changeRate", "signedChangeRate", "changeRatio", "rate", "changePercent", "prevChangeRate"]),
    volume: numberValue(row, [
      "accumulatedTradingVolume", "accumulatedTradingVolume24H", "accTradeVolume24h", "tradeVolume24h", "tradingVolume",
      "volume", "accTradeVolume", "accQuant", "quant", "tradeVolume",
    ]),
    tradingValue: numberValue(row, [
      "accumulatedTradingValue", "accumulatedTradingValue24H", "accTradePrice24h", "tradePrice24h", "tradingValue",
      "transactionAmount", "accTradePrice", "accAmount", "tradeAmount", "amount", "tradeValue",
    ]),
    marketCap: numberValue(row, ["marketValue", "marketCap", "marketCapitalization", "marketSum", "capitalization", "marketCapAmount"]),
  };
}

function uniqueItems(market: RankingMarket, payload: unknown) {
  const found: Array<Omit<MarketRankingItem, "rank">> = [];
  const seen = new Set<string>();
  for (const row of candidateRows(payload)) {
    const item = normalizeRow(market, row);
    if (!item) continue;
    const key = `${item.market}:${item.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(item);
  }
  return found;
}

function rank(items: Array<Omit<MarketRankingItem, "rank">>, category: RankingCategory, preserveOrder = true) {
  const sorted = [...items];
  if (!preserveOrder) {
    const read = (item: Omit<MarketRankingItem, "rank">) => category === "volume" ? item.volume
      : category === "tradingValue" ? item.tradingValue
        : category === "marketCap" ? item.marketCap : item.changeRate;
    sorted.sort((a, b) => category === "down" ? read(a) - read(b) : read(b) - read(a));
  }
  return sorted.slice(0, 10).map((item, index) => ({ ...item, rank: index + 1 }));
}

function tickerCore(symbol: string) {
  return symbol.toUpperCase().replace(/\.[A-Z]$/, "");
}

function needsUsName(item: MarketRankingItem) {
  const name = item.name.trim().toUpperCase();
  return !name || name === item.symbol.toUpperCase() || name === tickerCore(item.symbol);
}

function needsUsExchange(item: MarketRankingItem) {
  return !normalizeUsExchange(item.exchange);
}

async function enrichUsMetadata(items: MarketRankingItem[]) {
  return Promise.all(items.map(async item => {
    if (item.market !== "US") return item;
    const fillName = needsUsName(item);
    const fillExchange = needsUsExchange(item);
    if (!fillName && !fillExchange) return item;
    try {
      const basic = await naverJson<Row>(`/api/securityService/stock/${item.symbol}/basic`, {
        ttlMs: 6 * 60 * 60_000,
        staleMs: 7 * 24 * 60 * 60_000,
      });
      const name = fillName
        ? textValue(basic.data, ["stockName", "stockNameKo", "stockNameKor", "koreanName", "stockNameEng"])
        : "";
      const exchange = fillExchange ? usExchange(basic.data, item.symbol) : item.exchange;
      return {
        ...item,
        ...(name ? { name } : {}),
        ...(exchange ? { exchange } : {}),
      };
    } catch {
      return fillExchange ? { ...item, exchange: usExchangeFromSymbol(item.symbol) } : item;
    }
  }));
}

async function enrichDomesticMarkets(items: MarketRankingItem[]) {
  return Promise.all(items.map(async item => {
    if (item.market !== "KR" || normalizeDomesticListingMarket(item.exchange)) return item;
    const exchange = await getDomesticListingMarket(item.symbol, item.exchange);
    return exchange ? { ...item, exchange } : item;
  }));
}

function domesticV3ListingType(category: RankingCategory) {
  return category === "tradingValue" ? "tradingValueDesc"
    : category === "volume" ? "tradingVolumeDesc"
      : category === "up" ? "changeRateDescUpAll"
        : category === "down" ? "changeRateDescDownAll" : "marketCapDesc";
}

function domesticV3Rows(payload: unknown, category: RankingCategory) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const items = (payload as Row).items;
  if (!Array.isArray(items)) return [];

  const metric = (venue: Row | undefined) => {
    if (!venue) return 0;
    return category === "volume" ? numberValue(venue, ["tradingVolume", "volume"])
      : category === "tradingValue" ? numberValue(venue, ["tradingValue", "tradeAmount", "amount"])
        : category === "marketCap" ? numberValue(venue, ["marketCap", "marketValue"])
          : Math.abs(numberValue(venue, ["changeRate", "rate"]));
  };

  return items.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Row;
    const krx = row.krx && typeof row.krx === "object" && !Array.isArray(row.krx) ? row.krx as Row : undefined;
    const nxt = row.nxt && typeof row.nxt === "object" && !Array.isArray(row.nxt) ? row.nxt as Row : undefined;
    const krxMetric = metric(krx);
    const nxtMetric = metric(nxt);
    const venue = krxMetric > 0 || nxtMetric <= 0 ? (krx ?? nxt) : (nxt ?? krx);
    if (!venue) return [];

    return [{
      ...row,
      currentPrice: rowValue(venue, ["currentPrice", "price"]),
      changePrice: rowValue(venue, ["changePrice"]),
      changeRate: rowValue(venue, ["changeRate"]),
      tradingVolume: rowValue(venue, ["tradingVolume", "volume"]),
      tradingValue: rowValue(venue, ["tradingValue", "tradeAmount", "amount"]),
      marketCap: rowValue(venue, ["marketCap", "marketValue"]),
    }];
  });
}

function domesticOrder(category: RankingCategory) {
  return category === "tradingValue" ? "priceTop"
    : category === "volume" ? "quantTop"
      : category === "up" ? "up"
        : category === "down" ? "down" : "marketSum";
}

function foreignOrder(category: RankingCategory) {
  return category === "tradingValue" ? "priceTop"
    : category === "volume" ? "quantTop"
      : category === "up" ? "up"
        : category === "down" ? "down" : "marketValue";
}

async function domesticRanking(category: RankingCategory) {
  const primary = await naverJson<unknown>(buildNaverPath("/api/domestic/market/stock/default", {
    tradeType: "KRX", marketType: "ALL", orderType: domesticOrder(category), startIdx: 0, pageSize: 10,
  }), { ttlMs: 15_000, staleMs: 5 * 60_000 });
  if (uniqueItems("KR", primary.data).length) return primary;

  // Before the KRX regular session Naver's legacy KRX ranking returns HTTP 200 + [] for
  // trading value/volume/rise/fall, while the public site continues to show live NXT data.
  if (category === "tradingValue" || category === "volume") {
    const v3 = await naverJson<unknown>(buildNaverPath("/api/stockSecurity/individual-stocks/v3/domestic", {
      listingType: domesticV3ListingType(category), exchangeType: "consolidated", index: 0, size: 10,
    }), { ttlMs: 15_000, staleMs: 5 * 60_000 });
    const rows = domesticV3Rows(v3.data, category);
    if (rows.length) return { ...v3, data: rows };
  }

  const nxt = await naverJson<unknown>(buildNaverPath("/api/domestic/market/stock/default", {
    tradeType: "NXT", marketType: "ALL", orderType: domesticOrder(category), startIdx: 0, pageSize: 10,
  }), { ttlMs: 15_000, staleMs: 5 * 60_000 });
  if (uniqueItems("KR", nxt.data).length) return nxt;

  return primary;
}

async function foreignRanking(category: RankingCategory) {
  return naverJson<unknown>(buildNaverPath("/api/foreign/market/stock/global", {
    nation: "usa", tradeType: "ALL", orderType: foreignOrder(category), startIdx: 0, pageSize: 10,
  }), { ttlMs: 15_000, staleMs: 5 * 60_000 });
}

async function cryptoRanking(category: RankingCategory) {
  const sortType = category === "up" ? "up" : category === "down" ? "down" : category === "marketCap" ? "marketValue" : "top";
  return naverJson<unknown>(buildNaverPath("/api/coin/rank/UPBIT", {
    sortType, page: 1, pageSize: category === "volume" ? 100 : 10,
  }), { ttlMs: 15_000, staleMs: 5 * 60_000 });
}

export async function getMarketRanking(market: RankingMarket, categoryInput: string): Promise<MarketRankingResult> {
  const category = CATEGORY_SET.has(categoryInput as RankingCategory) ? categoryInput as RankingCategory : "tradingValue";
  const result = market === "KR" ? await domesticRanking(category) : market === "US" ? await foreignRanking(category) : await cryptoRanking(category);
  const normalized = uniqueItems(market, result.data);
  let items = rank(normalized, category, market !== "CRYPTO" || category !== "volume");
  if (!items.length) throw new Error("NAVER_RANKING_EMPTY");
  if (market === "US") items = await enrichUsMetadata(items);
  if (market === "KR") items = await enrichDomesticMarkets(items);
  return { market, category, items, source: "NAVER", fetchedAt: result.fetchedAt, stale: result.stale, pollingInterval: 15_000 };
}
