import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EXECUTABLE_ROOTS = ["app", "lib", "db"];
const REQUIRED_FILES = [
  "lib/server/naver-stock.ts",
  "lib/server/naver-fx.ts",
  "lib/server/trading-quote.ts",
  "lib/server/market-hours.ts",
  "lib/server/market-search.ts",
  "app/market-chart.tsx",
];

const FORBIDDEN = [
  { pattern: /api\.upbit\.com/i, label: "direct Upbit REST API" },
  { pattern: /openapi\.koreainvestment\.com/i, label: "KIS OpenAPI host" },
  { pattern: /KIS_APP_(?:KEY|SECRET)/, label: "KIS credential" },
  { pattern: /\b(?:kisGet|requestKisToken)\b/, label: "legacy KIS helper" },
  { pattern: /\bprovider_tokens\b/i, label: "legacy provider_tokens table" },
  { pattern: /\bmarket_calendar\b/i, label: "legacy market_calendar table" },
  { pattern: /tradingview\.com\/widgetembed/i, label: "TradingView Embed iframe" },
  { pattern: /\bTradingViewChart\b/, label: "legacy TradingView chart component" },
];

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".next", "dist", ".git"].includes(entry.name)) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

async function source(path) {
  return readFile(join(ROOT, path), "utf8");
}

const failures = [];

for (const required of REQUIRED_FILES) {
  try {
    const info = await stat(join(ROOT, required));
    if (!info.isFile()) failures.push(`required file is not a file: ${required}`);
  } catch {
    failures.push(`missing required file: ${required}`);
  }
}

const files = [];
for (const root of EXECUTABLE_ROOTS) {
  try {
    files.push(...await walk(join(ROOT, root)));
  } catch {
    failures.push(`missing executable root: ${root}`);
  }
}

for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(text)) failures.push(`${rule.label}: ${relative(ROOT, file)}`);
  }
}

const naverStock = await source("lib/server/naver-stock.ts");
if (!naverStock.includes("MAX_RESPONSE_BYTES") || !naverStock.includes("response.body.getReader()") || !naverStock.includes("bytesRead > MAX_RESPONSE_BYTES")) {
  failures.push("Naver responses must remain size-bounded while streaming");
}
if (!naverStock.includes("setTimeout(() => controller.abort(), timeoutMs)") || !naverStock.includes("finally {\n    clearTimeout(timer);\n  }")) {
  failures.push("Naver request timeout must remain active through response-body processing");
}
if (!naverStock.includes("Array.isArray(raw) ? raw : [raw]") || !naverStock.includes("query.append(key, String(value))")) {
  failures.push("Naver path builder must preserve repeated query keys such as exchanges=krx&exchanges=nxt");
}
if (!naverStock.includes("redirect: \"manual\"") || !naverStock.includes("url.origin !== NAVER_STOCK_BASE_URL")) {
  failures.push("Naver requests must remain same-origin and reject redirects");
}
if (!naverStock.includes("assertCompleteBody") || !naverStock.includes("receivedBytes < declaredLength") || !naverStock.includes('response.headers.get("content-encoding")')) {
  failures.push("Naver response reader must reject truncated identity responses without mischecking compressed bodies");
}

const marketData = await source("lib/server/market-data.ts");
if (!marketData.includes("getNaverUsdKrwRate") || marketData.includes("async function usdKrwRate(")) {
  failures.push("US quotes must use the shared Naver FX parser instead of a duplicate local parser");
}
if (!marketData.includes("exchangeRateOverride ?? (await getNaverUsdKrwRate()).rate")) {
  failures.push("US live quotes must support reusing a prevalidated Naver FX rate");
}
if (!marketData.includes("pollingInterval?: number") || !marketData.includes("domestic.value.pollingInterval") || !marketData.includes("foreign.value.pollingInterval") || !marketData.includes("crypto.value.pollingInterval")) {
  failures.push("market overview quotes must retain Naver pollingInterval metadata");
}

const naverSymbol = await source("lib/server/naver-symbol.ts");
if (!naverSymbol.includes('if (market === "CRYPTO")') || !naverSymbol.includes('_KRW_(?:UPBIT|BITHUMB)') || !naverSymbol.includes('`KRW-${ticker}`')) {
  failures.push("crypto symbols must be canonicalized to KRW-{ticker} across Naver routes");
}

const marketSearch = await source("lib/server/market-search.ts");
if (!marketSearch.includes('normalizeNaverMarketSymbol("CRYPTO", symbol || fqnf)')) {
  failures.push("Naver autocomplete crypto results must use the shared canonical symbol normalizer");
}

const marketOverview = await source("app/api/market-overview/route.ts");
if (!marketOverview.includes("Math.max(2_000") || !marketOverview.includes("Math.min(...intervals)") || !marketOverview.includes("pollingInterval")) {
  failures.push("market overview API must return a bounded Naver-driven polling interval");
}

