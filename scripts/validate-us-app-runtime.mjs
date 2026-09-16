const BASE = process.env.APP_SMOKE_BASE_URL || "http://127.0.0.1:8787";
const nickname = `us${Date.now().toString(36).slice(-8)}`.slice(0, 12);
const pin = String((Date.now() % 9000) + 1000).slice(0, 4);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${BASE}${path}`, options);
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { response, data, elapsedMs: Date.now() - startedAt };
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("local Worker did not become ready");
}

function tickerOf(symbol) {
  return String(symbol || "").toUpperCase().replace(/\.[A-Z]$/, "");
}

await waitForWorker();

const registered = await jsonRequest("/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nickname, pin }),
});
assert(registered.response.status === 201, `US smoke register failed: ${registered.response.status} ${JSON.stringify(registered.data)}`);
const cookie = (registered.response.headers.get("set-cookie") || "").split(";")[0];
assert(cookie.startsWith("marketmate_session="), "US smoke session cookie missing");
const headers = { cookie };

// Naver uses three different US visual schemes: company Stock{ReutersCode}
// artwork, ETF issuer brands, and dedicated leverage/inverse ETF icons. Keep a
// representative matrix here so a ticker-only regression cannot silently make
// most US logos disappear again.
const logoCases = [
  ["AAPL", "/logo/stock/StockAAPL.O.svg"],
  ["NVDA", "/logo/stock/StockNVDA.O.svg"],
  ["GEV", "/logo/stock/StockGEV.svg"],
  ["SPY", "/logo/brand/foreign/StockBRANDSPDR.svg"],
  ["QQQ", "/logo/brand/foreign/StockBRANDInvesco.svg"],
  ["SOXL", "/logo/etf/StockUSETFLeverage3x.svg"],
  ["IWM", "/logo/brand/foreign/StockBRANDIshares.svg"],
  ["SOXX", "/logo/brand/foreign/StockBRANDIshares.svg"],
  ["VOO", "/logo/brand/foreign/StockBRANDVanguard.svg"],
  ["SOXS", "/logo/etf/StockUSETFInverse3x.svg"],
  ["TQQQ", "/logo/etf/StockUSETFLeverage3x.svg"],
  ["SCHD", "/logo/brand/foreign/StockBRANDCharlesSchwab.svg"],
  ["SMH", "/logo/brand/foreign/StockBRANDVanEck.svg"],
];

for (const [ticker, expectedPath] of logoCases) {
  const search = await jsonRequest(`/api/instruments/search?q=${encodeURIComponent(ticker)}&market=US`, { headers, cache: "no-store" });
  assert(search.response.status === 200, `${ticker} search expected 200, got ${search.response.status}`);
  const instrument = search.data?.instruments?.find(item => item?.market === "US" && tickerOf(item?.symbol) === ticker)
    ?? search.data?.instruments?.find(item => item?.market === "US");
  assert(instrument, `${ticker} missing from Naver-backed search: ${JSON.stringify(search.data?.instruments)}`);

  const logoResponse = await fetch(`${BASE}/api/instruments/logo?symbol=${encodeURIComponent(instrument.symbol)}`, {
    headers,
    cache: "no-store",
    redirect: "manual",
  });
  assert(logoResponse.status === 302, `${ticker} logo resolver expected 302, got ${logoResponse.status} (${instrument.symbol})`);
  const location = logoResponse.headers.get("location") || "";
  assert(location.startsWith("https://ssl.pstatic.net/imgstock/fn/"), `${ticker} logo points outside Naver assets: ${location}`);
  assert(location.includes(expectedPath), `${ticker} logo mismatch: expected ${expectedPath}, got ${location}`);

  const imageResponse = await fetch(location, { signal: AbortSignal.timeout(5_000) });
  assert(imageResponse.ok, `${ticker} Naver logo asset failed: ${imageResponse.status} ${location}`);
  console.log(`PASS ${ticker} logo (${instrument.symbol} -> ${location})`);
}

const aaplSearch = await jsonRequest("/api/instruments/search?q=AAPL&market=US", { headers, cache: "no-store" });
assert(aaplSearch.response.status === 200, `AAPL search expected 200, got ${aaplSearch.response.status}`);
const aapl = aaplSearch.data?.instruments?.find(item => item?.market === "US" && tickerOf(item?.symbol) === "AAPL")
  ?? aaplSearch.data?.instruments?.find(item => item?.market === "US");
assert(aapl, `AAPL missing from Naver-backed search: ${JSON.stringify(aaplSearch.data?.instruments)}`);
console.log(`PASS AAPL search (${aapl.name}, ${aapl.symbol}, ${aapl.exchange}, ${aaplSearch.elapsedMs}ms)`);

const status = await jsonRequest("/api/market-status?market=US", { headers, cache: "no-store" });
assert(status.response.status === 200, `US market status expected 200, got ${status.response.status}: ${JSON.stringify(status.data)}`);
assert(status.data?.market === "US" && status.data?.source === "NAVER", "US market status response contract mismatch");
assert(status.elapsedMs < 1_500, `US market status too slow: ${status.elapsedMs}ms`);
console.log(`PASS US market-status (${status.data.label}, ${status.elapsedMs}ms)`);

const aaplChartParams = new URLSearchParams({ market: "US", symbol: aapl.symbol, exchange: aapl.exchange || "NAS", range: "1M" });
const aaplChart = await jsonRequest(`/api/chart?${aaplChartParams.toString()}`, { headers, cache: "no-store" });
assert(aaplChart.response.status === 200, `AAPL chart expected 200, got ${aaplChart.response.status}: ${JSON.stringify(aaplChart.data)}`);
assert(aaplChart.data?.source === "NAVER" && Array.isArray(aaplChart.data?.points) && aaplChart.data.points.length > 0, `AAPL chart missing points: ${JSON.stringify(aaplChart.data)}`);
console.log(`PASS AAPL 1M chart (${aaplChart.data.points.length} points, ${aaplChart.elapsedMs}ms)`);

const soxsSearch = await jsonRequest("/api/instruments/search?q=SOXS&market=US", { headers, cache: "no-store" });
assert(soxsSearch.response.status === 200, `SOXS search expected 200, got ${soxsSearch.response.status}: ${JSON.stringify(soxsSearch.data)}`);
const soxs = soxsSearch.data?.instruments?.find(item => item?.market === "US" && tickerOf(item?.symbol) === "SOXS")
  ?? soxsSearch.data?.instruments?.find(item => item?.market === "US");
assert(soxs, `SOXS missing from Naver-backed search: ${JSON.stringify(soxsSearch.data?.instruments)}`);
console.log(`PASS SOXS search (${soxs.name}, ${soxs.symbol}, ${soxs.exchange}, ${soxsSearch.elapsedMs}ms)`);

const soxsChartParams = new URLSearchParams({ market: "US", symbol: soxs.symbol, exchange: soxs.exchange || "AMS", range: "3M" });
const soxsChart = await jsonRequest(`/api/chart?${soxsChartParams.toString()}`, { headers, cache: "no-store" });
assert(soxsChart.response.status === 200, `SOXS 3M chart expected 200, got ${soxsChart.response.status}: ${JSON.stringify(soxsChart.data)}`);
assert(soxsChart.data?.source === "NAVER" && Array.isArray(soxsChart.data?.points) && soxsChart.data.points.length > 0, `SOXS chart missing points: ${JSON.stringify(soxsChart.data)}`);
console.log(`PASS SOXS 3M chart (${soxsChart.data.points.length} points, ${soxsChart.elapsedMs}ms)`);

const newsParams = new URLSearchParams({ market: "US", symbol: soxs.symbol, name: soxs.name || "SOXS", exchange: soxs.exchange || "AMS" });
const news = await jsonRequest(`/api/news?${newsParams.toString()}`, { headers, cache: "no-store" });
assert(news.response.status === 200, `SOXS news expected 200, got ${news.response.status}: ${JSON.stringify(news.data)}`);
assert(news.data?.source === "NAVER" && Array.isArray(news.data?.items), `SOXS news response contract mismatch: ${JSON.stringify(news.data)}`);
console.log(`PASS SOXS news contract (${news.data.items.length} items, ${news.elapsedMs}ms)`);

console.log("All US stock/ETF app runtime smoke checks passed.");
