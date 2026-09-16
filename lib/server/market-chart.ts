import { buildNaverPath, naverJson, type NaverResult } from "@/lib/server/naver-stock";
import { looksLikeCaseSensitiveReutersCode, naverAutocompleteQueryForForeignCode, normalizeNaverReutersCode } from "@/lib/server/naver-symbol";
import type { ChartPoint, Market } from "@/lib/server/market-data";

const RANGE_DAYS: Record<string, number> = { "1D": 2, "1W": 8, "1M": 32, "3M": 94, "1Y": 367 };
const reutersCache = new Map<string, { code: string; expiresAt: number }>();

type JsonResult = NaverResult<unknown>;
type SecurityFamily = "stock" | "etf";

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%원$]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function text(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collectRecords(value: unknown, depth = 0, output: Array<Record<string, unknown>> = []) {
  if (depth > 7 || output.length >= 800 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  output.push(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectRecords(child, depth + 1, output);
  }
  return output;
}

function codeKey(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

async function resolveReutersCode(symbol: string, exchange?: string) {
  if (symbol.includes(".") || looksLikeCaseSensitiveReutersCode(symbol)) return normalizeNaverReutersCode(symbol);
  const key = `${symbol}:${(exchange ?? "").toUpperCase()}`;
  const cached = reutersCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.code;

  try {
    const query = naverAutocompleteQueryForForeignCode(symbol);
    const result = await naverJson<unknown>(
      buildNaverPath("/api/autocomplete/search/autoComplete", { query, target: "stock" }),
      { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000, timeoutMs: 2_000 },
    );
    const wanted = codeKey(query);
    const candidates = collectRecords(result.data).map(record => ({
      reuters: text(record, ["reutersCode", "reuterscode"]),
      ticker: text(record, ["ticker", "symbol", "itemCode", "itemcode", "stockCode", "code"]),
      nation: text(record, ["nationType", "nation", "country", "marketType", "nationCode", "nationName"]),
    })).filter(item => item.reuters);
    const found = candidates.find(item => codeKey(item.ticker) === wanted || codeKey(item.reuters.split(".")[0]) === wanted)
      ?? candidates.find(item => /USA|US|미국/i.test(item.nation))
      ?? candidates[0];
    if (found?.reuters) {
      const code = normalizeNaverReutersCode(found.reuters);
      reutersCache.set(key, { code, expiresAt: Date.now() + 24 * 60 * 60_000 });
      return code;
    }
  } catch {
    // Continue with an exchange-based Reuters fallback for ordinary US stocks.
  }

  const venue = (exchange ?? "").toUpperCase();
  const suffix = venue.includes("NYS") || venue.includes("NYSE") ? ".N"
    : venue.includes("AMS") || venue.includes("AMEX") ? ".K"
      : ".O";
  return normalizeNaverReutersCode(`${symbol.replaceAll("_", ".")}${suffix}`);
}

function parseTimestamp(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const digits = String(Math.trunc(value));
    if (/^(?:19|20)\d{6}$/.test(digits)) {
      const parsed = Date.parse(`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T00:00:00-04:00`);
      if (Number.isFinite(parsed)) return parsed;
    }
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return fallback;
  const clean = value.trim();
  if (/^(?:19|20)\d{6}$/.test(clean)) {
    const parsed = Date.parse(`${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}T00:00:00-04:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (/^\d{14}$/.test(clean)) {
    const parsed = Date.parse(`${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}T${clean.slice(8,10)}:${clean.slice(10,12)}:${clean.slice(12,14)}-04:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(clean);
  if (Number.isFinite(parsed)) return parsed;
  const numeric = Number(clean);
  return Number.isFinite(numeric) ? (numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric) : fallback;
}

function chartPoint(row: Record<string, unknown>, fallback: number): ChartPoint | null {
  const close = asNumber(
    row.closePrice,
    row.close,
    row.currentPrice,
    row.tradePrice,
    row.price,
    row.basePrice,
    row.lastPrice,
  );
  const dateValue = row.localTradedAt
    ?? row.tradeDate
    ?? row.localDate
    ?? row.date
    ?? row.businessDate
    ?? row.bizDate
    ?? row.bizdate
    ?? row.baseDate
    ?? row.xymd
    ?? row.datetime
    ?? row.dateTime
    ?? row.tradedAt;
  if (close <= 0 || dateValue === undefined) return null;
  const open = asNumber(row.openPrice, row.open, row.openingPrice) || close;
  const high = asNumber(row.highPrice, row.high, row.highestPrice) || close;
  const low = asNumber(row.lowPrice, row.low, row.lowestPrice) || close;
  return {
    time: parseTimestamp(dateValue, fallback),
    open,
    high,
    low,
    close,
    volume: asNumber(row.accumulatedTradingVolume, row.accumulatedVolume, row.volume, row.tradeVolume) || undefined,
  };
}

function pointsFrom(payload: unknown, fetchedAt: number) {
  return collectRecords(payload)
    .map((row, index) => chartPoint(row, fetchedAt - index * 86_400_000))
    .filter((point): point is ChartPoint => Boolean(point));
}

function finalize(points: ChartPoint[], range: string, days: number) {
  const since = Date.now() - days * 86_400_000;
  const sorted = points
    .sort((a, b) => a.time - b.time)
    .filter((point, index, all) => index === 0 || point.time !== all[index - 1].time);
  const ranged = range === "1Y" ? sorted : sorted.filter(point => point.time >= since);
  return (ranged.length ? ranged : sorted).slice(-400);
}

async function fetchUsPage(family: SecurityFamily, identifier: string, page: number, pageSize: number) {
  const path = `/api/securityService/${family}/${encodeURIComponent(identifier)}/price`;
  return naverJson<unknown>(buildNaverPath(path, { page, pageSize }), {
    ttlMs: 60_000,
    staleMs: 30 * 60_000,
    timeoutMs: 2_500,
  });
}

async function usSeries(symbol: string, exchange: string | undefined, range: string, days: number) {
  const reutersCode = await resolveReutersCode(symbol, exchange);
  // Naver's foreign closing-price API rejects pageSize > 60.
  const pageSize = 60;
  const attempts: Array<{ family: SecurityFamily; identifier: string; promise: Promise<JsonResult> }> = [
    { family: "stock", identifier: reutersCode, promise: fetchUsPage("stock", reutersCode, 1, pageSize) },
    { family: "etf", identifier: reutersCode, promise: fetchUsPage("etf", reutersCode, 1, pageSize) },
  ];
  const settled = await Promise.allSettled(attempts.map(item => item.promise));
  const candidates: Array<{ family: SecurityFamily; identifier: string; result: JsonResult; points: ChartPoint[] }> = [];

  for (let index = 0; index < settled.length; index += 1) {
    const attempt = settled[index];
    if (attempt.status !== "fulfilled") continue;
    const points = pointsFrom(attempt.value.data, attempt.value.fetchedAt);
    if (points.length) {
      candidates.push({
        family: attempts[index].family,
        identifier: attempts[index].identifier,
        result: attempt.value,
        points,
      });
    }
  }

  const selected = candidates.sort((a, b) => b.points.length - a.points.length)[0];
  if (!selected) {
    const rejected = settled.find(item => item.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    return { points: [], range, stale: false, source: "NAVER" as const };
  }

  // One year requires roughly 6–7 pages at Naver's 60-row maximum.
  const neededPages = Math.min(8, Math.max(1, Math.ceil((days + 10) / pageSize)));
  const more = neededPages > 1
    ? await Promise.allSettled(
      Array.from({ length: neededPages - 1 }, (_, offset) =>
        fetchUsPage(selected.family, selected.identifier, offset + 2, pageSize)),
    )
    : [];

  const allPoints = [...selected.points];
  let stale = selected.result.stale;
  for (const attempt of more) {
    if (attempt.status !== "fulfilled") continue;
    stale = stale || attempt.value.stale;
    allPoints.push(...pointsFrom(attempt.value.data, attempt.value.fetchedAt));
  }

  return { points: finalize(allPoints, range, days), range, stale, source: "NAVER" as const };
}

export async function getMarketChartSeries(market: Market, symbol: string, exchange: string | undefined, range: string) {
  const days = RANGE_DAYS[range];
  if (!days) throw new Error("INVALID_CHART_RANGE");
  if (market !== "US") throw new Error("MARKET_CHART_HELPER_ONLY_SUPPORTS_US");
  return usSeries(symbol, exchange, range, days);
}
