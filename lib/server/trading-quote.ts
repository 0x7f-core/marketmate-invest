import { getLiveQuote, type LiveQuote, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession, type MarketSession } from "@/lib/server/market-hours";
import { getNxtLiveQuote } from "@/lib/server/naver-nxt";

export type TradingQuote = LiveQuote & { venue?: "KRX" | "NXT" };

function sourceTimestampMs(quote: TradingQuote) {
  return quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1_000 : quote.timestamp;
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
  if (market !== "KR") return getLiveQuote(market, symbol, exchange);

  const session = knownSession ?? await getCheckedMarketSession("KR");
  if (session.isOpen && !session.stale && session.exchange === "NXT") {
    return Object.assign(await getNxtLiveQuote(symbol), { venue: "NXT" as const });
  }
  return Object.assign(await getLiveQuote(market, symbol, exchange), { venue: "KRX" as const });
}
