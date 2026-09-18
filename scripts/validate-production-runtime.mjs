import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASE = (process.env.APP_SMOKE_BASE_URL || "").replace(/\/$/, "");
const USER_FILE = process.env.APP_SMOKE_USER_FILE || "";
const nickname = `운영검증${Date.now().toString(36).slice(-5)}`.slice(0, 12);
const pin = "4826";

if (!BASE) throw new Error("APP_SMOKE_BASE_URL is required");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function timedFetch(path, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE}${path}`, options);
  const elapsedMs = Math.round(performance.now() - startedAt);
  return { response, elapsedMs };
}

async function jsonRequest(path, options = {}) {
  const { response, elapsedMs } = await timedFetch(path, options);
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { response, data, elapsedMs };
}

async function waitForDeployment() {
  let lastError = "deployment not ready";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const { response } = await timedFetch("/", { cache: "no-store", redirect: "manual" });
      if (response.status === 200) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`production deployment did not become ready: ${lastError}`);
}

function authHeaders(cookie) {
  return { cookie };
}

async function searchInstrument(cookie, market, query, expectedSymbol) {
  const result = await jsonRequest(`/api/instruments/search?q=${encodeURIComponent(query)}&market=${encodeURIComponent(market)}`, {
    headers: authHeaders(cookie),
    cache: "no-store",
  });
  assert(result.response.status === 200, `${market} search expected 200, got ${result.response.status}: ${JSON.stringify(result.data)}`);
  assert(result.data?.source === "NAVER", `${market} search source is not NAVER`);
  assert(Array.isArray(result.data?.instruments) && result.data.instruments.length > 0, `${market} search returned no instruments`);
  const instrument = expectedSymbol
    ? result.data.instruments.find(item => item?.market === market && item?.symbol === expectedSymbol)
    : result.data.instruments.find(item => item?.market === market) || result.data.instruments[0];
  assert(instrument, `${market} expected instrument missing: ${JSON.stringify(result.data?.instruments)}`);
  console.log(`PASS ${market} search (${instrument.name ?? instrument.symbol}, ${result.elapsedMs}ms)`);
  return instrument;
}

async function quoteInstrument(cookie, instrument, venue) {
  const params = new URLSearchParams({ market: instrument.market, symbols: instrument.symbol });
  if (instrument.exchange) params.set("exchange", instrument.exchange);
  if (venue) params.set("venue", venue);
  const result = await jsonRequest(`/api/quotes?${params.toString()}`, { headers: authHeaders(cookie), cache: "no-store" });
  assert(result.response.status === 200, `${instrument.market} quote expected 200, got ${result.response.status}: ${JSON.stringify(result.data)}`);
  assert(result.data?.source === "NAVER", `${instrument.market} quote source is not NAVER`);
  assert(Array.isArray(result.data?.quotes) && Number(result.data.quotes[0]?.price) > 0, `${instrument.market} quote missing positive price`);
  const quote = result.data.quotes[0];
  for (const field of ["referencePrice", "open", "high", "low", "volume", "tradingValue", "high52Week", "low52Week"]) {
    assert(Number(quote?.[field]) > 0, `${instrument.market} quote missing ${field}: ${JSON.stringify(quote)}`);
  }
  if (instrument.market === "KR" && venue) {
    assert(quote?.tradingVenue === venue, `KR requested ${venue} but received ${quote?.tradingVenue}`);
    assert(quote?.venue === "KOSPI", `KR listing market should remain KOSPI, got ${quote?.venue}`);
  }
  const timestamp = Number(quote?.timestamp);
  const ageMs = Number.isFinite(timestamp) && timestamp > 0 ? Date.now() - timestamp : null;
  const timestampText = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : "none";
  console.log(`PASS ${instrument.market}${venue ? ` ${venue}` : ""} quote + statistics (${quote.price}, ${result.elapsedMs}ms, timestamp=${timestampText}, ageMs=${ageMs}, verified=${Boolean(quote.timestampVerified)}, polling=${quote.pollingInterval ?? "n/a"})`);
  return quote;
}

async function quoteExtremaDates(cookie, instrument, quote) {
  const params = new URLSearchParams({
    market: instrument.market,
    symbol: instrument.symbol,
    high: String(quote.high52Week),
    low: String(quote.low52Week),
  });
  if (instrument.exchange) params.set("exchange", instrument.exchange);
  const result = await jsonRequest(`/api/quote-extrema-dates?${params.toString()}`, {
    headers: authHeaders(cookie),
    cache: "no-store",
  });
  assert(result.response.status === 200, `${instrument.market} 52-week dates expected 200, got ${result.response.status}: ${JSON.stringify(result.data)}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(result.data?.high52WeekDate ?? ""), `${instrument.market} 52-week high date missing: ${JSON.stringify(result.data)}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(result.data?.low52WeekDate ?? ""), `${instrument.market} 52-week low date missing: ${JSON.stringify(result.data)}`);
  console.log(`PASS ${instrument.market} 52-week dates (${result.data.high52WeekDate}, ${result.data.low52WeekDate}, ${result.elapsedMs}ms)`);
}

await waitForDeployment();
console.log(`PASS production endpoint reachable at ${BASE}`);

const home = await timedFetch("/", { cache: "no-store", redirect: "manual" });
const homeHtml = await home.response.text();
assert(home.response.status === 200, `home page expected 200, got ${home.response.status}`);
assert((home.response.headers.get("content-type") || "").toLowerCase().includes("text/html"), "home page is not HTML");
assert(/<html[^>]*lang=["']ko["']/i.test(homeHtml), "home page is missing Korean document language");
assert(homeHtml.includes("마켓메이트 | 친구들과 하는 실전 모의투자"), "home page title is missing");
console.log(`PASS production HTML (${homeHtml.length} chars, ${home.elapsedMs}ms)`);

const favicon = await timedFetch("/favicon.svg", { cache: "no-store" });
assert(favicon.response.status === 200, `favicon expected 200, got ${favicon.response.status}`);
console.log(`PASS static asset delivery (${favicon.elapsedMs}ms)`);

const unauth = await jsonRequest("/api/auth/me", { cache: "no-store" });
assert(unauth.response.status === 401, `unauthenticated auth guard expected 401, got ${unauth.response.status}`);
console.log(`PASS unauthenticated auth guard (${unauth.elapsedMs}ms)`);

const registered = await jsonRequest("/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ nickname, pin }),
});
assert(registered.response.status === 201, `register expected 201, got ${registered.response.status}: ${JSON.stringify(registered.data)}`);
assert(registered.data?.user?.id && registered.data?.user?.nickname === nickname, "production registration response mismatch");
const cookie = (registered.response.headers.get("set-cookie") || "").split(";")[0];
assert(cookie.startsWith("marketmate_session="), "production session cookie missing");
if (USER_FILE) {
  mkdirSync(dirname(USER_FILE), { recursive: true });
  writeFileSync(USER_FILE, String(registered.data.user.id));
}
console.log(`PASS production D1 registration/session (${registered.elapsedMs}ms)`);

const me = await jsonRequest("/api/auth/me", { headers: authHeaders(cookie), cache: "no-store" });
assert(me.response.status === 200 && me.data?.user?.nickname === nickname, "production session readback failed");
console.log(`PASS production D1 session readback (${me.elapsedMs}ms)`);

const kr = await searchInstrument(cookie, "KR", "삼성전자", "005930");
const krxQuote = await quoteInstrument(cookie, kr, "KRX");
await quoteExtremaDates(cookie, kr, krxQuote);
if (Array.isArray(krxQuote.availableVenues) && krxQuote.availableVenues.includes("NXT")) {
  await quoteInstrument(cookie, kr, "NXT");
}

const us = await searchInstrument(cookie, "US", "AAPL");
const usQuote = await quoteInstrument(cookie, us);
await quoteExtremaDates(cookie, us, usQuote);

const crypto = await searchInstrument(cookie, "CRYPTO", "BTC");
const cryptoQuote = await quoteInstrument(cookie, crypto);
await quoteExtremaDates(cookie, crypto, cryptoQuote);

for (const venue of ["KRX", "NXT"]) {
  const status = await jsonRequest(`/api/market-status?market=KR&live=1&venue=${venue}`, { headers: authHeaders(cookie), cache: "no-store" });
  assert(status.response.status === 200, `KR ${venue} market status expected 200, got ${status.response.status}: ${JSON.stringify(status.data)}`);
  assert(status.data?.source === "NAVER" && status.data?.exchange === venue, `KR ${venue} status mismatch: ${JSON.stringify(status.data)}`);
  console.log(`PASS KR ${venue} market status (${status.data?.label ?? "unknown"}, ${status.elapsedMs}ms)`);
}
const usStatus = await jsonRequest("/api/market-status?market=US", { headers: authHeaders(cookie), cache: "no-store" });
assert(usStatus.response.status === 200 && usStatus.data?.source === "NAVER", `US market status invalid: ${JSON.stringify(usStatus.data)}`);
console.log(`PASS US market status (${usStatus.data?.label ?? "unknown"}, ${usStatus.elapsedMs}ms)`);

const chartParams = new URLSearchParams({ market: "KR", symbol: "005930", exchange: kr.exchange || "KRX", range: "1M" });
const chart = await jsonRequest(`/api/chart?${chartParams.toString()}`, { headers: authHeaders(cookie), cache: "no-store" });
assert(chart.response.status === 200, `production chart expected 200, got ${chart.response.status}: ${JSON.stringify(chart.data)}`);
assert(chart.data?.source === "NAVER" && Array.isArray(chart.data?.points) && chart.data.points.length > 0, "production chart response invalid");
console.log(`PASS production KR chart (${chart.data.points.length} points, ${chart.elapsedMs}ms)`);

const news = await jsonRequest(`/api/news?market=KR&symbol=005930&name=${encodeURIComponent("삼성전자")}&exchange=${encodeURIComponent(kr.exchange || "KRX")}`, {
  headers: authHeaders(cookie), cache: "no-store",
});
assert(news.response.status === 200, `production news expected 200, got ${news.response.status}: ${JSON.stringify(news.data)}`);
assert(news.data?.source === "NAVER" && Array.isArray(news.data?.items), "production news response invalid");
console.log(`PASS production KR news (${news.data.items.length} items, ${news.elapsedMs}ms)`);

const overview = await jsonRequest("/api/market-overview", { headers: authHeaders(cookie), cache: "no-store" });
assert(overview.response.status === 200, `market overview expected 200, got ${overview.response.status}: ${JSON.stringify(overview.data)}`);
assert(Array.isArray(overview.data?.quotes) && Number(overview.data?.pollingInterval) >= 2_000, "market overview response invalid");
console.log(`PASS production market overview (${overview.data.quotes.length} quotes, ${overview.elapsedMs}ms)`);

console.log("All production deployment runtime checks passed.");
