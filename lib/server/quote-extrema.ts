import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import { resolveReutersCode, type Market } from "@/lib/server/market-data";

export type QuoteExtremaDates = {
  high52WeekDate?: string;
  low52WeekDate?: string;
};

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "string"
    ? Number(value.replace(/[,%원$]/g, "").trim())
    : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return "";
  const clean = value.trim();
  let match = clean.match(/^(\d{4})[.-](\d{2})[.-](\d{2})\.?$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = clean.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match?.[1] ?? "";
}

function samePrice(value: unknown, target: number) {
  if (!Number.isFinite(target) || target <= 0) return false;
  const parsed = numberValue(value);
  if (parsed <= 0) return false;
  return Math.abs(parsed - target) <= Math.max(1e-8, Math.abs(target) * 1e-10);
}

function kstDate(daysOffset = 0) {
  const value = new Date(Date.now() + daysOffset * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

async function domesticExtremaDates(symbol: string, high52Week: number, low52Week: number): Promise<QuoteExtremaDates> {
  let cursor: string | undefined;
  let high52WeekDate = "";
  let low52WeekDate = "";
  let krxHighDate = "";
  let krxLowDate = "";
  let krxHigh = -Infinity;
  let krxLow = Infinity;
  const cutoff = kstDate(-370);

  for (let page = 0; page < 4; page += 1) {
    const path = buildNaverPath(
      `/api/stockSecurity/items/v2/domestic/${encodeURIComponent(symbol)}/daily-prices`,
      { size: 100, cursor },
    );
    const response = await naverJson<unknown>(path, {
      ttlMs: 6 * 60 * 60_000,
      staleMs: 3 * 24 * 60 * 60_000,
      timeoutMs: 8_000,
    });
    const root = asRecord(response.data);
    const items = root && Array.isArray(root.items) ? root.items : [];
    let oldestDate = "";

    for (const value of items) {
      const row = asRecord(value);
      if (!row) continue;
      const date = normalizeDate(row.tradingDateKst ?? row.tradingDate ?? row.date);
      if (date) oldestDate = date;
      const high = numberValue(row.highPrice);
      const low = numberValue(row.lowPrice);
      if (date && high > krxHigh) {
        krxHigh = high;
        krxHighDate = date;
      }
      if (date && low > 0 && low < krxLow) {
        krxLow = low;
        krxLowDate = date;
      }
      if (!high52WeekDate && samePrice(row.highPrice, high52Week)) high52WeekDate = date;
      if (!low52WeekDate && samePrice(row.lowPrice, low52Week)) low52WeekDate = date;
    }

    if (high52WeekDate && low52WeekDate) break;
    if (oldestDate && oldestDate < cutoff) break;
    const nextCursor = root?.cursor;
    const hasNext = root?.hasNext === true;
    if (!hasNext || typeof nextCursor !== "string" || !nextCursor.trim()) break;
    cursor = nextCursor.trim();
  }

  // Naver's domestic headline 52-week values are KRX+NXT integrated, but the
  // public daily-history endpoint is KRX daily data. If NXT extended the exact
  // high/low beyond KRX on that trading day, the integrated price will not
  // exactly match a KRX candle. In that case use the KRX 52-week extreme's
  // trading date, which is the date context Naver exposes for domestic history.
  return {
    high52WeekDate: high52WeekDate || krxHighDate || undefined,
    low52WeekDate: low52WeekDate || krxLowDate || undefined,
  };
}

function totalInfoDate(payload: unknown, code: string) {
  const root = asRecord(payload);
  const infos = root && Array.isArray(root.stockItemTotalInfos) ? root.stockItemTotalInfos : [];
  for (const value of infos) {
    const row = asRecord(value);
    if (!row || String(row.code ?? "") !== code) continue;
    return normalizeDate(row.keyDesc ?? row.date ?? row.baseDate);
  }
  return "";
}

async function foreignExtremaDates(symbol: string, exchange: string | undefined): Promise<QuoteExtremaDates> {
  const code = await resolveReutersCode(symbol, exchange);
  const basic = await naverJson<unknown>(
    `/api/securityService/stock/${encodeURIComponent(code)}/basic`,
    { ttlMs: 6 * 60 * 60_000, staleMs: 3 * 24 * 60 * 60_000 },
  );
  const high52WeekDate = totalInfoDate(basic.data, "highPriceOf52Weeks");
  const low52WeekDate = totalInfoDate(basic.data, "lowPriceOf52Weeks");
  return {
    high52WeekDate: high52WeekDate || undefined,
    low52WeekDate: low52WeekDate || undefined,
  };
}

function candleDate(row: Row) {
  const candleId = typeof row.candleId === "string" ? row.candleId : "";
  const fromId = candleId.match(/_(\d{4}-\d{2}-\d{2})$/)?.[1];
  return fromId || normalizeDate(row.tradeBaseAt ?? row.localDateTime ?? row.date);
}

async function cryptoExtremaDates(symbol: string, high52Week: number, low52Week: number): Promise<QuoteExtremaDates> {
  const ticker = symbol.toUpperCase().replace(/^KRW-/, "").replace(/_KRW_(?:UPBIT|BITHUMB)$/, "");
  const path = buildNaverPath(
    `/api/coin/candle/UPBIT/KRW/${encodeURIComponent(ticker)}/days`,
    {
      from: `${kstDate(-370)}T00:00:00`,
      to: `${kstDate()}T23:59:59`,
    },
  );
  const response = await naverJson<unknown>(path, {
    ttlMs: 6 * 60 * 60_000,
    staleMs: 3 * 24 * 60 * 60_000,
    timeoutMs: 10_000,
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  let high52WeekDate = "";
  let low52WeekDate = "";

  // Naver returns these daily candles oldest -> newest. Overwrite on an exact
  // match so repeated highs/lows use the most recent occurrence.
  for (const value of rows) {
    const row = asRecord(value);
    if (!row) continue;
    const date = candleDate(row);
    if (samePrice(row.highPrice, high52Week)) high52WeekDate = date;
    if (samePrice(row.lowPrice, low52Week)) low52WeekDate = date;
  }

  return {
    high52WeekDate: high52WeekDate || undefined,
    low52WeekDate: low52WeekDate || undefined,
  };
}

export async function getQuoteExtremaDates({
  market,
  symbol,
  exchange,
  high52Week,
  low52Week,
}: {
  market: Market;
  symbol: string;
  exchange?: string;
  high52Week: number;
  low52Week: number;
}): Promise<QuoteExtremaDates> {
  if (market === "US") return foreignExtremaDates(symbol, exchange);
  if (market === "CRYPTO") return cryptoExtremaDates(symbol, high52Week, low52Week);
  return domesticExtremaDates(symbol, high52Week, low52Week);
}
