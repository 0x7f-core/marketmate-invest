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

const search = await jsonRequest("/api/instruments/search?q=SOXS&market=US", { headers, cache: "no-store" });
assert(search.response.status === 200, `SOXS search expected 200, got ${search.response.status}: ${JSON.stringify(search.data)}`);
const instrument = search.data?.instruments?.find(item => item?.market === "US" && item?.symbol === "SOXS") ?? search.data?.instruments?.find(item => item?.market === "US");
assert(instrument, `SOXS missing from Naver-backed search: ${JSON.stringify(search.data?.instruments)}`);
console.log(`PASS SOXS search (${instrument.name}, ${instrument.exchange}, ${search.elapsedMs}ms)`);

const status = await jsonRequest("/api/market-status?market=US", { headers, cache: "no-store" });
assert(status.response.status === 200, `US market status expected 200, got ${status.response.status}: ${JSON.stringify(status.data)}`);
assert(status.data?.market === "US" && status.data?.source === "NAVER", "US market status response contract mismatch");
assert(status.elapsedMs < 1_500, `US market status too slow: ${status.elapsedMs}ms`);
console.log(`PASS US market-status (${status.data.label}, ${status.elapsedMs}ms)`);

const chartParams = new URLSearchParams({ market: "US", symbol: instrument.symbol, exchange: instrument.exchange || "AMS", range: "3M" });
const chart = await jsonRequest(`/api/chart?${chartParams.toString()}`, { headers, cache: "no-store" });
assert(chart.response.status === 200, `SOXS 3M chart expected 200, got ${chart.response.status}: ${JSON.stringify(chart.data)}`);
assert(chart.data?.source === "NAVER" && Array.isArray(chart.data?.points) && chart.data.points.length > 0, `SOXS chart missing points: ${JSON.stringify(chart.data)}`);
console.log(`PASS SOXS 3M chart (${chart.data.points.length} points, ${chart.elapsedMs}ms)`);

const newsParams = new URLSearchParams({ market: "US", symbol: instrument.symbol, name: instrument.name || "SOXS", exchange: instrument.exchange || "AMS" });
const news = await jsonRequest(`/api/news?${newsParams.toString()}`, { headers, cache: "no-store" });
assert(news.response.status === 200, `SOXS news expected 200, got ${news.response.status}: ${JSON.stringify(news.data)}`);
assert(news.data?.source === "NAVER" && Array.isArray(news.data?.items) && news.data.items.length > 0, `SOXS news missing items: ${JSON.stringify(news.data)}`);
console.log(`PASS SOXS news (${news.data.items.length} items, ${news.elapsedMs}ms)`);

console.log("All US ETF app runtime smoke checks passed.");
