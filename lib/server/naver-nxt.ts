import { buildNaverPath, naverPolling } from "@/lib/server/naver-stock";
import type { LiveQuote } from "@/lib/server/market-data";

type Row = Record<string, unknown>;

function numberValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%원]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function firstRow(payload: unknown): Row | null {
  if (!payload || typeof payload !== "object") return null;
  const datas = (payload as Row).datas;
  return Array.isArray(datas) && datas[0] && typeof datas[0] === "object" ? datas[0] as Row : null;
}

function compactKstTimestamp(raw: string) {
  if (!/^(?:19|20)\d{12}$/.test(raw)) return 0;
  const converted = Date.parse(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+09:00`);
  return Number.isFinite(converted) ? converted : 0;
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const compact = compactKstTimestamp(String(Math.trunc(value)));
    if (compact > 0) return compact;
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return 0;
  const clean = value.trim();
  const compact = compactKstTimestamp(clean);
  if (compact > 0) return compact;
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && clean.length >= 10) return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseKoreaTimestamp(value: unknown) {
  if (typeof value === "string") {
    const clean = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(clean)) {
      const parsed = Date.parse(`${clean}+09:00`);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return parseTimestamp(value);
}

function rowTimestamp(row: Row) {
  const koreaTradedAt = parseKoreaTimestamp(row.koreaTradedAt);
  if (koreaTradedAt > 0) return koreaTradedAt;
  for (const key of ["localTradedAt", "tradeDateTime", "tradedAt", "tradeBaseAt", "tradeTimestamp"]) {
    const parsed = parseTimestamp(row[key]);
    if (parsed > 0) return parsed;
  }
  return 0;
}

export async function getNxtLiveQuote(symbolInput: string): Promise<LiveQuote> {
  const symbol = symbolInput.toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(symbol)) throw new Error("INVALID_SYMBOL");

  const result = await naverPolling<unknown>(
    buildNaverPath("/api/polling/domestic/NXT/stock", { itemCodes: symbol }),
    { staleMs: 60_000 },
  );
  const row = firstRow(result.data);
  if (!row) throw new Error("NAVER_EMPTY_QUOTE");

  const price = numberValue(row.closePrice, row.currentPrice, row.nowPrice, row.tradePrice, row.price, row.lastPrice, row.last);
  if (price <= 0) throw new Error("NAVER_INVALID_QUOTE");
  const timestamp = rowTimestamp(row);
  if (timestamp <= 0) throw new Error("NAVER_NXT_TIMESTAMP_UNAVAILABLE");

  return {
    market: "KR",
    symbol,
    price,
    change: numberValue(row.compareToPreviousClosePrice, row.changePrice, row.change, row.netChange, row.prevChange),
    changeRate: numberValue(row.fluctuationsRatio, row.changeRate, row.changeRatio, row.rate, row.prevChangeRate),
    currency: "KRW",
    exchangeRate: 1,
    timestamp,
    timestampVerified: true,
    source: "NAVER",
    stale: result.stale,
    pollingInterval: result.pollingInterval,
    open: numberValue(row.openPrice, row.open, row.openingPrice) || undefined,
    high: numberValue(row.highPrice, row.high, row.highestPrice) || undefined,
    low: numberValue(row.lowPrice, row.low, row.lowestPrice) || undefined,
    volume: numberValue(row.accumulatedTradingVolume, row.accumulatedVolume, row.volume, row.tradeVolume) || undefined,
  };
}
