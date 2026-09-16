import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import type { ChartPoint } from "@/lib/server/market-data";

const RANGE_DAYS: Record<string, number> = { "1D": 2, "1W": 8, "1M": 32, "3M": 94, "1Y": 367 };

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%원$]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function records(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 7 || output.length >= 800 || value === null || value === undefined) return output;
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
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function point(row: Record<string, unknown>, fallback: number): ChartPoint | null {
  const close = asNumber(row.closePrice, row.close, row.currentPrice, row.nowPrice, row.tradePrice, row.price, row.basePrice, row.lastPrice);
  if (close <= 0) return null;
  const dateValue = row.localTradedAt ?? row.tradeDate ?? row.localDate ?? row.date ?? row.businessDate ?? row.bizDate ?? row.bizdate ?? row.baseDate ?? row.xymd ?? row.dateTime ?? row.datetime;
  const open = asNumber(row.openPrice, row.open, row.openingPrice) || close;
  const high = asNumber(row.highPrice, row.high, row.highestPrice) || close;
  const low = asNumber(row.lowPrice, row.low, row.lowestPrice) || close;
  return {
    time: parseTime(dateValue, fallback),
    open,
    high,
    low,
    close,
    volume: asNumber(row.accumulatedTradingVolume, row.accumulatedVolume, row.volume, row.tradeVolume) || undefined,
  };
}

function normalizedPoints(payload: unknown, fetchedAt: number, range: string, days: number) {
  const all = records(payload)
    .map((row, index) => point(row, fetchedAt - index * 86_400_000))
    .filter((item): item is ChartPoint => Boolean(item))
    .sort((a, b) => a.time - b.time)
    .filter((item, index, list) => index === 0 || item.time !== list[index - 1].time);
  const since = Date.now() - days * 86_400_000;
  const ranged = range === "1Y" ? all : all.filter(item => item.time >= since);
  return (ranged.length ? ranged : all).slice(-400);
}

export async function getDomesticChartSeries(symbol: string, range: string) {
  const days = RANGE_DAYS[range];
  if (!days) throw new Error("INVALID_CHART_RANGE");

  const primary = await naverJson<unknown>(
    buildNaverPath(`/api/securityService/chart/domestic/item/${encodeURIComponent(symbol)}`, { periodType: "day" }),
    { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 2_500 },
  );
  let points = normalizedPoints(primary.data, primary.fetchedAt, range, days);
  let stale = primary.stale;

  if (!points.length) {
    const fallback = await naverJson<unknown>(
      buildNaverPath(`/api/stockSecurity/items/v2/domestic/${encodeURIComponent(symbol)}/daily-prices`, { size: Math.min(100, Math.max(40, days + 8)) }),
      { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 2_500 },
    );
    points = normalizedPoints(fallback.data, fallback.fetchedAt, range, days);
    stale = stale || fallback.stale;
  }

  return { points, range, stale, source: "NAVER" as const };
}
