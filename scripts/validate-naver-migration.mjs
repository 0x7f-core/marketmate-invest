import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EXECUTABLE_ROOTS = ["app", "lib", "db"];
const REQUIRED_FILES = [
  "lib/server/naver-stock.ts",
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

const marketHours = await readFile(join(ROOT, "lib/server/market-hours.ts"), "utf8");
const krxPriority = marketHours.indexOf('item.exchange === "krx" && item.tradable');
const nxtPriority = marketHours.indexOf('item.exchange === "nxt" && item.tradable');
if (krxPriority < 0 || nxtPriority < 0 || krxPriority > nxtPriority) {
  failures.push("KR trading-session priority must prefer KRX before NXT");
}
if (!marketHours.includes('if (type.includes("closing")) return false;')) {
  failures.push("closing sessions must remain non-tradable");
}
if (!marketHours.includes('"marketStatusDetailType"')) {
  failures.push("market session parsing must support marketStatusDetailType fallback");
}

const tradingQuote = await readFile(join(ROOT, "lib/server/trading-quote.ts"), "utf8");
if (!tradingQuote.includes('session.exchange === "NXT"')) {
  failures.push("NXT quote selection guard is missing");
}
if (!tradingQuote.includes("isExecutableTradingQuote")) {
  failures.push("executable quote freshness guard is missing");
}

if (failures.length) {
  console.error("Naver migration validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Naver migration validation passed (${files.length} executable source files checked).`);
}
