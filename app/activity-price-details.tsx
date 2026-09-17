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

const USD_KRW_CACHE_KEY = "marketmate:usdkrw:last";
const responseCache = new Map<string, { expiresAt: number; promise: Promise<unknown | null> }>();
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

async function warmUsdKrw() {
  if (usdKrw > 0) return usdKrw;
  usdKrw = readStoredUsdKrw();
  if (usdKrw > 0) return usdKrw;
  try {
    const response = await fetch("/api/market-overview", { cache: "no-store" });
    if (!response.ok) return 0;
    const payload = await response.json() as { quotes?: Array<{ id?: string; price?: number }> };
    const rate = Number(payload.quotes?.find(item => item.id === "USDKRW")?.price ?? 0);
    if (Number.isFinite(rate) && rate > 0) usdKrw = rate;
  } catch {
    // Price details can still render in KRW when the FX warm-up fails.
  }
  return usdKrw;
}

function latestApiUrl(pathname: string) {
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
  responseCache.set(url, { expiresAt: now + 1_000, promise });
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

    const schedulePatch = () => {
      if (!active || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        void Promise.all([patchMyFillPrices(), patchParticipantPrices()]);
      });
    };

    usdKrw = readStoredUsdKrw();
    void warmUsdKrw().then(schedulePatch);
    schedulePatch();

    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const interval = window.setInterval(schedulePatch, 15_000);

    return () => {
      active = false;
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
