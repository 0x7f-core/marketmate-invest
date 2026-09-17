"use client";

import { useEffect } from "react";

type Market = "KR" | "US" | "CRYPTO";
type Fill = {
  id: string;
  side: "buy" | "sell";
  quantityMicros: number;
  priceMicros: number;
  fxRateMicros: number;
  executedAt: number;
  market: Market;
  symbol: string;
  name: string;
  currency: string;
};
type Position = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  quantityMicros: number;
  averagePriceKrwMicros: number;
  unrealizedPnlKrw?: number;
};
type ParticipantActivity = {
  positions: Position[];
  fills: Fill[];
};
type Portfolio = {
  fills: Fill[];
};
type MarketOverview = {
  quotes?: Array<{ id?: string; price?: number }>;
};

const USD_KRW_CACHE_KEY = "marketmate:usdkrw:last";
const FAST_PRICE_EVENT = "marketmate:fast-price-data";
const responseCache = new Map<string, { expiresAt: number; promise: Promise<unknown | null> }>();
const latestApiUrls = new Map<string, string>();
let usdKrw = 0;

function formatKrw(value: number) {
  return `₩${Math.round(value || 0).toLocaleString("ko-KR")}`;
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatFillPrice(fill: Fill) {
  const price = Number(fill.priceMicros || 0) / 1_000_000;
  if (fill.market === "US" || fill.currency === "USD") {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  }
  return `₩${price.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}`;
}

function formatAveragePrice(position: Position) {
  const averageKrw = Number(position.averagePriceKrwMicros || 0) / 1_000_000;
  if (position.market === "US" && usdKrw > 0) {
    return `${formatUsd(averageKrw / usdKrw)} · ${formatKrw(averageKrw)}`;
  }
  return formatKrw(averageKrw);
}

function readStoredUsdKrw() {
  try {
    const parsed = Number(window.localStorage.getItem(USD_KRW_CACHE_KEY) ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function rememberUsdKrw(value: number) {
  if (!Number.isFinite(value) || value <= 0) return;
  usdKrw = value;
  try {
    window.localStorage.setItem(USD_KRW_CACHE_KEY, String(value));
  } catch {
    // localStorage can be unavailable in restricted browser modes.
  }
}

async function warmUsdKrw() {
  if (usdKrw > 0) return usdKrw;
  usdKrw = readStoredUsdKrw();
  if (usdKrw > 0) return usdKrw;
  try {
    const response = await fetch("/api/market-overview", { cache: "no-store" });
    if (!response.ok) return 0;
    const payload = await response.json() as MarketOverview;
    const rate = Number(payload.quotes?.find(item => item.id === "USDKRW")?.price ?? 0);
    rememberUsdKrw(rate);
  } catch {
    // Price details can still render in KRW when the FX warm-up fails.
  }
  return usdKrw;
}

function requestUrl(input: RequestInfo | URL) {
  try {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    return new URL(input.url, window.location.href);
  } catch {
    return null;
  }
}

function captureJsonResponse(url: URL, response: Response, onReady: () => void) {
  const pathname = url.pathname;
  if (!["/api/portfolio", "/api/participants/activity", "/api/market-overview"].includes(pathname)) return;

  const key = `${pathname}${url.search}`;
  const promise = response.clone().json()
    .then((payload: unknown) => {
      if (pathname === "/api/market-overview") {
        const overview = payload as MarketOverview;
        const rate = Number(overview.quotes?.find(item => item.id === "USDKRW")?.price ?? 0);
        if (rate > 0) rememberUsdKrw(rate);
        window.dispatchEvent(new CustomEvent(FAST_PRICE_EVENT, { detail: { pathname, usdKrw: rate } }));
      } else {
        window.dispatchEvent(new CustomEvent(FAST_PRICE_EVENT, { detail: { pathname } }));
      }
      onReady();
      return payload;
    })
    .catch(() => null);

  latestApiUrls.set(pathname, key);
  responseCache.set(key, { expiresAt: Date.now() + 5_000, promise });
}

function latestApiUrl(pathname: string) {
  const captured = latestApiUrls.get(pathname);
  if (captured) return captured;

  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    try {
      const url = new URL(entries[index].name);
      if (url.pathname === pathname) return `${url.pathname}${url.search}`;
    } catch {
      // Ignore malformed resource timing entries.
    }
  }
  return "";
}

function loadJson<T>(url: string) {
  const now = Date.now();
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > now) return cached.promise as Promise<T | null>;

  const promise = fetch(url, { cache: "no-store" })
    .then(async response => response.ok ? await response.json() as T : null)
    .catch(() => null);
  responseCache.set(url, { expiresAt: now + 2_000, promise });
  return promise;
}

function upsertSmall(container: HTMLElement, key: string, text: string) {
  let node = container.querySelector<HTMLElement>(`small[data-marketmate-price-detail="${key}"]`);
  if (!node) {
    node = document.createElement("small");
    node.dataset.marketmatePriceDetail = key;
    const existingSmall = container.querySelector("small");
    container.insertBefore(node, existingSmall ?? null);
  }
  if (node.textContent !== text) node.textContent = text;
}

async function patchMyFillPrices() {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".trade-history .trade-row"));
  if (!rows.length) return;

  const url = latestApiUrl("/api/portfolio");
  if (!url) return;
  const portfolio = await loadJson<Portfolio>(url);
  if (!portfolio?.fills?.length) return;

  rows.forEach((row, index) => {
    const fill = portfolio.fills[index];
    const right = row.querySelector<HTMLElement>(":scope > span:last-child");
    if (!fill || !right) return;
    upsertSmall(right, "my-fill", `체결단가 ${formatFillPrice(fill)}`);
  });
}

