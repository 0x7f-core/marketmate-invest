import type { LiveQuote } from "@/lib/server/market-data";
import type { MarketSession } from "@/lib/server/market-hours";
import { buildNaverPath, naverPolling } from "@/lib/server/naver-stock";
import { normalizeNaverReutersCode } from "@/lib/server/naver-symbol";

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%$]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringValue(record: Row | null, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function reutersCode(symbol: string, exchange?: string) {
  if (symbol.includes(".")) return normalizeNaverReutersCode(symbol);
  const venue = (exchange ?? "").toUpperCase();
  const suffix = venue.includes("ARCA") ? ".P"
    : venue.includes("NYS") || venue === "NYSE" ? ".N"
      : venue.includes("AMS") || venue.includes("AMEX") ? ".A" : ".O";
  return normalizeNaverReutersCode(`${symbol.replaceAll("_", ".")}${suffix}`);
}

function sessionKind(value: string | undefined) {
  const normalized = (value ?? "").toLocaleLowerCase("en-US");
  if (normalized.includes("pre")) return "pre";
  if (normalized.includes("after") || normalized.includes("post")) return "after";
  return "regular";
}

export function isUsExtendedSession(session: MarketSession | undefined) {
  if (!session?.isOpen || session.stale) return false;
  const kind = sessionKind(session.currentSession);
  return kind === "pre" || kind === "after";
}

export async function getNaverUsOverMarketQuote(
  symbol: string,
  exchange: string | undefined,
  exchangeRate: number,
  session: MarketSession,
): Promise<LiveQuote> {
  if (!isUsExtendedSession(session)) throw new Error("NAVER_US_OVERMARKET_NOT_ACTIVE");
  const code = reutersCode(symbol, exchange);
  const result = await naverPolling<unknown>(
    buildNaverPath("/api/stockSecurity/items/v1/foreign/prices", { itemCodes: code }),
    { ttlMs: 3_000, staleMs: 30_000 },
  );
  const root = asRecord(result.data);
  const item = asRecord(root?.[code]) ?? (root ? Object.values(root).map(asRecord).find(Boolean) ?? null : null);
  const over = asRecord(item?.overMarketPriceInfo);
  if (!over) throw new Error("NAVER_US_OVERMARKET_UNAVAILABLE");

  const expectedKind = sessionKind(session.currentSession);
  const actualKind = sessionKind(stringValue(over, ["tradingSessionType", "sessionType", "marketSessionType"]));
  if (expectedKind !== actualKind) throw new Error("NAVER_US_OVERMARKET_SESSION_MISMATCH");

  const price = numberValue(over.currentPrice, over.closePrice, over.tradePrice, over.price);
  const timestampRaw = stringValue(over, ["localTradedAt", "tradedAt", "tradeDateTime", "tradeBaseAt"]);
  const timestamp = timestampRaw ? Date.parse(timestampRaw) : 0;
  if (price <= 0 || !Number.isFinite(timestamp) || timestamp <= 0) throw new Error("NAVER_US_OVERMARKET_INVALID");

  return {
    market: "US",
    symbol,
    price,
    change: numberValue(over.changePrice, over.compareToPreviousClosePrice, over.changeValue, over.change),
    changeRate: numberValue(over.changeRate, over.fluctuationsRatio, over.changeRatio, over.rate),
    currency: "USD",
    exchangeRate,
    timestamp,
    timestampVerified: true,
    source: "NAVER",
    stale: result.stale,
    pollingInterval: result.pollingInterval,
    open: numberValue(over.openingPrice, over.openPrice, over.open) || undefined,
    high: numberValue(over.highPrice, over.high) || undefined,
    low: numberValue(over.lowPrice, over.low) || undefined,
    volume: numberValue(over.tradingVolume, over.accumulatedTradingVolume, over.volume) || undefined,
  };
}
