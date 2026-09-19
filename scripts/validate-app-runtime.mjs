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
assert(/<html[^>]*lang=["']ko["']/i.test(homeHtml), "home page is missing Korean document language");
assert(homeHtml.includes("마켓메이트 | 친구들과 하는 실전 모의투자"), "home page is missing expected document title");
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
const samsungByName = search.data.instruments.find(item => item?.market === "KR" && item?.symbol === "005930" && item?.name === "삼성전자");
assert(samsungByName, `Samsung 005930 missing from Naver-backed name search: ${JSON.stringify(search.data?.instruments)}`);
assert(samsungByName.exchange === "KOSPI", `Samsung search exchange expected KOSPI, got ${samsungByName.exchange}`);
assert(search.data?.source === "NAVER", "instrument search source is not NAVER");
console.log("PASS authenticated Naver instrument name search + KOSPI label");

const codeSearch = await jsonRequest("/api/instruments/search?q=005930&market=KR", { headers: authHeaders, cache: "no-store" });
assert(codeSearch.response.status === 200, `numeric instrument search expected 200, got ${codeSearch.response.status}: ${JSON.stringify(codeSearch.data)}`);
assert(Array.isArray(codeSearch.data?.instruments), "numeric instrument search did not return instruments[]");
const samsungByCode = codeSearch.data.instruments.find(item => item?.market === "KR" && item?.symbol === "005930" && item?.name === "삼성전자");
assert(samsungByCode, `Samsung 005930 missing from exact numeric search: ${JSON.stringify(codeSearch.data?.instruments)}`);
assert(samsungByCode.exchange === "KOSPI", `Samsung numeric search exchange expected KOSPI, got ${samsungByCode.exchange}`);
assert(codeSearch.data?.source === "NAVER", "numeric instrument search source is not NAVER");
console.log("PASS Naver numeric-code instrument search + KOSPI label");

const usInitialSearch = await jsonRequest(`/api/instruments/search?q=${encodeURIComponent("ㅌㅅㄹ")}&market=US`, { headers: authHeaders, cache: "no-store" });
assert(usInitialSearch.response.status === 200, `US initial search expected 200, got ${usInitialSearch.response.status}: ${JSON.stringify(usInitialSearch.data)}`);
const teslaByInitial = usInitialSearch.data?.instruments?.find(item => item?.market === "US" && item?.symbol === "TSLA.O" && item?.name === "테슬라");
assert(teslaByInitial, `Tesla missing from US initial-consonant search: ${JSON.stringify(usInitialSearch.data?.instruments)}`);
console.log("PASS US initial-consonant instrument search (테슬라 / TSLA.O)");

const cryptoInitialSearch = await jsonRequest(`/api/instruments/search?q=${encodeURIComponent("ㅂㅌㅋㅇ")}&market=CRYPTO`, { headers: authHeaders, cache: "no-store" });
assert(cryptoInitialSearch.response.status === 200, `crypto initial search expected 200, got ${cryptoInitialSearch.response.status}: ${JSON.stringify(cryptoInitialSearch.data)}`);
const bitcoinByInitial = cryptoInitialSearch.data?.instruments?.find(item => item?.market === "CRYPTO" && item?.symbol === "KRW-BTC" && item?.name === "비트코인");
assert(bitcoinByInitial, `Bitcoin missing from crypto initial-consonant search: ${JSON.stringify(cryptoInitialSearch.data?.instruments)}`);
console.log("PASS crypto initial-consonant instrument search (비트코인 / KRW-BTC)");

const marketStatus = await jsonRequest("/api/market-status?market=KR", { headers: authHeaders, cache: "no-store" });
assert(marketStatus.response.status === 200, `market status expected 200, got ${marketStatus.response.status}: ${JSON.stringify(marketStatus.data)}`);
assert(marketStatus.data?.market === "KR", "market status market mismatch");
assert(marketStatus.data?.source === "NAVER", "market status source is not NAVER");
console.log(`PASS KR market-status (${marketStatus.data?.label ?? "unknown"})`);

const quote = await jsonRequest("/api/quotes?market=KR&symbols=005930&exchange=KOSPI&venue=KRX", { headers: authHeaders, cache: "no-store" });
assert(quote.response.status === 200, `quote expected 200, got ${quote.response.status}: ${JSON.stringify(quote.data)}`);
assert(Array.isArray(quote.data?.quotes) && quote.data.quotes.length > 0, "quote response missing quotes[]");
const krxQuote = quote.data.quotes[0];
assert(Number(krxQuote?.price) > 0, "Samsung quote has no positive price");
assert(krxQuote?.venue === "KOSPI", `Samsung client listing label expected KOSPI, got ${krxQuote?.venue}`);
assert(krxQuote?.tradingVenue === "KRX", `Samsung KRX quote trading venue mismatch: ${krxQuote?.tradingVenue}`);
for (const field of ["open", "high", "low", "volume", "tradingValue", "high52Week", "low52Week"]) {
  assert(Number(krxQuote?.[field]) > 0, `Samsung integrated quote missing ${field}: ${JSON.stringify(krxQuote)}`);
}
assert(Array.isArray(krxQuote?.availableVenues) && krxQuote.availableVenues.includes("KRX"), "Samsung availableVenues missing KRX");
assert(Number(krxQuote?.referencePrice) > 0, `Samsung Naver reference price missing: ${JSON.stringify(krxQuote)}`);
assert(quote.data?.source === "NAVER", "quote source is not NAVER");
console.log(`PASS KR KRX quote + Naver reference/integrated statistics (${krxQuote.price}, ref=${krxQuote.referencePrice}, KOSPI)`);

const extremaParams = new URLSearchParams({
  market: "KR",
  symbol: "005930",
  exchange: "KOSPI",
  high: String(krxQuote.high52Week),
  low: String(krxQuote.low52Week),
});
const extrema = await jsonRequest(`/api/quote-extrema-dates?${extremaParams.toString()}`, { headers: authHeaders, cache: "no-store" });
assert(extrema.response.status === 200, `52-week date metadata expected 200, got ${extrema.response.status}: ${JSON.stringify(extrema.data)}`);
assert(/^\d{4}-\d{2}-\d{2}$/.test(extrema.data?.high52WeekDate ?? ""), `52-week high date missing: ${JSON.stringify(extrema.data)}`);
assert(/^\d{4}-\d{2}-\d{2}$/.test(extrema.data?.low52WeekDate ?? ""), `52-week low date missing: ${JSON.stringify(extrema.data)}`);
console.log(`PASS KR 52-week high/low dates (${extrema.data.high52WeekDate}, ${extrema.data.low52WeekDate})`);

if (krxQuote.availableVenues.includes("NXT")) {
  const nxtQuoteResult = await jsonRequest("/api/quotes?market=KR&symbols=005930&exchange=KOSPI&venue=NXT", { headers: authHeaders, cache: "no-store" });
  assert(nxtQuoteResult.response.status === 200, `NXT quote expected 200, got ${nxtQuoteResult.response.status}: ${JSON.stringify(nxtQuoteResult.data)}`);
  const nxtQuote = nxtQuoteResult.data?.quotes?.[0];
  assert(Number(nxtQuote?.price) > 0 && nxtQuote?.tradingVenue === "NXT", `Samsung NXT quote invalid: ${JSON.stringify(nxtQuote)}`);
  for (const field of ["open", "high", "low", "volume", "tradingValue", "high52Week", "low52Week"]) {
    assert(Number(nxtQuote?.[field]) > 0, `Samsung NXT selection missing integrated ${field}: ${JSON.stringify(nxtQuote)}`);
  }
  console.log(`PASS KR NXT selectable quote + integrated statistics (${nxtQuote.price})`);
}

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

const usNews = await jsonRequest("/api/news?market=US&symbol=AAPL.O&name=Apple&exchange=NASDAQ", { headers: authHeaders, cache: "no-store" });
assert(usNews.response.status === 200, `US news expected 200, got ${usNews.response.status}: ${JSON.stringify(usNews.data)}`);
assert(Array.isArray(usNews.data?.items), "US news response missing items[]");
const usWorldNews = usNews.data.items.filter(item => item?.kind === "WORLD");
assert(usWorldNews.length > 0, `US world news missing: ${JSON.stringify(usNews.data)}`);
console.log(`PASS US world news through app route (${usWorldNews.length} world / ${usNews.data.items.length} total)`);

const overview = await jsonRequest("/api/market-overview", { headers: authHeaders, cache: "no-store" });
assert(overview.response.status === 200, `market overview expected 200, got ${overview.response.status}: ${JSON.stringify(overview.data)}`);
assert(Array.isArray(overview.data?.quotes), "market overview missing quotes[]");
assert(Number(overview.data?.pollingInterval) >= 2_000, "market overview pollingInterval invalid");
console.log(`PASS market overview through app route (${overview.data.quotes.length} fresh quotes)`);

const popular = await jsonRequest("/api/popular-stocks", { headers: authHeaders, cache: "no-store" });
assert(popular.response.status === 200, `popular stocks expected 200, got ${popular.response.status}: ${JSON.stringify(popular.data)}`);
for (const [label, items] of [["domestic", popular.data?.domestic], ["us", popular.data?.us]]) {
  assert(Array.isArray(items), `popular stocks missing ${label}[]`);
  assert(items.length > 0 && items.length <= 10, `popular stocks ${label} must contain 1-10 items: ${JSON.stringify(items)}`);
  assert(items.every((item, index) => item?.rank === index + 1 && Number(item?.price) > 0), `popular stocks ${label} rank/price invalid: ${JSON.stringify(items)}`);
}
assert(popular.data.domestic.every(item => item?.market === "KR"), `popular domestic contains non-KR rows: ${JSON.stringify(popular.data.domestic)}`);
assert(popular.data.us.every(item => item?.market === "US"), `popular US contains non-US rows: ${JSON.stringify(popular.data.us)}`);
console.log(`PASS Naver popular stocks (KR ${popular.data.domestic.length}, US ${popular.data.us.length})`);

for (const market of ["KR", "US", "CRYPTO"]) {
  for (const category of ["tradingValue", "volume", "up", "down", "marketCap"]) {
    const ranking = await jsonRequest(`/api/market-rankings?market=${market}&category=${category}`, { headers: authHeaders, cache: "no-store" });
    assert(ranking.response.status === 200, `${market}/${category} ranking expected 200, got ${ranking.response.status}: ${JSON.stringify(ranking.data)}`);
    assert(ranking.data?.source === "NAVER", `${market}/${category} ranking source is not NAVER`);
    assert(ranking.data?.market === market, `${market}/${category} ranking market mismatch`);
    assert(ranking.data?.category === category, `${market}/${category} ranking category mismatch`);
    assert(Array.isArray(ranking.data?.items), `${market}/${category} ranking missing items[]`);
    assert(ranking.data.items.length > 0 && ranking.data.items.length <= 10, `${market}/${category} ranking must contain 1-10 items`);
    assert(ranking.data.items.every((item, index) => item?.rank === index + 1 && Number(item?.price) > 0), `${market}/${category} ranking has invalid rank/price data`);
    if (market === "KR") {
      assert(ranking.data.items.every(item => ["KOSPI", "KOSDAQ", "KONEX"].includes(item?.exchange)), `${market}/${category} ranking has non-listing exchange labels: ${JSON.stringify(ranking.data.items.map(item => item?.exchange))}`);
    }
  }
  console.log(`PASS ${market} Naver realtime rankings (5 categories)`);
}

console.log("All app-level runtime smoke checks passed.");
