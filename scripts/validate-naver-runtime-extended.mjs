const BASE = "https://stock.naver.com";
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 5 * 1024 * 1024;

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  referer: "https://stock.naver.com/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasContent(value, depth = 0) {
  if (depth > 6 || value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object") return String(value).trim().length > 0;
  const entries = Object.entries(value);
  if (!entries.length) return false;
  return entries.some(([, child]) => {
    if (child == null) return false;
    if (Array.isArray(child)) return child.length > 0;
    if (typeof child === "object") return hasContent(child, depth + 1);
    return String(child).trim().length > 0;
  });
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, { headers, redirect: "error", signal: controller.signal });
    const status = response.status;
    if (status === 403 || status === 429) {
      throw new Error(`NAVER_BLOCKED status=${status}${response.headers.get("retry-after") ? ` retry-after=${response.headers.get("retry-after")}` : ""}`);
    }
    if (!response.ok) throw new Error(`HTTP_${status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) throw new Error(`NON_JSON ${contentType || "unknown"}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("EMPTY_BODY");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`BODY_TOO_LARGE ${size}`);
      }
      chunks.push(value);
    }
    if (!size) throw new Error("EMPTY_BODY");
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status, size, data: JSON.parse(new TextDecoder().decode(merged)) };
  } finally {
    clearTimeout(timer);
  }
}

const tests = [
  ["domestic detail", "/api/domestic/detail/005930/detail?codeType=KRX", true],
  ["domestic disclosure", "/api/domestic/detail/notice?itemCode=005930&startIdx=0&pageSize=5", true],
  ["domestic consensus", "/api/domestic/detail/005930/consensus", true],
  ["domestic finance menu", "/api/stockSecurity/finances/v1/domestic/005930/menu-info", true],
  ["domestic ESG", "/api/stockSecurity/finances/v1/domestic/005930/esg", false],
  ["domestic ranking themes", "/api/stockSecurity/rankings/v2/domestic/themes?sortType=changeRate&size=5&excludeCodes=25&period=daily", true],
  ["domestic ETF components", "/api/domestic/detail/069500/ETFComponent?startIdx=0&pageSize=5", true],
  ["foreign basic AAPL", "/api/securityService/stock/AAPL.O/basic", true],
  ["foreign overview AAPL", "/api/securityService/stock/AAPL.O/overview", true],
  ["foreign consensus AAPL", "/api/securityService/stock/AAPL.O/consensus", false],
  ["foreign finance summary", "/api/securityService/stock/finance/summary?reutersCode=AAPL.O", true],
  ["foreign ETF list", "/api/stockSecurity/etfs/v2/foreign?sortType=tradingValue&sortDirection=desc&index=0&size=5", true],
  ["foreign ETF components QQQ.O", "/api/stockSecurity/etfs/v2/foreign/QQQ.O/composition", true],
  ["foreign sector ranking", "/api/stockSecurity/rankings/v2/foreign/USA/sectors?sortType=changeRate&size=5&period=daily", true],
  ["crypto ranking", "/api/coin/rank/UPBIT?sortType=marketValue&page=1&pageSize=5", true],
  ["domestic stock news", "/api/domestic/detail/news?itemCode=005930&page=1&pageSize=5", true],
  ["US stock news", "/api/foreign/worldStock/list?reutersCode=AAPL.O&page=1&pageSize=5", true],
  ["crypto global news", "/api/coin/globalNews/BTC?pageSize=5", false],
  ["NASDAQ operating time", "/api/foreign/operatingTime/exchange/NASDAQ", true],
  ["economic calendar", "/api/securityService/economic/indicator/nations/upcoming?gteImportance=3&limit=3&nationTypeList=KOR&nationTypeList=USA", false],
];

let failures = 0;
let blocked = 0;
const report = [];

for (const [name, path, requireContent] of tests) {
  const started = Date.now();
  try {
    const { status, size, data } = await fetchJson(path);
    const content = hasContent(data);
    if (requireContent && !content) throw new Error("EMPTY_PAYLOAD");
    report.push({ name, ok: true, status, bytes: size, content, ms: Date.now() - started });
    console.log(`PASS ${name} (${status}, ${size} bytes${content ? "" : ", empty allowed"})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("NAVER_BLOCKED")) blocked += 1;
    failures += 1;
    report.push({ name, ok: false, error: message, ms: Date.now() - started });
    console.error(`FAIL ${name}: ${message}`);
  }
  await sleep(450);
}

console.log("\nExtended runtime smoke summary");
console.table(report);
if (blocked) console.error(`Naver returned 403/429 for ${blocked} extended request(s).`);
if (failures) {
  console.error(`${failures} extended Naver runtime check(s) failed.`);
  process.exit(1);
}
console.log("All extended Naver runtime checks passed.");
