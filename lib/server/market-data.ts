import { env } from "cloudflare:workers";

export type Market = "KR" | "US" | "CRYPTO";
export type LiveQuote = {
  market: Market;
  symbol: string;
  price: number;
  change: number;
  changeRate: number;
  currency: "KRW" | "USD";
  exchangeRate: number;
  timestamp: number;
  source: "KIS" | "UPBIT";
};

type TokenCache = { token: string; expiresAt: number };
type CachedQuote = { quote: LiveQuote; expiresAt: number };

const KIS_DEFAULT_BASE_URL = "https://openapi.koreainvestment.com:9443";
const QUOTE_CACHE_MS = 2_000;
const usExchangeBySymbol: Record<string, "NAS" | "NYS" | "AMS"> = {
  AAPL: "NAS", AMZN: "NAS", GOOGL: "NAS", META: "NAS", MSFT: "NAS", NVDA: "NAS", TSLA: "NAS",
  BRK_B: "NYS", DIS: "NYS", JPM: "NYS", KO: "NYS", NKE: "NYS", V: "NYS", WMT: "NYS",
};

let tokenCache: TokenCache | null = null;
let tokenRequest: Promise<TokenCache> | null = null;
const quoteCache = new Map<string, CachedQuote>();
const quoteRequests = new Map<string, Promise<LiveQuote>>();

function asNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function kisConfig() {
  if (!env.KIS_APP_KEY || !env.KIS_APP_SECRET) throw new Error("KIS_NOT_CONFIGURED");
  return {
    appKey: env.KIS_APP_KEY,
    appSecret: env.KIS_APP_SECRET,
    baseUrl: env.KIS_BASE_URL || KIS_DEFAULT_BASE_URL,
  };
}

async function requestKisToken(): Promise<TokenCache> {
  const { appKey, appSecret, baseUrl } = kisConfig();
  const response = await fetch(new URL("/oauth2/tokenP", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/plain" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });
  if (!response.ok) throw new Error("KIS_AUTH_FAILED");
  const data = await response.json() as Record<string, unknown>;
  const token = String(data.access_token ?? "");
  const expiresIn = Math.max(60, asNumber(data.expires_in, 86_400));
  if (!token) throw new Error("KIS_AUTH_FAILED");
  return { token, expiresAt: Date.now() + expiresIn * 1_000 - 60_000 };
}

async function getKisToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  tokenRequest ??= requestKisToken();
  try {
    tokenCache = await tokenRequest;
    return tokenCache.token;
  } finally {
    tokenRequest = null;
  }
}

async function kisGet(path: string, trId: string, params: Record<string, string>) {
  const { appKey, appSecret, baseUrl } = kisConfig();
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${await getKisToken()}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId,
      custtype: "P",
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error("KIS_QUOTE_FAILED");
  const root = await response.json() as Record<string, unknown>;
  if (String(root.rt_cd ?? "0") !== "0" || !root.output) throw new Error("KIS_QUOTE_FAILED");
  return root.output as Record<string, unknown>;
}

async function kisDomesticQuote(symbol: string): Promise<LiveQuote> {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
    { FID_COND_MRKT_DIV_CODE: "UN", FID_INPUT_ISCD: symbol },
  );
  const price = asNumber(data.stck_prpr);
  if (price <= 0) throw new Error("INVALID_QUOTE");
  return {
    market: "KR", symbol, price,
    change: asNumber(data.prdy_vrss),
    changeRate: asNumber(data.prdy_ctrt),
    currency: "KRW",
    exchangeRate: 1,
    timestamp: Date.now(),
    source: "KIS",
  };
}

async function kisOverseasQuote(symbol: string): Promise<LiveQuote> {
  const normalized = symbol.replace(".", "_");
  const preferred = usExchangeBySymbol[normalized];
  const exchanges = preferred ? [preferred] : ["NAS", "NYS", "AMS"] as const;
  for (const exchange of exchanges) {
    try {
      const data = await kisGet(
        "/uapi/overseas-price/v1/quotations/price-detail",
        "HHDFS76200200",
        { AUTH: "", EXCD: exchange, SYMB: symbol.replace("_", ".") },
      );
      const price = asNumber(data.last);
      const previousClose = asNumber(data.base);
      const exchangeRate = asNumber(data.t_rate);
      if (price <= 0 || previousClose <= 0 || exchangeRate <= 0) continue;
      const change = price - previousClose;
      return {
        market: "US", symbol, price,
        change,
        changeRate: (change / previousClose) * 100,
        currency: "USD",
        exchangeRate,
        timestamp: Date.now(),
        source: "KIS",
      };
    } catch (error) {
      if (preferred || exchange === "AMS") throw error;
    }
  }
  throw new Error("KIS_QUOTE_FAILED");
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
    exchangeRate: 1,
    timestamp: asNumber(data.timestamp, Date.now()),
    source: "UPBIT",
  };
}

async function fetchLiveQuote(market: Market, symbol: string) {
  if (market === "CRYPTO") return upbitQuote(symbol);
  return market === "KR" ? kisDomesticQuote(symbol) : kisOverseasQuote(symbol);
}

export async function getLiveQuote(market: Market, symbol: string) {
  if (!/^[A-Z0-9._-]{1,20}$/.test(symbol)) throw new Error("INVALID_SYMBOL");
  const key = `${market}:${symbol}`;
  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;
  const existing = quoteRequests.get(key);
  if (existing) return existing;
  const request = fetchLiveQuote(market, symbol).then(quote => {
    quoteCache.set(key, { quote, expiresAt: Date.now() + QUOTE_CACHE_MS });
    return quote;
  }).finally(() => quoteRequests.delete(key));
  quoteRequests.set(key, request);
  return request;
}
