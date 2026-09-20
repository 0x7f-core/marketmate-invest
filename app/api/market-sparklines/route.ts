import { getNaverUsdKrwRate } from "@/lib/server/naver-fx";
import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";

type Row = Record<string, unknown>;
type SparkPoint = { time: number; value: number };
type SparkStatus = "preopen" | "open" | "closed";
type SparkSeries = { points: SparkPoint[]; stale: boolean; status?: SparkStatus; sessionTime?: number };

// Six compact cards do not benefit from hundreds of SVG segments. Keeping a
// bounded representative series makes the response and DOM much smaller while
// preserving the visible intraday shape.
const MAX_POINTS = 180;

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

function compactKstDate(value: unknown) {
  const clean = String(value ?? "").trim();
  if (!/^(?:19|20)\d{6}$/.test(clean)) return 0;
  const parsed = Date.parse(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00+09:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactForeignTimestamp(value: unknown) {
  const clean = String(value ?? "").trim();
  if (!/^(?:19|20)\d{12}$/.test(clean)) return 0;
  const parts = [
    Number(clean.slice(0, 4)),
    Number(clean.slice(4, 6)) - 1,
    Number(clean.slice(6, 8)),
    Number(clean.slice(8, 10)),
    Number(clean.slice(10, 12)),
    Number(clean.slice(12, 14)),
  ];
  const utcGuess = Date.UTC(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
  if (!Number.isFinite(utcGuess)) return 0;
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(localParts.find(item => item.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return Number.isFinite(localAsUtc) ? utcGuess - (localAsUtc - utcGuess) : 0;
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

function kstWeekday(timestamp: number) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(new Date(timestamp));
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}

function latestKstMarketTimestamp(timestamp: number) {
  let cursor = timestamp;
  if (kstWeekday(cursor) && localClockMinutes(cursor, "Asia/Seoul") < 9 * 60) {
    cursor -= 24 * 60 * 60_000;
  }
  while (!kstWeekday(cursor)) cursor -= 24 * 60 * 60_000;
  return cursor;
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
  const candles = payload && Array.isArray(payload.candleList)
    ? payload.candleList
    : payload && Array.isArray(payload.priceInfos)
      ? payload.priceInfos
      : [];
  return candles.flatMap(item => {
    const row = rowValue(item);
    if (!row) return [];
    const time = isoTimestamp(row.tradeAt) || compactForeignTimestamp(row.localDateTime);
    const value = numberValue(row.closePrice ?? row.currentPrice);
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

function domesticMarketStatus(value: unknown): SparkStatus {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "PREOPEN" || status === "BEFORE_OPEN") return "preopen";
  if (status === "OPEN" || status === "TRADING") return "open";
  return "closed";
}

async function domesticIndexSeries(code: "KOSPI" | "KOSDAQ", anchor: number) {
  const thistime = compactDate(latestKstMarketTimestamp(anchor || Date.now()), "Asia/Seoul");
  const attempts = await Promise.allSettled(
    [
      naverJson<unknown>(
        buildNaverPath(`/api/securityService/chart/domestic/index/${encodeURIComponent(code)}`, { periodType: "day" }),
        { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_500 },
      ),
      naverJson<unknown>(
        buildNaverPath("/api/domestic/indexSise/time", { koreaIndexType: code, thistime, startIdx: 0, pageSize: 100 }),
        { ttlMs: 60_000, staleMs: 20 * 60_000, timeoutMs: 3_000 },
      ),
    ],
  );

  const chartAttempt = attempts[0];
  const timeAttempt = attempts[1];
  const chart = chartAttempt.status === "fulfilled" ? rowValue(chartAttempt.value.data) : null;
  const status = domesticMarketStatus(chart?.marketStatus);
  const sessionTime = compactKstDate(chart?.tradeBaseAt) || compactKstDate(chart?.lastTradeBaseAt) || 0;
  const points = status === "preopen"
    ? []
    : timeAttempt.status === "fulfilled"
      ? domesticPoints(timeAttempt.value.data)
      : [];

  return {
    points: finalPoints(points, "Asia/Seoul"),
    stale: attempts.some(attempt => attempt.status === "rejected" || attempt.value.stale),
    status,
    ...(sessionTime ? { sessionTime } : {}),
  } satisfies SparkSeries;
}

async function foreignIndexSeries(code: ".INX" | ".IXIC") {
  const result = await naverJson<unknown>(
    buildNaverPath(`/api/securityService/chart/foreign/index/${code}`, { periodType: "day" }),
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
  const anchor = Date.now();
  const fxPromise = getNaverUsdKrwRate({ timeoutMs: 2_500 });
  const jobsPromise = Promise.allSettled([
    domesticIndexSeries("KOSPI", anchor),
    domesticIndexSeries("KOSDAQ", anchor),
    foreignIndexSeries(".INX"),
    foreignIndexSeries(".IXIC"),
    bitcoinSeries(anchor),
    usdKrwSeries(),
  ]);
  const [fxResult, jobs] = await Promise.all([
    fxPromise
      .then(value => ({ status: "fulfilled" as const, value }))
      .catch(reason => ({ status: "rejected" as const, reason })),
    jobsPromise,
  ]);
  const fx = fxResult.status === "fulfilled" ? fxResult.value : null;

  const ids = ["KOSPI", "KOSDAQ", "SPX", "COMP", "BTC", "USDKRW"] as const;
  const series = Object.fromEntries(ids.map((id, index) => {
    const job = jobs[index];
    const value = job.status === "fulfilled" && job.value.points.length >= 2 ? job.value : fallbackSeries();
    return [id, value];
  })) as Record<(typeof ids)[number], SparkSeries>;

  // The bank round chart can stop publishing fresh timestamps at night even while
  // the live USD/KRW indicator is still updating. Feed the successful live quote
  // into the sparkline so the UI status follows the live quote rather than the
  // older bank-announcement timestamp. Korea's USD/KRW market is 24-hour on
  // business days from July 2026, so only suppress this outside KST weekdays.
  if (fx && !fx.stale && fx.rate > 0 && kstWeekday(fx.fetchedAt)) {
    series.USDKRW = {
      points: downsample(normalize([
        ...series.USDKRW.points,
        { time: fx.fetchedAt, value: fx.rate },
      ])),
      stale: false,
    };
  }

  return Response.json(
    { series, pollingInterval: 60_000, timestamp: Date.now(), fxTimestamp: fx?.fetchedAt ?? null },
    { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30" } },
  );
}
