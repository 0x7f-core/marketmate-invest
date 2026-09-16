import { getLiveQuote, type LiveQuote, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession, type MarketSession } from "@/lib/server/market-hours";
import { getNxtLiveQuote } from "@/lib/server/naver-nxt";

export type TradingQuote = LiveQuote & { venue?: "KRX" | "NXT" };

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
