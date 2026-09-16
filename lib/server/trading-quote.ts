import { getLiveQuote, type LiveQuote, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession, type MarketSession } from "@/lib/server/market-hours";
import { getNxtLiveQuote } from "@/lib/server/naver-nxt";

export type TradingQuote = LiveQuote & { venue?: "KRX" | "NXT" };

function compactKstTimestampMs(value: number) {
  const raw = String(Math.trunc(value));
  if (!/^(?:19|20)\d{12}$/.test(raw)) return value;
  const parsed = Date.parse(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+09:00`);
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeTradingTimestamp<T extends TradingQuote>(quote: T): T {
  if (!quote.timestampVerified || !Number.isFinite(quote.timestamp)) return quote;
  const timestamp = compactKstTimestampMs(quote.timestamp);
  return timestamp === quote.timestamp ? quote : { ...quote, timestamp };
}

function sourceTimestampMs(quote: TradingQuote) {
  const timestamp = compactKstTimestampMs(quote.timestamp);
  return timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
}

export function tradingQuoteFreshnessWindowMs(quote: TradingQuote) {
  const pollingInterval = Number.isFinite(quote.pollingInterval) ? Number(quote.pollingInterval) : 0;
  return Math.min(180_000, Math.max(60_000, pollingInterval + 15_000));
}

export function isExecutableTradingQuote(quote: TradingQuote, now = Date.now()) {
  if (quote.stale || !quote.timestampVerified) return false;
  const sourceTime = sourceTimestampMs(quote);
  if (!Number.isFinite(sourceTime) || sourceTime <= 0) return false;
  return Math.abs(now - sourceTime) <= tradingQuoteFreshnessWindowMs(quote);
}

export async function getTradingQuote(
  market: Market,
  symbol: string,
  exchange?: string,
  knownSession?: MarketSession,
): Promise<TradingQuote> {
  if (market !== "KR") return normalizeTradingTimestamp(await getLiveQuote(market, symbol, exchange));

  const session = knownSession ?? await getCheckedMarketSession("KR");
  if (session.isOpen && !session.stale && session.exchange === "NXT") {
    return normalizeTradingTimestamp(Object.assign(await getNxtLiveQuote(symbol), { venue: "NXT" as const }));
  }
  return normalizeTradingTimestamp(Object.assign(await getLiveQuote(market, symbol, exchange), { venue: "KRX" as const }));
}