const marketHours = await source("lib/server/market-hours.ts");
const krxPriority = marketHours.indexOf('item.exchange === "krx" && item.tradable');
const nxtPriority = marketHours.indexOf('item.exchange === "nxt" && item.tradable');
if (krxPriority < 0 || nxtPriority < 0 || krxPriority > nxtPriority) {
  failures.push("KR trading-session priority must prefer KRX before NXT");
}
if (!marketHours.includes('const exchanges = market === "KR" ? ["krx", "nxt"] : ["nasdaq"]') || !marketHours.includes('{ exchanges }')) {
  failures.push("Naver market-status requests must use repeated lowercase exchange parameters");
}
if (!marketHours.includes('if (type.includes("closing")) return false;')) {
  failures.push("closing sessions must remain non-tradable");
}
if (!marketHours.includes("US_AFTER_MARKET_CUTOFF_MINUTES_ET") || !marketHours.includes("19 * 60 + 50") || !marketHours.includes('return !type.includes("after") || beforeUsAfterMarketCutoff();')) {
  failures.push("US sessions must remain tradable while enforcing the 19:50 ET after-market cutoff");
}
if (!marketHours.includes('"marketStatusDetailType"')) {
  failures.push("market session parsing must support marketStatusDetailType fallback");
}
if (!marketHours.includes("if (!detail.isOpen || !detail.currentType) return false;")) {
  failures.push("unknown stock session types must fail closed");
}

const tradingQuote = await source("lib/server/trading-quote.ts");
if (!tradingQuote.includes('session.exchange === "NXT"')) {
  failures.push("NXT quote selection guard is missing");
}
if (!tradingQuote.includes("isExecutableTradingQuote")) {
  failures.push("executable quote freshness guard is missing");
}
if (!tradingQuote.includes("getNaverUsdKrwRate") || !tradingQuote.includes('if (fx.stale) throw new Error("NAVER_FX_UNAVAILABLE")')) {
  failures.push("US trading quotes must reject stale Naver FX data");
}
if (!tradingQuote.includes("getLiveQuote(market, symbol, exchange, fx.rate)")) {
  failures.push("US trading quotes must reuse the already validated Naver FX rate");
}

for (const path of [
  "app/api/orders/route.ts",
  "app/api/quotes/route.ts",
  "app/api/watchlist/route.ts",
  "app/api/leaderboard/route.ts",
  "app/api/portfolio/route.ts",
]) {
  const text = await source(path);
  if (!text.includes("getTradingQuote")) failures.push(`getTradingQuote wiring is missing: ${path}`);
  if (/\bgetLiveQuote\b/.test(text)) failures.push(`direct getLiveQuote bypass is forbidden: ${path}`);
}

const orders = await source("app/api/orders/route.ts");
if (!orders.includes("isExecutableTradingQuote")) {
  failures.push("new orders must validate executable Naver quote freshness");
}
if (!orders.includes("quote.venue ?? exchange ?? body.market")) {
  failures.push("orders must persist the actual active KR venue when available");
}
if (!orders.includes("const SAFE_ID") || !orders.includes("name.length > 80") || !orders.includes("exchange.length > 40")) {
  failures.push("order metadata must remain runtime-validated before it reaches D1");
}

const quotesRoute = await source("app/api/quotes/route.ts");
if (!quotesRoute.includes("const resolvedExchange = quote.venue") || !quotesRoute.includes("ELSE instruments.exchange END")) {
  failures.push("quote refreshes must persist active KR venues without overwriting known US exchanges");
}
if (!quotesRoute.includes("new Set(symbols.map")) {
  failures.push("quote refreshes must deduplicate normalized symbols");
}
if (!quotesRoute.includes("symbolsRaw.length > 700") || !quotesRoute.includes("!EXCHANGE.test(exchange)")) {
  failures.push("quote query identifiers must stay bounded before Naver resolution");
}

const chartRoute = await source("app/api/chart/route.ts");
if (!chartRoute.includes("const EXCHANGE") || !chartRoute.includes("!EXCHANGE.test(exchange)")) {
  failures.push("chart exchange identifiers must remain bounded and validated");
}

for (const path of ["app/api/portfolio/route.ts", "app/api/participants/activity/route.ts"]) {
  const text = await source(path);
  if (!text.includes("i.exchange")) failures.push(`instrument exchange must be exposed to position clients: ${path}`);
  if (/f\.executed_at AS executedAt[\s\S]{0,160}i\.exchange/.test(text)) {
    failures.push(`historical fills must not inherit mutable instrument exchange metadata: ${path}`);
  }
}

