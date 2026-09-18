const NAVER_MARKET_INDEX_BASE_URL = "https://api.stock.naver.com";
const CACHE_LIMIT = 96;

type CacheEntry = {
  data: unknown;
  expiresAt: number;
  staleUntil: number;
};

type JsonResult = {
  data: unknown;
  fetchedAt: number;
  stale: boolean;
};

export type UsdKrwMarketIndexDetail = {
  rate: number;
  change: number;
  changeRate: number;
  referencePrice?: number;
  timestamp: number;
  cashBuy?: number;
  cashSell?: number;
  send?: number;
  receive?: number;
};

export type UsdKrwHistoryPoint = {
  time: number;
  close: number;
  cashBuy?: number;
  cashSell?: number;
  send?: number;
  receive?: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<JsonResult>>();

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string"
      ? Number(value.replace(/[,%원$]/g, "").trim())
      : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function allowedPath(path: string) {
  return path === "/marketindex/exchange/FX_USDKRW"
    || /^\/marketindex\/exchange\/FX_USDKRW\/prices\?page=\d+&pageSize=\d+$/.test(path);
}

async function fetchJson(path: string) {
  if (!allowedPath(path)) throw new Error("NAVER_MARKET_INDEX_PATH_NOT_ALLOWED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${NAVER_MARKET_INDEX_BASE_URL}${path}`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.5",
        referer: "https://m.stock.naver.com/",
        "user-agent": "Mozilla/5.0 MarketMate/2.0 (+public-read-only)",
      },
    });
    if (!response.ok) throw new Error(`NAVER_MARKET_INDEX_HTTP_${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error("NAVER_MARKET_INDEX_EMPTY");
    const payload = JSON.parse(text) as unknown;
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (record.error || record.detailCode || record.isSuccess === false) throw new Error("NAVER_MARKET_INDEX_API_ERROR");
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function naverMarketIndexJson(path: string, ttlMs: number, staleMs: number): Promise<JsonResult> {
  const now = Date.now();
  const cached = cache.get(path);
  if (cached && cached.expiresAt > now) return { data: cached.data, fetchedAt: now, stale: false };
  if (cached && cached.staleUntil > now) {
    const refresh = inflight.get(path) ?? fetchJson(path)
      .then(data => {
        const fetchedAt = Date.now();
        cache.set(path, { data, expiresAt: fetchedAt + ttlMs, staleUntil: fetchedAt + staleMs });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        return { data, fetchedAt, stale: false };
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, refresh);
    void refresh.catch(() => undefined);
    return { data: cached.data, fetchedAt: now, stale: true };
  }
  const existing = inflight.get(path);
  if (existing) return existing;
  const request = fetchJson(path)
    .then(data => {
      const fetchedAt = Date.now();
      cache.set(path, { data, expiresAt: fetchedAt + ttlMs, staleUntil: fetchedAt + staleMs });
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      return { data, fetchedAt, stale: false };
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}

function records(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 6 || output.length > 600 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) records(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") records(child, depth + 1, output);
  return output;
}

function parseTime(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const raw = String(Math.trunc(value));
    if (/^(?:19|20)\d{6}$/.test(raw)) {
      const parsed = Date.parse(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T00:00:00+09:00`);
      if (Number.isFinite(parsed)) return parsed;
    }
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return fallback;
  const clean = value.trim();
  if (/^(?:19|20)\d{6}$/.test(clean)) {
    const parsed = Date.parse(`${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}T00:00:00+09:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function priceRow(record: Record<string, unknown>, fallback: number): UsdKrwHistoryPoint | null {
  const close = asNumber(
    record.closePrice,
    record.basePrice,
    record.standardPrice,
    record.exchangeRate,
    record.price,
    record.value,
  );
  if (close <= 0) return null;
  const time = parseTime(
    record.localTradedAt
      ?? record.localDate
      ?? record.tradeDate
      ?? record.date
      ?? record.businessDate
      ?? record.baseDate,
    fallback,
  );
  return {
    time,
    close,
    cashBuy: asNumber(record.cashBuyValue, record.cashBuyPrice, record.cashBuyingPrice) || undefined,
    cashSell: asNumber(record.cashSellValue, record.cashSellPrice, record.cashSellingPrice) || undefined,
    send: asNumber(record.sendValue, record.remittanceSendValue, record.sendPrice) || undefined,
    receive: asNumber(record.receiveValue, record.remittanceReceiveValue, record.receivePrice) || undefined,
  };
}

export async function getNaverUsdKrwMarketIndexHistory(days = 367) {
  const pageSize = 100;
  const pageCount = Math.min(4, Math.max(1, Math.ceil((days + 10) / pageSize)));
  const settled = await Promise.allSettled(
    Array.from({ length: pageCount }, (_, index) =>
      naverMarketIndexJson(
        `/marketindex/exchange/FX_USDKRW/prices?page=${index + 1}&pageSize=${pageSize}`,
        5 * 60_000,
        60 * 60_000,
      ),
    ),
  );
  const points: UsdKrwHistoryPoint[] = [];
  let stale = false;
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    stale = stale || result.value.stale;
    const found = records(result.value.data)
      .map((row, index) => priceRow(row, result.value.fetchedAt - index * 86_400_000))
      .filter((row): row is UsdKrwHistoryPoint => Boolean(row));
    points.push(...found);
  }
  const sorted = points
    .sort((a, b) => a.time - b.time)
    .filter((point, index, all) => index === 0 || point.time !== all[index - 1].time);
  if (!sorted.length) throw new Error("NAVER_FX_HISTORY_UNAVAILABLE");
  return { points: sorted.slice(-Math.max(20, days)), stale };
}

export async function getNaverUsdKrwMarketIndexDetail(): Promise<UsdKrwMarketIndexDetail> {
  const [detailResult, historyResult] = await Promise.all([
    naverMarketIndexJson("/marketindex/exchange/FX_USDKRW", 30_000, 10 * 60_000),
    getNaverUsdKrwMarketIndexHistory(12).catch(() => null),
  ]);
  const detail = records(detailResult.data).find(record =>
    asNumber(record.closePrice, record.currentPrice, record.price, record.value) > 0,
  ) ?? records(detailResult.data)[0];
  const latest = historyResult?.points.at(-1);
  const rate = detail ? asNumber(detail.closePrice, detail.currentPrice, detail.price, detail.value) : latest?.close ?? 0;
  if (rate <= 0) throw new Error("NAVER_FX_UNAVAILABLE");
  const change = detail ? asNumber(detail.fluctuations, detail.compareToPreviousClosePrice, detail.changePrice, detail.change) : 0;
  const changeRate = detail ? asNumber(detail.fluctuationsRatio, detail.changeRate, detail.rate) : 0;
  const timestamp = detail
    ? parseTime(detail.localTradedAt ?? detail.tradeDate ?? detail.date, detailResult.fetchedAt)
    : detailResult.fetchedAt;
  return {
    rate,
    change,
    changeRate,
    referencePrice: rate - change > 0 ? rate - change : undefined,
    timestamp,
    cashBuy: latest?.cashBuy,
    cashSell: latest?.cashSell,
    send: latest?.send,
    receive: latest?.receive,
  };
}
