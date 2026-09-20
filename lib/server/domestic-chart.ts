import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { chartPeriodHistoryDays, finalizeChartPoints, naverCandlePeriod, type ChartPeriod } from "@/lib/server/chart-period";
import { runChartFallback } from "@/lib/server/chart-fallback";
import type { ChartPoint } from "@/lib/server/market-data";

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%원$]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function records(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  // The native chart endpoint can return up to ten years of daily rows for
  // the long-period views. Keep enough records to cover that response while
  // retaining the recursion guard for unexpected payloads.
  if (depth > 7 || output.length >= 5000 || value === null || value === undefined) return output;
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
  const close = asNumber(row.closingPrice, row.closePrice, row.close, row.currentPrice, row.nowPrice, row.tradePrice, row.price, row.basePrice, row.lastPrice);
  if (close <= 0) return null;
  const dateValue = row.tradingDateKst ?? row.localTradedAt ?? row.tradeDate ?? row.localDate ?? row.date ?? row.businessDate ?? row.bizDate ?? row.bizdate ?? row.baseDate ?? row.xymd ?? row.dateTime ?? row.datetime;
  const open = asNumber(row.openPrice, row.open, row.openingPrice) || close;
  const high = asNumber(row.highPrice, row.high, row.highestPrice) || close;
  const low = asNumber(row.lowPrice, row.low, row.lowestPrice) || close;
  return {
    time: parseTime(dateValue, fallback),
    open,
    high,
    low,
    close,
    volume: asNumber(row.tradingVolume, row.accumulatedTradingVolume, row.accumulatedVolume, row.volume, row.tradeVolume) || undefined,
  };
}

function normalizedPoints(payload: unknown, fetchedAt: number) {
  return records(payload)
    .map((row, index) => point(row, fetchedAt - index * 86_400_000))
    .filter((item): item is ChartPoint => Boolean(item))
    .sort((a, b) => a.time - b.time)
    .filter((item, index, list) => index === 0 || item.time !== list[index - 1].time);
}

function dailyPriceRows(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const items = (payload as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

function dailyPriceCursor(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const cursor = (payload as Record<string, unknown>).cursor;
  return typeof cursor === "string" && cursor ? cursor : undefined;
}

function dailyPriceHasNext(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && (payload as Record<string, unknown>).hasNext);
}

async function getDomesticDailyHistory(symbol: string, period: ChartPeriod, days: number) {
  const pageSize = 100;
  // Keep the request bounded while following the cursor returned by Naver's
  // daily-prices endpoint. Longer candle intervals are aggregated below.
  const targetRows = Math.min(600, Math.max(80, Math.ceil(days * 0.75) + 8));
  const payloads: unknown[] = [];
  let fetchedAt = Date.now();
  let stale = false;
  let cursor: string | undefined;

  for (let page = 0; page < 6 && (page === 0 || payloads.flatMap(dailyPriceRows).length < targetRows); page += 1) {
    const result = await naverJson<unknown>(
      buildNaverPath(`/api/stockSecurity/items/v2/domestic/${encodeURIComponent(symbol)}/daily-prices`, {
        size: pageSize,
        cursor,
      }),
      { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 8_000 },
    );
    payloads.push(result.data);
    fetchedAt = result.fetchedAt;
    stale = stale || result.stale;
    if (!dailyPriceHasNext(result.data)) break;
    const nextCursor = dailyPriceCursor(result.data);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return {
    points: finalizeChartPoints(normalizedPoints(payloads, fetchedAt), period, "Asia/Seoul", days),
    stale,
  };
}

export async function getDomesticChartSeries(symbol: string, period: ChartPeriod) {
  const days = chartPeriodHistoryDays(period);
  const result = await runChartFallback([
    async () => {
      const chart = await naverJson<unknown>(
        buildNaverPath(`/api/securityService/chart/domestic/item/${encodeURIComponent(symbol)}`, {
          periodType: naverCandlePeriod(period),
        }),
        { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 10_000 },
      );
      const rawPoints = normalizedPoints(chart.data, chart.fetchedAt);
      if (rawPoints.length <= 1) return null;
      return {
        points: finalizeChartPoints(rawPoints, period, "Asia/Seoul", days),
        stale: chart.stale,
      };
    },
    async () => {
      // Keep the paged daily-price feed as a resilience fallback only. Normal
      // chart requests use the dedicated Naver candle endpoint above.
      const fallback = await getDomesticDailyHistory(symbol, period, days);
      return fallback.points.length > 1 ? fallback : null;
    },
    async () => {
      // Last resort: request the native daily chart and aggregate it locally.
      const fallback = await naverJson<unknown>(
        buildNaverPath(`/api/securityService/chart/domestic/item/${encodeURIComponent(symbol)}`, { periodType: "day" }),
        { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 4_000 },
      );
      const points = finalizeChartPoints(normalizedPoints(fallback.data, fallback.fetchedAt), period, "Asia/Seoul", days);
      return { points, stale: fallback.stale };
    },
  ]);
  return { ...result, period, source: "NAVER" as const };
}
