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
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
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

function roundTo(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function tokenEncryptionKey() {
  const { appSecret } = kisConfig();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(appSecret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await tokenEncryptionKey(),
    new TextEncoder().encode(token),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptToken(ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await tokenEncryptionKey(),
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function readSharedKisToken(): Promise<TokenCache | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT ciphertext,iv,expires_at AS expiresAt FROM provider_tokens WHERE provider='KIS'",
  ).first<{ ciphertext: string; iv: string; expiresAt: number }>();
  if (!row || row.expiresAt <= Date.now() || !row.ciphertext || !row.iv) return null;
  try {
    return { token: await decryptToken(row.ciphertext, row.iv), expiresAt: row.expiresAt };
  } catch {
    await env.DB.prepare("UPDATE provider_tokens SET expires_at=0 WHERE provider='KIS'").run();
    return null;
  }
}

async function waitForSharedKisToken() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const shared = await readSharedKisToken();
    if (shared) return shared;
  }
  throw new Error("KIS_AUTH_BUSY");
}

async function resolveKisToken(): Promise<TokenCache> {
  const shared = await readSharedKisToken();
  if (shared) return shared;
  if (!env.DB) return requestKisToken();

  const now = Date.now();
  const lease = await env.DB.prepare(
    `INSERT INTO provider_tokens (provider,ciphertext,iv,expires_at,refresh_started_at,updated_at)
     VALUES ('KIS','','',0,?,?)
     ON CONFLICT(provider) DO UPDATE SET refresh_started_at=excluded.refresh_started_at,updated_at=excluded.updated_at
     WHERE provider_tokens.expires_at<=? AND provider_tokens.refresh_started_at<?`,
  ).bind(now, now, now + 60_000, now - 30_000).run();

  if ((lease.meta.changes ?? 0) !== 1) return waitForSharedKisToken();
  try {
    const fresh = await requestKisToken();
    const encrypted = await encryptToken(fresh.token);
    await env.DB.prepare(
      "UPDATE provider_tokens SET ciphertext=?,iv=?,expires_at=?,refresh_started_at=0,updated_at=? WHERE provider='KIS' AND refresh_started_at=?",
    ).bind(encrypted.ciphertext, encrypted.iv, fresh.expiresAt, Date.now(), now).run();
    return fresh;
  } catch (error) {
    await env.DB.prepare(
      "UPDATE provider_tokens SET refresh_started_at=0,updated_at=? WHERE provider='KIS' AND refresh_started_at=?",
    ).bind(Date.now(), now).run();
    throw error;
  }
}

async function getKisToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  tokenRequest ??= resolveKisToken();
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
    open: asNumber(data.stck_oprc), high: asNumber(data.stck_hgpr), low: asNumber(data.stck_lwpr), volume: asNumber(data.acml_vol),
  };
}

async function kisOverseasQuote(symbol: string, requestedExchange?: string): Promise<LiveQuote> {
  const normalized = symbol.replace(".", "_");
  const preferred = (["NAS", "NYS", "AMS"].includes(requestedExchange ?? "") ? requestedExchange : usExchangeBySymbol[normalized]) as "NAS" | "NYS" | "AMS" | undefined;
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
      const change = roundTo(price - previousClose, 6);
      return {
        market: "US", symbol, price,
        change,
        changeRate: roundTo((change / previousClose) * 100, 4),
        currency: "USD",
        exchangeRate,
        timestamp: Date.now(),
        source: "KIS",
        open: asNumber(data.open), high: asNumber(data.high), low: asNumber(data.low), volume: asNumber(data.tvol),
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
    open: asNumber(data.opening_price), high: asNumber(data.high_price), low: asNumber(data.low_price), volume: asNumber(data.acc_trade_volume_24h),
  };
}

async function fetchLiveQuote(market: Market, symbol: string, exchange?: string) {
  if (market === "CRYPTO") return upbitQuote(symbol);
  return market === "KR" ? kisDomesticQuote(symbol) : kisOverseasQuote(symbol, exchange);
}

export async function getLiveQuote(market: Market, symbol: string, exchange?: string) {
  if (!/^[A-Z0-9._-]{1,20}$/.test(symbol)) throw new Error("INVALID_SYMBOL");
  const key = `${market}:${exchange ?? ""}:${symbol}`;
  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;
  const existing = quoteRequests.get(key);
  if (existing) return existing;
  const request = fetchLiveQuote(market, symbol, exchange).then(quote => {
    quoteCache.set(key, { quote, expiresAt: Date.now() + QUOTE_CACHE_MS });
    return quote;
  }).finally(() => quoteRequests.delete(key));
  quoteRequests.set(key, request);
  return request;
}

export async function persistQuoteSnapshot(quote: LiveQuote) {
  if (!env.DB) return;
  const instrumentId = `${quote.market}:${quote.symbol}`;
  const sourceTimestamp = quote.timestamp < 1_000_000_000_000 ? quote.timestamp * 1000 : quote.timestamp;
  const priceKrwMicros = Math.round(quote.price * quote.exchangeRate * 1_000_000);
  const fxRateMicros = Math.round(quote.exchangeRate * 1_000_000);
  const recordedAt = Math.floor(sourceTimestamp / 60_000) * 60_000;
  await env.DB.batch([env.DB.prepare(
    `INSERT INTO quote_snapshots (instrument_id,price_micros,change_micros,change_rate_ppm,fx_rate_micros,source,source_timestamp,received_at)
     SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM instruments WHERE id=?)
     ON CONFLICT(instrument_id) DO UPDATE SET price_micros=excluded.price_micros,change_micros=excluded.change_micros,
       change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros,source=excluded.source,
       source_timestamp=excluded.source_timestamp,received_at=excluded.received_at`,
  ).bind(
    instrumentId,
    priceKrwMicros,
    Math.round(quote.change * quote.exchangeRate * 1_000_000),
    Math.round(quote.changeRate * 10_000),
    fxRateMicros,
    quote.source,
    sourceTimestamp,
    Date.now(),
    instrumentId,
  ), env.DB.prepare(`INSERT INTO price_history (id,instrument_id,price_micros,change_rate_ppm,fx_rate_micros,recorded_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM instruments WHERE id=?)
    ON CONFLICT(instrument_id,recorded_at) DO UPDATE SET price_micros=excluded.price_micros,change_rate_ppm=excluded.change_rate_ppm,fx_rate_micros=excluded.fx_rate_micros`)
    .bind(`${instrumentId}:${recordedAt}`, instrumentId, priceKrwMicros, Math.round(quote.changeRate * 10_000), fxRateMicros, recordedAt, instrumentId)]);
  if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
    await env.DB.prepare("DELETE FROM price_history WHERE recorded_at<?").bind(Date.now() - 400 * 86_400_000).run().catch(() => undefined);
  }
}
