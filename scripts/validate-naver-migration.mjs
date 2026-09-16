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

const marketHours = await source("lib/server/market-hours.ts");
const krxPriority = marketHours.indexOf('item.exchange === "krx" && item.tradable');
const nxtPriority = marketHours.indexOf('item.exchange === "nxt" && item.tradable');
if (krxPriority < 0 || nxtPriority < 0 || krxPriority > nxtPriority) {
  failures.push("KR trading-session priority must prefer KRX before NXT");
}
if (!marketHours.includes('if (type.includes("closing")) return false;')) {
  failures.push("closing sessions must remain non-tradable");
}
if (!marketHours.includes('if (market === "US") return true;')) {
  failures.push("US open sessions, including after-market, must remain tradable");
}
if (!marketHours.includes('"marketStatusDetailType"')) {
  failures.push("market session parsing must support marketStatusDetailType fallback");
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

for (const path of [
  "app/api/orders/route.ts",
  "app/api/quotes/route.ts",
  "app/api/watchlist/route.ts",
  "app/api/leaderboard/route.ts",
]) {
  const text = await source(path);
  if (!text.includes("getTradingQuote")) failures.push(`getTradingQuote wiring is missing: ${path}`);
  if (/\bgetLiveQuote\b/.test(text)) failures.push(`direct getLiveQuote bypass is forbidden: ${path}`);
}

const orders = await source("app/api/orders/route.ts");
if (!orders.includes("isExecutableTradingQuote")) {
  failures.push("new orders must validate executable Naver quote freshness");
}

const pendingOrders = await source("lib/server/pending-orders.ts");
if (!pendingOrders.includes("isExecutableTradingQuote")) {
  failures.push("pending orders must validate executable Naver quote freshness");
}
if (!pendingOrders.includes("quote.venue !== session.exchange")) {
  failures.push("pending KR orders must reject a quote from the wrong active venue");
}

if (failures.length) {
  console.error("Naver migration validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Naver migration validation passed (${files.length} executable source files checked).`);
}
