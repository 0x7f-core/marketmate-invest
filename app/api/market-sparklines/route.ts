import { getMarketOverview, type MarketIndexQuote } from "@/lib/server/market-data";
import { getNaverUsdKrwRate } from "@/lib/server/naver-fx";
import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";

type Row = Record<string, unknown>;
type SparkPoint = { time: number; value: number };
type SparkSeries = { points: SparkPoint[]; stale: boolean };

const MAX_POINTS = 500;

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Number(value.replace(/[,%원$]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowValue(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function compactKstTimestamp(value: unknown) {
  const clean = String(value ?? "").trim();
  if (!/^(?:19|20)\d{12}$/.test(clean)) return 0;
  const parsed = Date.parse(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T${clean.slice(8, 10)}:${clean.slice(10, 12)}:${clean.slice(12, 14)}+09:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function compactDate(timestamp: number, timeZone: string) {
  return dateKey(timestamp, timeZone).replaceAll("-", "");
}

function localClockMinutes(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "0";
  return Number(part("hour")) * 60 + Number(part("minute"));
}

function normalize(points: SparkPoint[]) {
  const byTime = new Map<number, SparkPoint>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value) || point.time <= 0 || point.value <= 0) continue;
    byTime.set(point.time, point);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function latestTradingDay(points: SparkPoint[], timeZone: string) {
  const sorted = normalize(points);
  if (!sorted.length) return sorted;
  const latest = dateKey(sorted[sorted.length - 1].time, timeZone);
  const sameDay = sorted.filter(point => dateKey(point.time, timeZone) === latest);
  return sameDay.length >= 2 ? sameDay : sorted;
}

function downsample(points: SparkPoint[], maxPoints = MAX_POINTS) {
  if (points.length <= maxPoints) return points;
  const result: SparkPoint[] = [];
  const lastIndex = points.length - 1;
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    const point = points[sourceIndex];
    if (!result.length || result[result.length - 1].time !== point.time) result.push(point);
  }
  return result;
}

function finalPoints(points: SparkPoint[], timeZone: string) {
  return downsample(latestTradingDay(points, timeZone));
}

function compactUtc(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function localIso(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

function quoteById(quotes: MarketIndexQuote[], id: string) {
  return quotes.find(quote => quote.id === id);
}

function domesticPoints(data: unknown) {
  if (!Array.isArray(data)) return [];
  return data.flatMap(item => {
    const row = rowValue(item);
    if (!row) return [];
    const time = compactKstTimestamp(row.thistime);
    const value = numberValue(row.nowVal);
    return time > 0 && value > 0 ? [{ time, value }] : [];
  });
}

function foreignPoints(data: unknown) {
  const payload = rowValue(data);
  const candles = payload && Array.isArray(payload.candleList) ? payload.candleList : [];
  return candles.flatMap(item => {
    const row = rowValue(item);
    if (!row) return [];
    const time = isoTimestamp(row.tradeAt);
    const value = numberValue(row.closePrice);
    if (time <= 0 || value <= 0) return [];
    const minute = localClockMinutes(time, "America/New_York");
    return minute >= 9 * 60 + 30 && minute <= 16 * 60 ? [{ time, value }] : [];
  });
}

function bitcoinPoints(data: unknown) {
  const payload = rowValue(data);
  const priceInfos = payload && Array.isArray(payload.priceInfos)
    ? payload.priceInfos
    : Array.isArray(data) ? data : [];
  return priceInfos.flatMap(item => {
    const row = rowValue(item);
    if (!row) return [];
    const time = isoTimestamp(row.tradeBaseAt);
    const value = numberValue(row.closePrice);
    return time > 0 && value > 0 ? [{ time, value }] : [];
  });
}

function fxPoints(data: unknown) {
  const payload = rowValue(data);
  const priceInfos = payload && Array.isArray(payload.priceInfos) ? payload.priceInfos : [];
  return priceInfos.flatMap(item => {
    const row = rowValue(item);
    if (!row) return [];
    const time = compactKstTimestamp(row.tradeBaseAt ?? row.announcedAt);
    const value = numberValue(row.currentPrice);
    return time > 0 && value > 0 ? [{ time, value }] : [];
  });
}

function fallbackSeries(): SparkSeries {
  return { points: [], stale: true };
}

async function domesticIndexSeries(code: "KOSPI" | "KOSDAQ", anchor: number) {
  const thistime = compactDate(anchor || Date.now(), "Asia/Seoul");
  const attempts = await Promise.allSettled(
    [0, 100, 200, 300].map(startIdx => naverJson<unknown>(
      buildNaverPath("/api/domestic/indexSise/time", { koreaIndexType: code, thistime, startIdx, pageSize: 100 }),
      { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_000 },
    )),
  );
  const points = attempts.flatMap(attempt => attempt.status === "fulfilled" ? domesticPoints(attempt.value.data) : []);
  return {
    points: finalPoints(points, "Asia/Seoul"),
    stale: attempts.some(attempt => attempt.status === "rejected" || attempt.value.stale),
  } satisfies SparkSeries;
}

async function foreignIndexSeries(code: ".INX" | ".IXIC", exchange: "NYSE" | "NASDAQ", anchor: number) {
  const center = anchor || Date.now();
  const result = await naverJson<unknown>(
    buildNaverPath(`/api/securityService/chart/foreign/INDEX/${exchange}/${code}/interval/5`, {
      startDateTime: compactUtc(center - 18 * 60 * 60_000),
      endDateTime: compactUtc(center + 6 * 60 * 60_000),
      utc: true,
    }),
    { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_500 },
  );
  return {
    points: finalPoints(foreignPoints(result.data), "America/New_York"),
    stale: result.stale,
  } satisfies SparkSeries;
}

async function bitcoinSeries(anchor: number) {
  const center = anchor || Date.now();
  const result = await naverJson<unknown>(
    buildNaverPath("/api/coin/candle/UPBIT/KRW/BTC/minutes/5/marketInfo", {
      from: localIso(center - 26 * 60 * 60_000, "Asia/Seoul"),
      to: localIso(center + 5 * 60_000, "Asia/Seoul"),
    }),
    { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_500 },
  );
  return {
    points: finalPoints(bitcoinPoints(result.data), "Asia/Seoul"),
    stale: result.stale,
  } satisfies SparkSeries;
}

async function usdKrwSeries() {
  const result = await naverJson<unknown>(
    buildNaverPath("/api/stockSecurity/exchange-rates/v2/USD/charts/round", { bankType: "hana" }),
    { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 3_500 },
  );
  return {
    points: finalPoints(fxPoints(result.data), "Asia/Seoul"),
    stale: result.stale,
  } satisfies SparkSeries;
}

export async function GET() {
  const [overviewResult, fxResult] = await Promise.allSettled([
    getMarketOverview(),
    getNaverUsdKrwRate(),
  ]);
  const quotes = overviewResult.status === "fulfilled" ? overviewResult.value : [];
  const kospi = quoteById(quotes, "KOSPI");
  const kosdaq = quoteById(quotes, "KOSDAQ");
  const spx = quoteById(quotes, "SPX");
  const comp = quoteById(quotes, "COMP");
  const btc = quoteById(quotes, "BTC");
  const fx = fxResult.status === "fulfilled" ? fxResult.value : null;

  const jobs = await Promise.allSettled([
    domesticIndexSeries("KOSPI", kospi?.timestamp ?? Date.now()),
    domesticIndexSeries("KOSDAQ", kosdaq?.timestamp ?? Date.now()),
    foreignIndexSeries(".INX", "NYSE", spx?.timestamp ?? Date.now()),
    foreignIndexSeries(".IXIC", "NASDAQ", comp?.timestamp ?? Date.now()),
    bitcoinSeries(btc?.timestamp ?? Date.now()),
    usdKrwSeries(),
  ]);

  const ids = ["KOSPI", "KOSDAQ", "SPX", "COMP", "BTC", "USDKRW"] as const;
  const series = Object.fromEntries(ids.map((id, index) => {
    const job = jobs[index];
    const value = job.status === "fulfilled" && job.value.points.length >= 2 ? job.value : fallbackSeries();
    return [id, value];
  }));

  return Response.json(
    { series, pollingInterval: 60_000, timestamp: Date.now(), fxTimestamp: fx?.fetchedAt ?? null },
    { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30" } },
  );
}
