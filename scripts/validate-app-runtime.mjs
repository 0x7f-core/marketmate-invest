const BASE = process.env.APP_SMOKE_BASE_URL || "http://127.0.0.1:8787";
const nickname = `ci${Date.now().toString(36).slice(-8)}`.slice(0, 12);
const pin = "4826";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function waitForWorker() {
  let lastError = "worker not ready";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`local Worker did not become ready: ${lastError}`);
}

await waitForWorker();
console.log(`PASS worker ready at ${BASE}`);

const homeResponse = await fetch(`${BASE}/`, { cache: "no-store", redirect: "manual" });
const homeHtml = await homeResponse.text();
assert(homeResponse.status === 200, `home page expected 200, got ${homeResponse.status}`);
assert((homeResponse.headers.get("content-type") || "").toLowerCase().includes("text/html"), "home page is not HTML");
assert(homeHtml.includes("마켓메이트"), "home page is missing MarketMate brand text");
assert(homeHtml.includes("친구들과 투자대회 시작하기"), "home page is missing unauthenticated login heading");
console.log(`PASS home HTML render (${homeHtml.length} chars)`);

const unauth = await jsonRequest("/api/auth/me", { cache: "no-store" });
assert(unauth.response.status === 401, `unauthenticated /api/auth/me expected 401, got ${unauth.response.status}`);
console.log("PASS unauthenticated auth guard");

const registered = await jsonRequest("/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nickname, pin }),
});
assert(registered.response.status === 201, `register expected 201, got ${registered.response.status}: ${JSON.stringify(registered.data)}`);
assert(registered.data?.user?.nickname === nickname, "register response nickname mismatch");
const setCookie = registered.response.headers.get("set-cookie") || "";
const cookie = setCookie.split(";")[0];
assert(cookie.startsWith("marketmate_session="), "session cookie missing after registration");
console.log("PASS registration + D1 write + session creation");

const authHeaders = { cookie };
const me = await jsonRequest("/api/auth/me", { headers: authHeaders, cache: "no-store" });
assert(me.response.status === 200, `/api/auth/me expected 200, got ${me.response.status}`);
assert(me.data?.user?.nickname === nickname, "authenticated user mismatch");
console.log("PASS session readback");

const search = await jsonRequest(`/api/instruments/search?q=${encodeURIComponent("삼성전자")}&market=KR`, { headers: authHeaders, cache: "no-store" });
assert(search.response.status === 200, `instrument search expected 200, got ${search.response.status}: ${JSON.stringify(search.data)}`);
assert(Array.isArray(search.data?.instruments), "instrument search did not return instruments[]");
assert(
  search.data.instruments.some(item => item?.market === "KR" && item?.symbol === "005930" && item?.name === "삼성전자"),
  `Samsung 005930 missing from Naver-backed name search: ${JSON.stringify(search.data?.instruments)}`,
);
assert(search.data?.source === "NAVER", "instrument search source is not NAVER");
console.log("PASS authenticated Naver instrument name search");

const codeSearch = await jsonRequest("/api/instruments/search?q=005930&market=KR", { headers: authHeaders, cache: "no-store" });
assert(codeSearch.response.status === 200, `numeric instrument search expected 200, got ${codeSearch.response.status}: ${JSON.stringify(codeSearch.data)}`);
assert(Array.isArray(codeSearch.data?.instruments), "numeric instrument search did not return instruments[]");
assert(
  codeSearch.data.instruments.some(item => item?.market === "KR" && item?.symbol === "005930" && item?.name === "삼성전자"),
  `Samsung 005930 missing from exact numeric search: ${JSON.stringify(codeSearch.data?.instruments)}`,
);
assert(codeSearch.data?.source === "NAVER", "numeric instrument search source is not NAVER");
console.log("PASS Naver numeric-code instrument search");

const marketStatus = await jsonRequest("/api/market-status?market=KR", { headers: authHeaders, cache: "no-store" });
assert(marketStatus.response.status === 200, `market status expected 200, got ${marketStatus.response.status}: ${JSON.stringify(marketStatus.data)}`);
assert(marketStatus.data?.market === "KR", "market status market mismatch");
assert(marketStatus.data?.source === "NAVER", "market status source is not NAVER");
console.log(`PASS KR market-status (${marketStatus.data?.label ?? "unknown"})`);

const quote = await jsonRequest("/api/quotes?market=KR&symbols=005930&exchange=KRX", { headers: authHeaders, cache: "no-store" });
assert(quote.response.status === 200, `quote expected 200, got ${quote.response.status}: ${JSON.stringify(quote.data)}`);
assert(Array.isArray(quote.data?.quotes) && quote.data.quotes.length > 0, "quote response missing quotes[]");
assert(Number(quote.data.quotes[0]?.price) > 0, "Samsung quote has no positive price");
assert(quote.data?.source === "NAVER", "quote source is not NAVER");
console.log(`PASS KR quote through app route (${quote.data.quotes[0].price})`);

const chart = await jsonRequest("/api/chart?market=KR&symbol=005930&exchange=KRX&range=1M", { headers: authHeaders, cache: "no-store" });
assert(chart.response.status === 200, `chart expected 200, got ${chart.response.status}: ${JSON.stringify(chart.data)}`);
assert(Array.isArray(chart.data?.points) && chart.data.points.length > 0, "chart response missing points[]");
assert(chart.data?.source === "NAVER", "chart source is not NAVER");
console.log(`PASS KR chart through app route (${chart.data.points.length} points)`);

const news = await jsonRequest("/api/news?market=KR&symbol=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90&exchange=KRX", { headers: authHeaders, cache: "no-store" });
assert(news.response.status === 200, `news expected 200, got ${news.response.status}: ${JSON.stringify(news.data)}`);
assert(Array.isArray(news.data?.items), "news response missing items[]");
assert(news.data?.source === "NAVER", "news source is not NAVER");
console.log(`PASS KR news through app route (${news.data.items.length} items)`);

const overview = await jsonRequest("/api/market-overview", { headers: authHeaders, cache: "no-store" });
assert(overview.response.status === 200, `market overview expected 200, got ${overview.response.status}: ${JSON.stringify(overview.data)}`);
assert(Array.isArray(overview.data?.quotes), "market overview missing quotes[]");
assert(Number(overview.data?.pollingInterval) >= 2_000, "market overview pollingInterval invalid");
console.log(`PASS market overview through app route (${overview.data.quotes.length} fresh quotes)`);

console.log("All app-level runtime smoke checks passed.");
