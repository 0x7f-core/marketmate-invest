import { env } from "cloudflare:workers";

export type Market = "KR" | "US" | "CRYPTO";
export type LiveQuote = {
  market: Market;
  symbol: string;
  price: number;
  change: number;
  changeRate: number;
  currency: "KRW" | "USD";
  timestamp: number;
  source: "TOSS" | "UPBIT";
};

function asNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function getTossToken() {
  if (!env.TOSS_SECURITIES_API_KEY || !env.TOSS_SECURITIES_API_SECRET || !env.TOSS_SECURITIES_TOKEN_URL) {
    throw new Error("TOSS_NOT_CONFIGURED");
  }
  const response = await fetch(env.TOSS_SECURITIES_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      appKey: env.TOSS_SECURITIES_API_KEY,
      appSecret: env.TOSS_SECURITIES_API_SECRET,
      grantType: "client_credentials",
    }),
  });
  if (!response.ok) throw new Error("TOSS_AUTH_FAILED");
  const data = await response.json() as Record<string, unknown>;
  const token = String(data.accessToken ?? data.access_token ?? "");
  if (!token) throw new Error("TOSS_AUTH_FAILED");
  return token;
}

async function tossQuote(market: "KR" | "US", symbol: string): Promise<LiveQuote> {
  if (!env.TOSS_SECURITIES_BASE_URL) throw new Error("TOSS_NOT_CONFIGURED");
  const token = await getTossToken();
  const path = market === "KR" ? "/v1/market/kr/quotes/" : "/v1/market/us/quotes/";
  const response = await fetch(new URL(path + encodeURIComponent(symbol), env.TOSS_SECURITIES_BASE_URL), {
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-key": env.TOSS_SECURITIES_API_KEY ?? "",
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error("TOSS_QUOTE_FAILED");
  const root = await response.json() as Record<string, unknown>;
  const data = (root.data ?? root.result ?? root) as Record<string, unknown>;
  const price = asNumber(data.price, data.currentPrice, data.close, data.last);
  if (price <= 0) throw new Error("INVALID_QUOTE");
  return {
    market, symbol, price,
    change: asNumber(data.change, data.priceChange, data.netChange),
    changeRate: asNumber(data.changeRate, data.changePercent, data.rate),
    currency: market === "US" ? "USD" : "KRW",
    timestamp: asNumber(data.timestamp, data.tradeTimestamp, Date.now()),
    source: "TOSS",
  };
}

async function upbitQuote(symbol: string): Promise<LiveQuote> {
  const market = symbol.startsWith("KRW-") ? symbol : `KRW-${symbol}`;
  const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("UPBIT_QUOTE_FAILED");
  const [data] = await response.json() as Array<Record<string, unknown>>;
  const price = asNumber(data?.trade_price);
  if (!data || price <= 0) throw new Error("INVALID_QUOTE");
  return {
    market: "CRYPTO", symbol: market, price,
    change: asNumber(data.signed_change_price),
    changeRate: asNumber(data.signed_change_rate) * 100,
    currency: "KRW",
    timestamp: asNumber(data.timestamp, Date.now()),
    source: "UPBIT",
  };
}

export async function getLiveQuote(market: Market, symbol: string) {
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) throw new Error("INVALID_SYMBOL");
  return market === "CRYPTO" ? upbitQuote(symbol) : tossQuote(market, symbol);
}
