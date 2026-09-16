const BASE = "https://stock.naver.com";
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  referer: "https://stock.naver.com/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function records(value, depth = 0, out = []) {
  if (depth > 6 || out.length > 500 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) records(item, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  out.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") records(child, depth + 1, out);
  }
  return out;
}

function arrays(value, depth = 0, out = []) {
  if (depth > 6 || out.length > 200 || value == null) return out;
  if (Array.isArray(value)) {
    out.push(value);
    for (const item of value) arrays(item, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const child of Object.values(value)) arrays(child, depth + 1, out);
  return out;
}

function hasRows(value) {
  return arrays(value).some(list => list.length > 0);
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[,%원$]/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function hasPositivePrice(value) {
  const keys = ["closePrice", "currentPrice", "nowPrice", "tradePrice", "price", "lastPrice", "last", "value"];
  return records(value).some(row => keys.some(key => numberValue(row[key]) > 0));
}

function pollingInterval(value) {
  const wrappers = [value, value?.data, value?.result, value?.body, value?.payload];
  for (const item of wrappers) {
    const interval = numberValue(item?.pollingInterval);
    if (interval > 0) return interval;
  }
  return 0;
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    const status = response.status;
    const contentType = response.headers.get("content-type") ?? "";
    if (status === 403 || status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`NAVER_BLOCKED status=${status}${retryAfter ? ` retry-after=${retryAfter}` : ""}`);
    }
    if (!response.ok) throw new Error(`HTTP_${status}`);
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
    const text = new TextDecoder().decode(merged);
    return { data: JSON.parse(text), size, status };
  } finally {
    clearTimeout(timer);
  }
}

function marketStatusCheck(data) {
  const candidates = [data, data?.data, data?.result, data?.body, data?.payload];
  const statuses = candidates.find(value => Array.isArray(value?.statuses))?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) throw new Error("statuses[] missing");
}

function pollingCheck(data) {
  const datas = [data, data?.data, data?.result, data?.body, data?.payload]
    .map(value => value?.datas)
    .find(Array.isArray);
  if (!Array.isArray(datas) || datas.length === 0) throw new Error("datas[] missing");
  if (!hasPositivePrice(datas)) throw new Error("positive quote missing");
  const interval = pollingInterval(data);
  if (!(interval >= 500 && interval <= 300_000)) throw new Error(`invalid pollingInterval=${interval}`);
}

function nonEmptyCheck(data) {
  if (!hasRows(data) && !(data && typeof data === "object" && Object.keys(data).length > 0)) {
    throw new Error("empty payload");
  }
}

function fxCheck(data) {
  nonEmptyCheck(data);
  const usdKrw = records(data).find(row => [row.itemCode, row.code, row.symbol].some(value => String(value ?? "") === "FX_USDKRW"));
  const target = usdKrw ?? records(data).find(row => hasPositivePrice(row));
  if (!target || !hasPositivePrice(target)) throw new Error("FX_USDKRW positive value missing");
}

function autocompleteDiagnostic(label) {
  return data => {
    nonEmptyCheck(data);
    const sample = JSON.stringify(data).slice(0, 5000);
    console.log(`AUTOCOMPLETE_SAMPLE ${label}: ${sample}`);
  };
}

const toMs = Date.now();
const fromMs = toMs - 8 * 86_400_000;
const kstLocalIso = value => new Date(value + 9 * 60 * 60_000).toISOString().slice(0, 19);

const tests = [
  {
    name: "market-status KRX/NXT",
    path: "/api/stockSecurity/market-status/current?exchanges=krx&exchanges=nxt",
    check: marketStatusCheck,
    required: true,
  },
  {
    name: "domestic polling 005930",
    path: "/api/polling/domestic/stock?itemCodes=005930",
    check: pollingCheck,
    required: true,
  },
  {
    name: "US polling AAPL.O",
    path: "/api/polling/worldstock/stock?reutersCodes=AAPL.O",
    check: pollingCheck,
    required: true,
  },
  {
    name: "crypto polling BTC",
    path: "/api/polling/coin/price?fqnfTickers=BTC_KRW_UPBIT",
    check: pollingCheck,
    required: true,
  },
  {
    name: "USD/KRW indicator",
    path: "/api/securityService/integration/indicators?indicatorCodes=FX_USDKRW",
    check: fxCheck,
    required: true,
  },
  {
    name: "domestic daily chart",
    path: "/api/securityService/chart/domestic/item/005930?periodType=day",
    check: nonEmptyCheck,
    required: true,
  },
  {
    name: "US daily chart",
    path: "/api/securityService/stock/AAPL.O/price?page=1&pageSize=30",
    check: nonEmptyCheck,
    required: true,
  },
  {
    name: "crypto daily chart",
    path: `/api/coin/candle/UPBIT/KRW/BTC/days?from=${encodeURIComponent(kstLocalIso(fromMs))}&to=${encodeURIComponent(kstLocalIso(toMs))}`,
    check: nonEmptyCheck,
    required: true,
  },
  {
    name: "autocomplete AAPL",
    path: "/api/autocomplete/search/autoComplete?query=AAPL&target=stock",
    check: nonEmptyCheck,
    required: false,
  },
  {
    name: "autocomplete Samsung name diagnostic",
    path: `/api/autocomplete/search/autoComplete?query=${encodeURIComponent("삼성전자")}&target=stock`,
    check: autocompleteDiagnostic("삼성전자"),
    required: false,
  },
  {
    name: "autocomplete Samsung code diagnostic",
    path: "/api/autocomplete/search/autoComplete?query=005930&target=stock",
    check: autocompleteDiagnostic("005930"),
    required: false,
  },
  {
    name: "domestic investor trend",
    path: "/api/domestic/detail/005930/trend?tradeType=KRX&startIdx=0&pageSize=5",
    check: nonEmptyCheck,
    required: false,
  },
  {
    name: "domestic ETF v2",
    path: "/api/stockSecurity/etfs/v2/domestic?listingType=tradingValueDesc&size=5&index=0",
    check: nonEmptyCheck,
    required: false,
  },
];

let requiredFailures = 0;
let blocked = 0;
const report = [];

for (const test of tests) {
  const started = Date.now();
  try {
    const { data, size, status } = await fetchJson(test.path);
    test.check(data);
    const elapsed = Date.now() - started;
    report.push({ name: test.name, required: test.required, ok: true, status, bytes: size, ms: elapsed });
    console.log(`PASS ${test.name} (${status}, ${size} bytes, ${elapsed}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("NAVER_BLOCKED")) blocked += 1;
    if (test.required) requiredFailures += 1;
    report.push({ name: test.name, required: test.required, ok: false, error: message, ms: Date.now() - started });
    console.error(`${test.required ? "FAIL" : "WARN"} ${test.name}: ${message}`);
  }
  await sleep(350);
}

console.log("\nRuntime smoke summary");
console.table(report);

if (blocked > 0) {
  console.error(`Naver returned 403/429 for ${blocked} request(s). This may be an egress/IP policy issue.`);
}
if (requiredFailures > 0) {
  console.error(`${requiredFailures} required Naver runtime smoke test(s) failed.`);
  process.exit(1);
}

console.log("All required Naver runtime smoke tests passed.");
