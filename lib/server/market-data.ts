import { env } from "cloudflare:workers";
import { buildNaverPath, naverJson, naverPolling } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, naverAutocompleteQueryForForeignCode, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";

export type Market = "KR" | "US" | "CRYPTO";
export type LiveQuote = {
  market: Market;
  symbol: string;
  price: number;
  change: number;
  changeRate: number;
  currency: "KRW" | "USD";
  exchangeRate: number;
  timestamp: number;
  timestampVerified?: boolean;
  source: "NAVER";
  stale?: boolean;
  pollingInterval?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type MarketIndexQuote = {
  id: string;
  name: string;
  market: Market;
  price: number;
  change: number;
  rate: number;
  unit: string;
  source: "NAVER";
  timestamp: number;
  stale?: boolean;
};

export type ChartPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type SearchInstrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
  currency: "KRW" | "USD";
};

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%원$]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function compactKstTimestamp(raw: string) {
  if (!/^(?:19|20)\d{12}$/.test(raw)) return 0;
  const parsed = Date.parse(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+09:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTimestamp(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const compact = compactKstTimestamp(String(Math.trunc(value)));
    if (compact > 0) return compact;
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return fallback;
  const clean = value.trim();
  const compact = compactKstTimestamp(clean);
  if (compact > 0) return compact;
  if (/^\d{8}$/.test(clean)) {
    const date = Date.parse(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00+09:00`);
    if (Number.isFinite(date)) return date;
  }
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && clean.length >= 10) return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeKoreaTimestamp(value: unknown, fallback: number) {
  if (typeof value === "string") {
    const clean = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(clean)) {
      const parsed = Date.parse(`${clean}+09:00`);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return normalizeTimestamp(value, fallback);
}

function verifiedQuoteTimestamp(record: Record<string, unknown>) {
  const koreaTradedAt = normalizeKoreaTimestamp(record.koreaTradedAt, 0);
  if (koreaTradedAt > 0) return koreaTradedAt;
  for (const key of [
    "localTradedAt",
    "tradeDateTime",
    "tradedAt",
    "tradeBaseAt",
    "tradeTimestamp",
  ]) {
    const parsed = normalizeTimestamp(record[key], 0);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function recordTimestamp(record: Record<string, unknown>, fallback: number) {
  const verified = verifiedQuoteTimestamp(record);
  if (verified > 0) return verified;
  for (const key of [
    "dateTime",
    "datetime",
    "timestamp",
    "candleDateTimeKst",
    "candleDateTimeUtc",
    "date",
    "localDate",
    "tradeDate",
    "bizDate",
    "businessDate",
    "baseDate",
    "xymd",
  ]) {
    const parsed = normalizeTimestamp(record[key], 0);
    if (parsed > 0) return parsed;
  }
  return fallback;
}

function pollingRow(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const datas = (payload as Record<string, unknown>).datas;
  return Array.isArray(datas) && datas[0] && typeof datas[0] === "object" ? datas[0] as Record<string, unknown> : null;
}

function quoteValues(row: Record<string, unknown>) {
  const price = asNumber(row.closePrice, row.currentPrice, row.nowPrice, row.tradePrice, row.price, row.lastPrice, row.last);
  const change = asNumber(row.compareToPreviousClosePrice, row.changePrice, row.change, row.netChange, row.prevChange);
  const changeRate = asNumber(row.fluctuationsRatio, row.changeRate, row.changeRatio, row.rate, row.prevChangeRate);
  return {
    price,
    change,
    changeRate,
    open: asNumber(row.openPrice, row.open, row.openingPrice),
    high: asNumber(row.highPrice, row.high, row.highestPrice),
    low: asNumber(row.lowPrice, row.low, row.lowestPrice),
    volume: asNumber(row.accumulatedTradingVolume, row.accumulatedVolume, row.volume, row.tradeVolume),
  };
}

function normalizeReutersForCompare(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function collectRecords(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 5 || output.length > 300 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some(key => /(?:item|stock|reuters|ticker|symbol|code|name)/i.test(key))) output.push(record);
  for (const child of Object.values(record)) if (typeof child === "object" && child !== null) collectRecords(child, depth + 1, output);
  return output;
}

const reutersCodeCache = new Map<string, { code: string; expiresAt: number }>();

async function resolveReutersCode(symbol: string, exchange?: string) {
  if (symbol.includes(".") || looksLikeCaseSensitiveReutersCode(symbol)) return normalizeNaverReutersCode(symbol);
  const key = `${symbol}:${(exchange ?? "").toUpperCase()}`;
  const cached = reutersCodeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.code;
  try {
    const query = naverAutocompleteQueryForForeignCode(symbol);
    const result = await naverJson<unknown>(buildNaverPath("/api/autocomplete/search/autoComplete", { query, target: "stock" }), { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 });
    const wanted = normalizeReutersForCompare(query);
    const candidates = collectRecords(result.data).map(record => ({
      code: stringValue(record, ["reutersCode", "reuterscode", "symbolCode", "stockCode", "itemCode", "code"]),
      ticker: stringValue(record, ["ticker", "symbol", "stockSymbol", "itemCode", "code"]),
      nation: stringValue(record, ["nationType", "nation", "country", "marketType"]),
    })).filter(item => item.code.length > 0);
    const match = candidates.find(item => normalizeReutersForCompare(item.ticker) === wanted || normalizeReutersForCompare(item.code.split(".")[0]) === wanted)
      ?? candidates.find(item => /USA|US|미국/i.test(item.nation))
      ?? candidates[0];
    if (match?.code) {
      const code = normalizeNaverReutersCode(match.code);
      reutersCodeCache.set(key, { code, expiresAt: Date.now() + 24 * 60 * 60_000 });
      return code;
    }
  } catch {
    // 검색 API가 일시 실패해도 네이버 Reuters 코드 규칙 안에서만 보조 식별자를 사용한다.
  }
  if (looksLikeCaseSensitiveReutersCode(symbol)) return normalizeNaverReutersCode(symbol);
  const normalizedExchange = (exchange ?? "").toUpperCase();
  const suffix = normalizedExchange.includes("NYS") || normalizedExchange.includes("NYSE") ? ".N"
    : normalizedExchange.includes("AMS") || normalizedExchange.includes("AMEX") ? ".A" : ".O";
  return normalizeNaverReutersCode(`${symbol.replaceAll("_", ".")}${suffix}`);
}

async function usdKrwRate() {
  const path = buildNaverPath("/api/securityService/integration/indicators", { indicatorCodes: "FX_USDKRW" });
  const result = await naverJson<unknown>(path, { ttlMs: 30_000, staleMs: 10 * 60_000 });
  const rows = collectRecords(result.data);
  const exact = rows.find(row => stringValue(row, ["itemCode", "code", "symbol"]) === "FX_USDKRW") ?? rows[0];
  const rate = exact ? asNumber(exact.currentPrice, exact.closePrice, exact.price, exact.value, exact.nowPrice) : 0;
  if (rate <= 0) throw new Error("NAVER_FX_UNAVAILABLE");
  return rate;
}

async function domesticQuote(symbol: string): Promise<LiveQuote> {
  const result = await naverPolling<unknown>(buildNaverPath("/api/polling/domestic/stock", { itemCodes: symbol }), { staleMs: 60_000 });
  const row = pollingRow(result.data);
  if (!row) throw new Error("NAVER_EMPTY_QUOTE");
  const values = quoteValues(row);
  if (values.price <= 0) throw new Error("NAVER_INVALID_QUOTE");
  const sourceTimestamp = verifiedQuoteTimestamp(row);
  return { market: "KR", symbol, ...values, currency: "KRW", exchangeRate: 1, timestamp: sourceTimestamp || result.fetchedAt, timestampVerified: sourceTimestamp > 0, source: "NAVER", stale: result.stale, pollingInterval: result.pollingInterval };
}

async function foreignQuote(symbol: string, exchange?: string): Promise<LiveQuote> {
  const code = await resolveReutersCode(symbol, exchange);
  const result = await naverPolling<unknown>(buildNaverPath("/api/polling/worldstock/stock", { reutersCodes: code }), { staleMs: 60_000 });
  const row = pollingRow(result.data);
  if (!row) throw new Error("NAVER_EMPTY_QUOTE");
  const values = quoteValues(row);
  if (values.price <= 0) throw new Error("NAVER_INVALID_QUOTE");
  const sourceTimestamp = verifiedQuoteTimestamp(row);
  return { market: "US", symbol, ...values, currency: "USD", exchangeRate: await usdKrwRate(), timestamp: sourceTimestamp || result.fetchedAt, timestampVerified: sourceTimestamp > 0, source: "NAVER", stale: result.stale, pollingInterval: result.pollingInterval };
}

function cryptoTicker(symbol: string) {
  return symbol.toUpperCase().replace(/^KRW-/, "").replace(/_KRW_(?:UPBIT|BITHUMB)$/, "");
}

async function cryptoQuote(symbol: string): Promise<LiveQuote> {
  const ticker = cryptoTicker(symbol);
  const fqnfTicker = `${ticker}_KRW_UPBIT`;
  const result = await naverPolling<unknown>(buildNaverPath("/api/polling/coin/price", { fqnfTickers: fqnfTicker }), { staleMs: 60_000 });
  const row = pollingRow(result.data);
  if (!row) throw new Error("NAVER_EMPTY_QUOTE");
  const values = quoteValues(row);
  if (values.price <= 0) throw new Error("NAVER_INVALID_QUOTE");
  const sourceTimestamp = verifiedQuoteTimestamp(row);
  return { market: "CRYPTO", symbol: `KRW-${ticker}`, ...values, currency: "KRW", exchangeRate: 1, timestamp: sourceTimestamp || result.fetchedAt, timestampVerified: sourceTimestamp > 0, source: "NAVER", stale: result.stale, pollingInterval: result.pollingInterval };
}

export async function getLiveQuote(market: Market, symbol: string, exchange?: string) {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) throw new Error("INVALID_SYMBOL");
  if (market === "KR") return domesticQuote(symbol.toUpperCase());
  if (market === "US") return foreignQuote(symbol, exchange);
  return cryptoQuote(symbol);
}

function indexQuote(row: Record<string, unknown>, id: string, name: string, market: Market, fetchedAt: number, stale: boolean): MarketIndexQuote | null {
  const values = quoteValues(row);
  if (values.price <= 0) return null;
  return { id, name, market, price: values.price, change: values.change, rate: values.changeRate, unit: market === "CRYPTO" ? "원" : "", source: "NAVER", timestamp: recordTimestamp(row, fetchedAt), stale };
}

export async function getMarketOverview() {
  const [domestic, foreign, crypto] = await Promise.allSettled([
    naverPolling<unknown>(buildNaverPath("/api/polling/domestic/index", { itemCodes: "KOSPI,KOSDAQ" }), { staleMs: 120_000 }),
    naverPolling<unknown>(buildNaverPath("/api/polling/worldstock/index", { reutersCodes: ".INX,.IXIC" }), { staleMs: 120_000 }),
    naverPolling<unknown>(buildNaverPath("/api/polling/coin/price", { fqnfTickers: "BTC_KRW_UPBIT" }), { staleMs: 120_000 }),
  ]);
  const quotes: MarketIndexQuote[] = [];
  if (domestic.status === "fulfilled") {
    const rows = ((domestic.value.data as Record<string, unknown>)?.datas ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const code = stringValue(row, ["itemCode", "code", "symbol"]);
      const mapped = code === "KOSDAQ" ? ["KOSDAQ", "코스닥"] : ["KOSPI", "코스피"];
      const quote = indexQuote(row, mapped[0], mapped[1], "KR", domestic.value.fetchedAt, domestic.value.stale);
      if (quote) quotes.push(quote);
    }
  }
  if (foreign.status === "fulfilled") {
    const rows = ((foreign.value.data as Record<string, unknown>)?.datas ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const code = stringValue(row, ["reutersCode", "itemCode", "code", "symbol"]);
      const mapped = code.includes("IXIC") ? ["COMP", "나스닥 종합"] : ["SPX", "S&P 500"];
      const quote = indexQuote(row, mapped[0], mapped[1], "US", foreign.value.fetchedAt, foreign.value.stale);
      if (quote) quotes.push(quote);
    }
  }
  if (crypto.status === "fulfilled") {
    const row = pollingRow(crypto.value.data);
    if (row) {
      const quote = indexQuote(row, "BTC", "비트코인", "CRYPTO", crypto.value.fetchedAt, crypto.value.stale);
      if (quote) quotes.push(quote);
    }
  }
  return quotes;
}

function chartRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === "object") as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["priceInfos", "candleList", "prices", "contents", "items", "data", "datas"]) {
    const rows = record[key];
    if (Array.isArray(rows)) return rows.filter(item => item && typeof item === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

function chartPoint(row: Record<string, unknown>, fallback: number): ChartPoint | null {
  const close = asNumber(row.closePrice, row.close, row.currentPrice, row.tradePrice, row.price, row.basePrice);
  if (close <= 0) return null;
  const open = asNumber(row.openPrice, row.open, row.openingPrice, close) || close;
  const high = asNumber(row.highPrice, row.high, row.highestPrice, close) || close;
  const low = asNumber(row.lowPrice, row.low, row.lowestPrice, close) || close;
  const time = recordTimestamp(row, fallback);
  return { time, open, high, low, close, volume: asNumber(row.accumulatedTradingVolume, row.volume, row.tradeVolume) || undefined };
}

const RANGE_DAYS: Record<string, number> = { "1D": 2, "1W": 8, "1M": 32, "3M": 94, "1Y": 367 };

export async function getChartSeries(market: Market, symbol: string, exchange: string | undefined, range: string) {
  const days = RANGE_DAYS[range];
  if (!days) throw new Error("INVALID_CHART_RANGE");
  let result: { data: unknown; fetchedAt: number; stale: boolean };
  if (market === "KR") {
    result = await naverJson<unknown>(buildNaverPath(`/api/securityService/chart/domestic/item/${encodeURIComponent(symbol)}`, { periodType: "day" }), { ttlMs: 60_000, staleMs: 30 * 60_000 });
  } else if (market === "US") {
    const code = await resolveReutersCode(symbol, exchange);
    result = await naverJson<unknown>(buildNaverPath(`/api/securityService/stock/${encodeURIComponent(code)}/price`, { page: 1, pageSize: Math.min(400, Math.max(30, days + 10)) }), { ttlMs: 60_000, staleMs: 30 * 60_000 });
  } else {
    const ticker = cryptoTicker(symbol);
    const to = new Date();
    const from = new Date(Date.now() - days * 86_400_000);
    result = await naverJson<unknown>(buildNaverPath(`/api/coin/candle/UPBIT/KRW/${encodeURIComponent(ticker)}/days`, { from: from.toISOString(), to: to.toISOString() }), { ttlMs: 30_000, staleMs: 15 * 60_000 });
  }
  const since = Date.now() - days * 86_400_000;
  const points = chartRows(result.data)
    .map((row, index) => chartPoint(row, result.fetchedAt - index * 86_400_000))
    .filter((point): point is ChartPoint => Boolean(point))
    .filter(point => range === "1Y" || point.time >= since)
    .sort((a, b) => a.time - b.time)
    .filter((point, index, all) => index === 0 || point.time !== all[index - 1].time)
    .slice(-400);
  return { points, range, stale: result.stale, source: "NAVER" as const };
}

export async function persistQuoteSnapshot(quote: LiveQuote) {
  if (!env.DB) return;
  const instrumentId = `${quote.market}:${quote.symbol}`;
  const sourceTimestamp = quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1_000 : quote.timestamp;
  const priceKrwMicros = Math.round(quote.price * quote.exchangeRate * 1_000_000);
  const fxRateMicros = Math.round(quote.exchangeRate * 1_000_000);
  const recordedAt = Math.floor(sourceTimestamp / 60_000) * 60_000;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO quote_snapshots (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM instruments WHERE id=?)
      ON CONFLICT(instrument_id) DO UPDATE SET price_micros=excluded.price_micros,change_micros=excluded.change_micros,
      change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros,source=excluded.source,
      source_timestamp=excluded.source_timestamp,received_at=excluded.received_at`)
      .bind(instrumentId, priceKrwMicros, Math.round(quote.change * quote.exchangeRate * 1_000_000), Math.round(quote.changeRate * 10_000), fxRateMicros, quote.source, sourceTimestamp, Date.now(), instrumentId),
    env.DB.prepare(`INSERT INTO price_history (id,instrument_id,price_micros,change_rate_ppm,fx_rate_micros,recorded_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM instruments WHERE id=?)
      ON CONFLICT(instrument_id,recorded_at) DO UPDATE SET price_micros=excluded.price_micros,change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros`)
      .bind(`${instrumentId}:${recordedAt}`, instrumentId, priceKrwMicros, Math.round(quote.changeRate * 10_000), fxRateMicros, recordedAt, instrumentId),
  ]);
  if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
    await env.DB.prepare("DELETE FROM price_history WHERE recorded_at<?").bind(Date.now() - 400 * 86_400_000).run().catch(() => undefined);
  }
}
