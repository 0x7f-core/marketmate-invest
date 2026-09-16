import { getLiveQuote, type LiveQuote, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession, type MarketSession } from "@/lib/server/market-hours";
import { getNxtLiveQuote } from "@/lib/server/naver-nxt";

export async function getTradingQuote(
  market: Market,
  symbol: string,
  exchange?: string,
  knownSession?: MarketSession,
): Promise<LiveQuote> {
  if (market !== "KR") return getLiveQuote(market, symbol, exchange);

  const session = knownSession ?? await getCheckedMarketSession("KR");
  if (session.isOpen && !session.stale && session.exchange === "NXT") {
    return getNxtLiveQuote(symbol);
  }
  return getLiveQuote(market, symbol, exchange);
}
