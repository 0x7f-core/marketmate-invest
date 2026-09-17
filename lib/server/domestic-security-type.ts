import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import type { DomesticSecurityType } from "@/lib/trading-costs";

export type DomesticSecurityClassification = {
  type: DomesticSecurityType;
  source: "NAVER" | "KRX" | "NAVER_KRX" | "FALLBACK";
};

type ProductSnapshot = {
  codes: Set<string>;
  available: boolean;
};

type NaverProductSnapshot = {
  etf: ProductSnapshot;
  etn: ProductSnapshot;
  expiresAt: number;
};

type KrxCacheEntry = ProductSnapshot & { expiresAt: number };

type KrxProduct = "ETF" | "ETN" | "ELW";

const NAVER_CACHE_MS = 30 * 60_000;
const KRX_CACHE_MS = 6 * 60 * 60_000;
const KRX_ENDPOINT = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KRX_MASTER_BLD: Record<KrxProduct, string> = {
  ETF: "dbms/MDC/STAT/standard/MDCSTAT04601",
  ETN: "dbms/MDC/STAT/standard/MDCSTAT06701",
  ELW: "dbms/MDC/STAT/standard/MDCSTAT08501",
};

let naverCache: NaverProductSnapshot | null = null;
let naverInflight: Promise<NaverProductSnapshot> | null = null;
const krxCache = new Map<KrxProduct, KrxCacheEntry>();
const krxInflight = new Map<KrxProduct, Promise<KrxCacheEntry>>();

function normalizeDomesticCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const code = String(value).trim().replace(/^A(?=\d{6}$)/i, "");
  return /^\d{6}$/.test(code) ? code : "";
}

function collectDomesticCodes(value: unknown, depth = 0, output = new Set<string>()) {
  if (depth > 7 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectDomesticCodes(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;

  const record = value as Record<string, unknown>;
  for (const key of ["itemCode", "itemcode", "stockCode", "symbolCode", "shortCode", "code", "ISU_SRT_CD"]) {
    const code = normalizeDomesticCode(record[key]);
    if (code) output.add(code);
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectDomesticCodes(child, depth + 1, output);
  }
  return output;
}

async function loadNaverProducts() {
  const now = Date.now();
  if (naverCache && naverCache.expiresAt > now) return naverCache;
  if (naverInflight) return naverInflight;

  naverInflight = (async () => {
    const [etfResult, etnResult] = await Promise.allSettled([
      naverJson<unknown>(
        buildNaverPath("/api/stockSecurity/etfs/v2/domestic", {
          listingType: "tradingValueDesc",
          size: 2_000,
          index: 0,
        }),
        { ttlMs: NAVER_CACHE_MS, staleMs: 6 * 60 * 60_000, timeoutMs: 8_000 },
      ),
      naverJson<unknown>(
        buildNaverPath("/api/domestic/market/etn", {
          orderType: "AMOUNT_ETN",
          startIdx: 0,
          pageSize: 2_000,
        }),
        { ttlMs: NAVER_CACHE_MS, staleMs: 6 * 60 * 60_000, timeoutMs: 8_000 },
      ),
    ]);

    const snapshot: NaverProductSnapshot = {
      etf: {
        codes: etfResult.status === "fulfilled" ? collectDomesticCodes(etfResult.value.data) : new Set<string>(),
        available: etfResult.status === "fulfilled",
      },
      etn: {
        codes: etnResult.status === "fulfilled" ? collectDomesticCodes(etnResult.value.data) : new Set<string>(),
        available: etnResult.status === "fulfilled",
      },
      expiresAt: Date.now() + NAVER_CACHE_MS,
    };
    naverCache = snapshot;
    return snapshot;
  })().finally(() => {
    naverInflight = null;
  });

  return naverInflight;
}

async function loadKrxProduct(product: KrxProduct): Promise<KrxCacheEntry> {
  const now = Date.now();
  const cached = krxCache.get(product);
  if (cached && cached.expiresAt > now) return cached;
  const pending = krxInflight.get(product);
  if (pending) return pending;

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(KRX_ENDPOINT, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          origin: "https://data.krx.co.kr",
          referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
          "user-agent": "Mozilla/5.0 MarketMate/2.0 (+public-read-only)",
        },
        body: new URLSearchParams({
          bld: KRX_MASTER_BLD[product],
          locale: "ko_KR",
        }),
      });
      if (!response.ok || (response.status >= 300 && response.status < 400)) throw new Error("KRX_PRODUCT_LOOKUP_FAILED");
      const payload = await response.json() as unknown;
      const entry: KrxCacheEntry = {
        codes: collectDomesticCodes(payload),
        available: true,
        expiresAt: Date.now() + KRX_CACHE_MS,
      };
      krxCache.set(product, entry);
      return entry;
    } catch {
      const fallback: KrxCacheEntry = {
        codes: cached?.codes ?? new Set<string>(),
        available: Boolean(cached?.available),
        expiresAt: Date.now() + 5 * 60_000,
      };
      krxCache.set(product, fallback);
      return fallback;
    } finally {
      clearTimeout(timer);
      krxInflight.delete(product);
    }
  })();
  krxInflight.set(product, request);
  return request;
}

export async function getDomesticSecurityClassification(symbol: string): Promise<DomesticSecurityClassification> {
  const code = normalizeDomesticCode(symbol);
  if (!code) return { type: "UNKNOWN", source: "FALLBACK" };

  const naver = await loadNaverProducts();
  if (naver.etf.codes.has(code)) return { type: "ETF", source: "NAVER" };
  if (naver.etn.codes.has(code)) return { type: "ETN", source: "NAVER" };

  // Naver currently exposes dedicated ETF/ETN collections but no equivalent
  // ELW collection in the public read-only surface used by this app. Use KRX's
  // public security-product master only for the missing classification, while
  // keeping KRX behind this adapter so the trading domain is host-agnostic.
  const elw = await loadKrxProduct("ELW");
  if (elw.codes.has(code)) return { type: "ELW", source: "KRX" };

  let etfAvailable = naver.etf.available;
  let etnAvailable = naver.etn.available;
  if (!etfAvailable) {
    const krxEtf = await loadKrxProduct("ETF");
    etfAvailable = krxEtf.available;
    if (krxEtf.codes.has(code)) return { type: "ETF", source: "KRX" };
  }
  if (!etnAvailable) {
    const krxEtn = await loadKrxProduct("ETN");
    etnAvailable = krxEtn.available;
    if (krxEtn.codes.has(code)) return { type: "ETN", source: "KRX" };
  }

  if (etfAvailable && etnAvailable && elw.available) {
    return { type: "STOCK", source: naver.etf.available && naver.etn.available ? "NAVER_KRX" : "KRX" };
  }
  // Conservative fallback: UNKNOWN is taxed like a normal domestic stock so a
  // temporary classification outage can never under-charge securities tax.
  return { type: "UNKNOWN", source: "FALLBACK" };
}
