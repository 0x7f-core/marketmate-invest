import { getLiveQuote, type LiveQuote, type Market } from "@/lib/server/market-data";
import { getCheckedMarketSession, type MarketSession } from "@/lib/server/market-hours";
import { getNaverUsdKrwRate } from "@/lib/server/naver-fx";
import { getNxtLiveQuote } from "@/lib/server/naver-nxt";
import { getNaverUsOverMarketQuote, isUsExtendedSession } from "@/lib/server/naver-us-overmarket";

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

function withExchangeRate<T extends TradingQuote>(quote: T, exchangeRate: number): T {
  return { ...quote, exchangeRate };
}

function newerQuote(base: TradingQuote, candidate: TradingQuote | null) {
  if (!candidate) return base;
  return sourceTimestampMs(candidate) > sourceTimestampMs(base) ? candidate : base;
}

export async function getTradingQuote(
  market: Market,
  symbol: string,
  exchange?: string,
  knownSession?: MarketSession,
): Promise<TradingQuote> {
  if (market === "US") {
    const fxPromise = getNaverUsdKrwRate();
    const regularPromise = getLiveQuote(market, symbol, exchange, 1);

    if (knownSession && isUsExtendedSession(knownSession)) {
      const [fx, regular, overMarket] = await Promise.all([
        fxPromise,
        regularPromise,
        getNaverUsOverMarketQuote(symbol, exchange, 1, knownSession).catch(() => null),
      ]);
      if (fx.stale) throw new Error("NAVER_FX_UNAVAILABLE");
      const selected = newerQuote(normalizeTradingTimestamp(regular), overMarket ? normalizeTradingTimestamp(overMarket) : null);
      return withExchangeRate(selected, fx.rate);
    }

    const sessionPromise = knownSession ? Promise.resolve(knownSession) : getCheckedMarketSession("US");
    const [fx, regular, session] = await Promise.all([fxPromise, regularPromise, sessionPromise]);
    if (fx.stale) throw new Error("NAVER_FX_UNAVAILABLE");
    const regularWithFx = withExchangeRate(normalizeTradingTimestamp(regular), fx.rate);
    if (!isUsExtendedSession(session)) return regularWithFx;

    const overMarket = await getNaverUsOverMarketQuote(symbol, exchange, fx.rate, session).catch(() => null);
    return newerQuote(regularWithFx, overMarket ? normalizeTradingTimestamp(overMarket) : null);
  }
  if (market !== "KR") return normalizeTradingTimestamp(await getLiveQuote(market, symbol, exchange));

  const session = knownSession ?? await getCheckedMarketSession("KR");
  if (session.isOpen && !session.stale && session.exchange === "NXT") {
    return normalizeTradingTimestamp(Object.assign(await getNxtLiveQuote(symbol), { venue: "NXT" as const }));
  }
  return normalizeTradingTimestamp(Object.assign(await getLiveQuote(market, symbol, exchange), { venue: "KRX" as const }));
}
