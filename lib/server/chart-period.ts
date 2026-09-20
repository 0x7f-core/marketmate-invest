import type { ChartPoint } from "@/lib/server/market-data";

export const CHART_PERIODS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];
export type ChartTimezone = "Asia/Seoul" | "America/New_York";
export type NaverCandlePeriod = "dayCandle" | "weekCandle" | "monthCandle" | "yearCandle";

// The chart controls select the candle interval. These windows keep the
// daily view close to the previous three-month chart while giving aggregated
// views enough source rows to form useful candles.
const CHART_HISTORY_DAYS: Record<ChartPeriod, number> = {
  DAY: 95,
  WEEK: 730,
  MONTH: 1825,
  YEAR: 3650,
};

export function isChartPeriod(value: string | null | undefined): value is ChartPeriod {
  return Boolean(value && (CHART_PERIODS as readonly string[]).includes(value));
}

export function legacyRangeToChartPeriod(value: string | null | undefined): ChartPeriod | null {
  if (!value) return null;
  if (value === "1W") return "WEEK";
  if (["1D", "1M", "3M", "1Y"].includes(value)) return "DAY";
  return null;
}

export function chartPeriodHistoryDays(period: ChartPeriod) {
  return CHART_HISTORY_DAYS[period];
}

export function naverCandlePeriod(period: ChartPeriod): NaverCandlePeriod {
  if (period === "DAY") return "dayCandle";
  if (period === "WEEK") return "weekCandle";
  if (period === "MONTH") return "monthCandle";
  return "yearCandle";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function localDateParts(time: number, timezone: ChartTimezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return year > 0 && month > 0 && day > 0 ? { year, month, day } : null;
}

function bucketKey(time: number, period: ChartPeriod, timezone: ChartTimezone) {
  const local = localDateParts(time, timezone);
  if (!local) return "";
  if (period === "YEAR") return String(local.year);
  if (period === "MONTH") return `${local.year}-${pad(local.month)}`;
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (period === "WEEK") day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return dateKey(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

function bucketTime(key: string, period: ChartPeriod) {
  const parts = key.split("-").map(Number);
  if (period === "YEAR") return Date.UTC(parts[0], 0, 1);
  if (period === "MONTH") return Date.UTC(parts[0], parts[1] - 1, 1);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function sortedUnique(points: ChartPoint[]) {
  return points
    .filter(point => Number.isFinite(point.time) && point.time > 0 && point.close > 0)
    .sort((a, b) => a.time - b.time)
    .filter((point, index, all) => index === 0 || point.time !== all[index - 1].time);
}

export function aggregateChartPoints(points: ChartPoint[], period: ChartPeriod, timezone: ChartTimezone) {
  const buckets = new Map<string, ChartPoint>();
  for (const point of sortedUnique(points)) {
    const key = bucketKey(point.time, period, timezone);
    if (!key) continue;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        time: bucketTime(key, period),
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: point.volume,
      });
      continue;
    }
    existing.high = Math.max(existing.high, point.high);
    existing.low = Math.min(existing.low, point.low);
    existing.close = point.close;
    if (point.volume !== undefined && Number.isFinite(point.volume)) {
      existing.volume = (existing.volume ?? 0) + point.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function finalizeChartPoints(
  points: ChartPoint[],
  period: ChartPeriod,
  timezone: ChartTimezone,
  days = chartPeriodHistoryDays(period),
) {
  const sorted = sortedUnique(points);
  const since = Date.now() - days * 86_400_000;
  const ranged = sorted.filter(point => point.time >= since);
  const source = ranged.length ? ranged : sorted;
  return aggregateChartPoints(source, period, timezone).slice(-400);
}