const portfolioRoute = await source("app/api/portfolio/route.ts");
if (!portfolioRoute.includes("refreshPortfolioQuote") || !portfolioRoute.includes("Promise.allSettled(stale.results.map") || !portfolioRoute.includes("quote.stale")) {
  failures.push("portfolio valuations must refresh stale Naver quotes without replacing them with stale fallback data");
}

const dashboard = await source("app/trading-dashboard.tsx");
if (/\bUPBIT\b/.test(dashboard)) {
  failures.push("dashboard must not expose legacy UPBIT fallback labels");
}
if (!dashboard.includes('venue?:"KRX"|"NXT"') || !dashboard.includes("exchange:q.venue??current.exchange")) {
  failures.push("dashboard must follow the active KRX/NXT venue returned by Naver quotes");
}
if (!dashboard.includes('exchange: "NAVER"')) {
  failures.push("dashboard crypto fallback provider label must remain NAVER");
}
if (!/exchange:\s*string;\s*currency:\s*string;\s*quantityMicros/.test(dashboard) || !dashboard.includes("exchange:p.exchange||")) {
  failures.push("portfolio positions must reuse persisted instrument exchange metadata in the dashboard");
}
if (dashboard.includes("fill.exchange")) {
  failures.push("historical fills must not present the mutable instrument exchange as the execution venue");
}
if (!dashboard.includes('return "날짜 미상"')) {
  failures.push("undated Naver news must not be presented with a fabricated relative timestamp");
}
if (dashboard.includes("setInterval(load,10_000)") || !dashboard.includes("pollingInterval?:number") || !dashboard.includes("Math.max(2_000,Math.min(120_000,delay))")) {
  failures.push("market overview client polling must follow the Naver polling interval instead of a fixed 10-second interval");
}
if (!dashboard.includes("setMarketSession(LOADING_MARKET_SESSION)")) {
  failures.push("market switches must fail closed in the UI until the new Naver market status arrives");
}

const newsRoute = await source("app/api/news/route.ts");
if (!newsRoute.includes("return 0;") || /Date\.now\(\)\s*-\s*index/.test(newsRoute)) {
  failures.push("undated Naver news must sort behind dated articles instead of being fabricated as newest");
}
if (!newsRoute.includes("const EXCHANGE") || !newsRoute.includes("!EXCHANGE.test(exchange)")) {
  failures.push("news exchange identifiers must remain bounded and validated");
}

const marketChart = await source("app/market-chart.tsx");
if (!marketChart.includes("attributionLogo: true") || !marketChart.includes("TradingView Lightweight Charts™") || !marketChart.includes('href="https://www.tradingview.com/"')) {
  failures.push("Lightweight Charts attribution notice and link must remain visible");
}

const marketInsights = await source("lib/server/naver-market-insights.ts");
if (!marketInsights.includes('buildNaverPath("/api/stockSecurity/etfs/v2/foreign"') || !marketInsights.includes('sortType: "tradingValue"') || !marketInsights.includes('sortDirection: "desc"')) {
  failures.push("foreign ETF list must use the verified Naver v2 ETF contract");
}
if (!marketInsights.includes('case "foreign-etf-components"') || !marketInsights.includes('const code = await resolveForeignCode(params.symbol ?? params.code, params.exchange);') || marketInsights.includes("foreignEtfTicker")) {
  failures.push("foreign ETF composition must resolve and preserve the verified Naver Reuters code");
}
const marketInsightsRoute = await source("app/api/market-insights/route.ts");
if (!marketInsightsRoute.includes("const EXCHANGE") || !marketInsightsRoute.includes("!EXCHANGE.test(exchange)")) {
  failures.push("market insight exchange identifiers must remain bounded and validated");
}

const pendingOrders = await source("lib/server/pending-orders.ts");
const executableChecks = pendingOrders.match(/isExecutableTradingQuote\(quote\)/g)?.length ?? 0;
if (executableChecks < 2) {
  failures.push("pending orders must recheck executable quote freshness after market-status resolution");
}
if (!pendingOrders.includes("quote.venue !== session.exchange")) {
  failures.push("pending KR orders must reject a quote from the wrong active venue");
}
if (!pendingOrders.includes("UPDATE instruments SET exchange=?") || !pendingOrders.includes('quote.market === "KR" && quote.venue')) {
  failures.push("successful pending KR fills must persist the active instrument venue");
}

const leaderboard = await source("app/api/leaderboard/route.ts");
if (!leaderboard.includes("Promise.allSettled(stale.results.map") || !leaderboard.includes("refreshLeaderboardQuote")) {
  failures.push("leaderboard stale quote refreshes should stay parallel while preserving per-instrument claims");
}

if (failures.length) {
  console.error("Naver migration validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Naver migration validation passed (${files.length} executable source files checked).`);
}
