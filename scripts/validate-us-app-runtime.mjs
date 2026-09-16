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

async function probeNaver(path, label) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`https://stock.naver.com${path}`, {
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        referer: "https://stock.naver.com/",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
      },
      redirect: "manual",
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    const root = data && typeof data === "object" ? data : null;
    const sample = Array.isArray(root)
      ? root.slice(0, 2)
      : root && typeof root === "object"
        ? Object.fromEntries(Object.entries(root).slice(0, 12))
        : text.slice(0, 800);
    console.log(`PROBE ${label}: status=${response.status}, ms=${Date.now() - startedAt}, body=${JSON.stringify(sample).slice(0, 5000)}`);
  } catch (error) {
    console.log(`PROBE ${label}: ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
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
console.log(`PASS SOXS search (${instrument.name}, ${instrument.symbol}, ${instrument.exchange}, ${search.elapsedMs}ms)`);

const aaplSearch = await jsonRequest("/api/instruments/search?q=AAPL&market=US", { headers, cache: "no-store" });
const aapl = aaplSearch.data?.instruments?.find(item => item?.market === "US") ?? { symbol: "AAPL", exchange: "NAS" };
console.log(`INFO AAPL search (${aapl.name ?? "Apple"}, ${aapl.symbol}, ${aapl.exchange})`);

await probeNaver("/api/securityService/stock/AAPL.O/price?page=1&pageSize=3", "AAPL stock price");
await probeNaver("/api/securityService/stock/AAPL/price?page=1&pageSize=3", "AAPL plain stock price");
await probeNaver("/api/securityService/etf/SOXS/price?page=1&pageSize=3", "SOXS ETF price");
await probeNaver("/api/securityService/stock/SOXS.A/price?page=1&pageSize=3", "SOXS Reuters stock price");

const status = await jsonRequest("/api/market-status?market=US", { headers, cache: "no-store" });
assert(status.response.status === 200, `US market status expected 200, got ${status.response.status}: ${JSON.stringify(status.data)}`);
assert(status.data?.market === "US" && status.data?.source === "NAVER", "US market status response contract mismatch");
assert(status.elapsedMs < 1_500, `US market status too slow: ${status.elapsedMs}ms`);
console.log(`PASS US market-status (${status.data.label}, ${status.elapsedMs}ms)`);

const aaplChartParams = new URLSearchParams({ market: "US", symbol: aapl.symbol, exchange: aapl.exchange || "NAS", range: "1M" });
const aaplChart = await jsonRequest(`/api/chart?${aaplChartParams.toString()}`, { headers, cache: "no-store" });
console.log(`INFO AAPL chart status=${aaplChart.response.status}, ms=${aaplChart.elapsedMs}, data=${JSON.stringify(aaplChart.data).slice(0, 1200)}`);

const chartParams = new URLSearchParams({ market: "US", symbol: instrument.symbol, exchange: instrument.exchange || "AMS", range: "3M" });
const chart = await jsonRequest(`/api/chart?${chartParams.toString()}`, { headers, cache: "no-store" });
assert(chart.response.status === 200, `SOXS 3M chart expected 200, got ${chart.response.status}: ${JSON.stringify(chart.data)}`);
assert(chart.data?.source === "NAVER" && Array.isArray(chart.data?.points) && chart.data.points.length > 0, `SOXS chart missing points: ${JSON.stringify(chart.data)}`);
console.log(`PASS SOXS 3M chart (${chart.data.points.length} points, ${chart.elapsedMs}ms)`);

const newsParams = new URLSearchParams({ market: "US", symbol: instrument.symbol, name: instrument.name || "SOXS", exchange: instrument.exchange || "AMS" });
const news = await jsonRequest(`/api/news?${newsParams.toString()}`, { headers, cache: "no-store" });
assert(news.response.status === 200, `SOXS news expected 200, got ${news.response.status}: ${JSON.stringify(news.data)}`);
assert(news.data?.source === "NAVER" && Array.isArray(news.data?.items), `SOXS news response contract mismatch: ${JSON.stringify(news.data)}`);
console.log(`PASS SOXS news contract (${news.data.items.length} items, ${news.elapsedMs}ms)`);

console.log("All US ETF app runtime smoke checks passed.");
