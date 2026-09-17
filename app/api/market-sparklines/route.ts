import { getMarketOverview, type MarketIndexQuote } from "@/lib/server/market-data";
import { getNaverUsdKrwRate } from "@/lib/server/naver-fx";
import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";

type Row = Record<string, unknown>;
type SparkPoint = { time: number; value: number };
type SparkSeries = { points: SparkPoint[]; stale: boolean };

const PRICE_KEYS = [
  "closePrice", "close", "currentPrice", "tradePrice", "price", "value", "nowPrice",
  "basePrice", "dealBasR", "exchangeRate", "rate", "y",
] as const;
const TIME_KEYS = [
  "localTradedAt", "koreaTradedAt", "tradeDateTime", "tradedAt", "dateTime", "datetime",
  "candleDateTimeKst", "candleDateTimeUtc", "timestamp", "time", "date", "localDate",
  "tradeDate", "businessDate", "bizDate", "baseDate", "xymd", "x",
] as const;

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Number(value.replace(/[,%원$]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactTimestamp(value: string) {
  if (/^(?:19|20)\d{12}$/.test(value)) {
    const parsed = Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (/^(?:19|20)\d{6}$/.test(value)) {
    const parsed = Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00+09:00`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseTime(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const compact = compactTimestamp(String(Math.trunc(value)));
    if (compact) return compact;
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return fallback;
  const clean = value.trim();
  const compact = compactTimestamp(clean);
  if (compact) return compact;
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && clean.length >= 10) return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectRows(value: unknown, depth = 0, output: Row[] = []) {
  if (depth > 7 || output.length >= 2_500 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRows(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const row = value as Row;
  if (Object.keys(row).some(key => PRICE_KEYS.includes(key as (typeof PRICE_KEYS)[number]) || TIME_KEYS.includes(key as (typeof TIME_KEYS)[number]))) {
    output.push(row);
  }
  for (const child of Object.values(row)) if (child && typeof child === "object") collectRows(child, depth + 1, output);
  return output;
}

function pointFromRow(row: Row, fallback: number): SparkPoint | null {
  let value = 0;
  for (const key of PRICE_KEYS) {
    value = numberValue(row[key]);
    if (value > 0) break;
  }
  if (value <= 0) return null;
  let rawTime: unknown;
  for (const key of TIME_KEYS) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      rawTime = row[key];
      break;
    }
  }
  if (rawTime === undefined) return null;
  const time = parseTime(rawTime, fallback);
  return time > 0 ? { time, value } : null;
}

function pairPoints(value: unknown, fallback: number, output: SparkPoint[] = [], depth = 0) {
  if (depth > 7 || output.length >= 2_500 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    if (value.length >= 2 && (typeof value[0] === "string" || typeof value[0] === "number") && (typeof value[1] === "string" || typeof value[1] === "number")) {
      const time = parseTime(value[0], fallback);
      const price = numberValue(value[1]);
      if (time > 0 && price > 0) output.push({ time, value: price });
    }
    for (const child of value) pairPoints(child, fallback, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Row)) if (child && typeof child === "object") pairPoints(child, fallback, output, depth + 1);
  }
  return output;
}

function normalizePoints(payloads: Array<{ data: unknown; fetchedAt: number }>) {
  const points: SparkPoint[] = [];
  for (const payload of payloads) {
    points.push(...collectRows(payload.data).map((row, index) => pointFromRow(row, payload.fetchedAt - index * 60_000)).filter((point): point is SparkPoint => Boolean(point)));
    points.push(...pairPoints(payload.data, payload.fetchedAt));
  }
  return points
    .filter(point => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => a.time - b.time)
    .filter((point, index, all) => index === 0 || point.time !== all[index - 1].time || point.value !== all[index - 1].value)
    .slice(-500);
}

function dateKey(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function compactDate(timestamp: number, timeZone: string) {
  return dateKey(timestamp, timeZone).replaceAll("-", "");
}

function latestTradingDay(points: SparkPoint[], timeZone: string) {
  if (!points.length) return points;
  const latest = dateKey(points[points.length - 1].time, timeZone);
  const sameDay = points.filter(point => dateKey(point.time, timeZone) === latest);
  return sameDay.length >= 2 ? sameDay : points;
}

function compactUtc(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function quoteById(quotes: MarketIndexQuote[], id: string) {
  return quotes.find(quote => quote.id === id);
}

function fallbackSeries(price: number, timestamp: number): SparkSeries {
  if (!Number.isFinite(price) || price <= 0) return { points: [], stale: true };
  const anchor = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  return { points: [{ time: anchor - 60 * 60_000, value: price }, { time: anchor, value: price }], stale: true };
}

async function domesticIndexSeries(code: "KOSPI" | "KOSDAQ", anchor: number) {
  const thistime = compactDate(anchor || Date.now(), "Asia/Seoul");
  const attempts = await Promise.allSettled(
    [0, 100, 200, 300].map(startIdx => naverJson<unknown>(
      buildNaverPath("/api/domestic/indexSise/time", { koreaIndexType: code, thistime, startIdx, pageSize: 100 }),
      { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_000 },
    )),
  );
  const payloads = attempts.flatMap(attempt => attempt.status === "fulfilled" ? [{ data: attempt.value.data, fetchedAt: attempt.value.fetchedAt }] : []);
  const points = latestTradingDay(normalizePoints(payloads), "Asia/Seoul");
  return { points, stale: attempts.some(attempt => attempt.status === "fulfilled" && attempt.value.stale) } satisfies SparkSeries;
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
  return { points: latestTradingDay(normalizePoints([{ data: result.data, fetchedAt: result.fetchedAt }]), "America/New_York"), stale: result.stale } satisfies SparkSeries;
}

async function bitcoinSeries(anchor: number) {
  const end = new Date((anchor || Date.now()) + 5 * 60_000);
  const start = new Date(end.getTime() - 26 * 60 * 60_000);
  const result = await naverJson<unknown>(
    buildNaverPath("/api/coin/candle/UPBIT/KRW/BTC/minutes/5", { from: start.toISOString(), to: end.toISOString() }),
    { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_500 },
  );
  return { points: latestTradingDay(normalizePoints([{ data: result.data, fetchedAt: result.fetchedAt }]), "Asia/Seoul"), stale: result.stale } satisfies SparkSeries;
}

async function usdKrwSeries() {
  const result = await naverJson<unknown>(
    buildNaverPath("/api/stockSecurity/exchange-rates/v2/USD/charts/round", { bankType: "hana" }),
    { ttlMs: 60_000, staleMs: 30 * 60_000, timeoutMs: 3_500 },
  );
  return { points: latestTradingDay(normalizePoints([{ data: result.data, fetchedAt: result.fetchedAt }]), "Asia/Seoul"), stale: result.stale } satisfies SparkSeries;
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

  const fallback = [
    fallbackSeries(kospi?.price ?? 0, kospi?.timestamp ?? Date.now()),
    fallbackSeries(kosdaq?.price ?? 0, kosdaq?.timestamp ?? Date.now()),
    fallbackSeries(spx?.price ?? 0, spx?.timestamp ?? Date.now()),
    fallbackSeries(comp?.price ?? 0, comp?.timestamp ?? Date.now()),
    fallbackSeries(btc?.price ?? 0, btc?.timestamp ?? Date.now()),
    fallbackSeries(fx?.rate ?? 0, fx?.fetchedAt ?? Date.now()),
  ];
  const ids = ["KOSPI", "KOSDAQ", "SPX", "COMP", "BTC", "USDKRW"] as const;
  const series = Object.fromEntries(ids.map((id, index) => {
    const job = jobs[index];
    const value = job.status === "fulfilled" && job.value.points.length >= 2 ? job.value : fallback[index];
    return [id, value];
  }));

  return Response.json(
    { series, pollingInterval: 60_000, timestamp: Date.now() },
    { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30" } },
  );
}