async function patchParticipantPrices() {
  const dialog = document.querySelector<HTMLElement>(".activity-dialog");
  if (!dialog) return;

  const url = latestApiUrl("/api/participants/activity");
  if (!url) return;
  const activity = await loadJson<ParticipantActivity>(url);
  if (!activity) return;

  const rows = Array.from(dialog.querySelectorAll<HTMLElement>(".activity-list > div"));
  let positionIndex = 0;
  let fillIndex = 0;

  rows.forEach(row => {
    const columns = row.querySelectorAll<HTMLElement>(":scope > span");
    if (columns.length < 2) return;
    const leftSmall = columns[0].querySelector("small")?.textContent?.trim() ?? "";
    const rightBold = columns[1].querySelector("b")?.textContent?.trim() ?? "";

    if (/^(KR|US|CRYPTO)\s*·/.test(leftSmall)) {
      const position = activity.positions[positionIndex++];
      if (!position) return;
      upsertSmall(columns[1], "participant-average", `평균단가 ${formatAveragePrice(position)}`);
      return;
    }

    if (/^(매수|매도)/.test(rightBold)) {
      const fill = activity.fills[fillIndex++];
      if (!fill) return;
      upsertSmall(columns[1], "participant-fill", `체결단가 ${formatFillPrice(fill)}`);
    }
  });
}

export default function ActivityPriceDetails() {
  useEffect(() => {
    let scheduled = false;
    let active = true;

    const runPatch = () => {
      if (!active) return;
      void Promise.all([patchMyFillPrices(), patchParticipantPrices()]);
    };

    const schedulePatch = () => {
      if (!active || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        runPatch();
      });
    };

    usdKrw = readStoredUsdKrw();

    const originalFetch = window.fetch.bind(window);
    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = requestUrl(input);
      if (url && response.ok) captureJsonResponse(url, response, schedulePatch);
      return response;
    };
    window.fetch = wrappedFetch;

    schedulePatch();
    if (!usdKrw) void warmUsdKrw().then(schedulePatch);

    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const interval = window.setInterval(schedulePatch, 15_000);
    const onFastData = () => schedulePatch();
    window.addEventListener(FAST_PRICE_EVENT, onFastData);

    return () => {
      active = false;
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener(FAST_PRICE_EVENT, onFastData);
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
