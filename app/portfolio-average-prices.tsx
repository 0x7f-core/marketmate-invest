"use client";

import { useEffect } from "react";

const US_EXCHANGE_PATTERN = /\b(?:NAS|NYS|AMS|NASDAQ|NYSE|AMEX|USA)\b/i;
const USD_KRW_CACHE_KEY = "marketmate:usdkrw:last";
const FAST_PRICE_EVENT = "marketmate:fast-price-data";
let cachedUsdKrw = 0;
let usdKrwRequest: Promise<void> | null = null;

function parseKrw(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rememberUsdKrw(value: number) {
  if (!Number.isFinite(value) || value <= 0) return;
  cachedUsdKrw = value;
  try {
    window.localStorage.setItem(USD_KRW_CACHE_KEY, String(value));
  } catch {
    // localStorage can be unavailable in restricted browser modes.
  }
}

function readStoredUsdKrw() {
  try {
    const value = Number(window.localStorage.getItem(USD_KRW_CACHE_KEY) ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function readUsdKrw() {
  const node = document.querySelector<HTMLElement>("[data-market-strip-usdkrw-price]");
  const liveValue = node ? parseKrw(node.textContent ?? "") : 0;
  if (liveValue) {
    rememberUsdKrw(liveValue);
    return liveValue;
  }
  if (cachedUsdKrw) return cachedUsdKrw;
  const storedValue = readStoredUsdKrw();
  if (storedValue) cachedUsdKrw = storedValue;
  return storedValue;
}

function warmUsdKrw() {
  if (readUsdKrw()) return Promise.resolve();
  if (usdKrwRequest) return usdKrwRequest;
  usdKrwRequest = fetch("/api/market-overview", { cache: "no-store" })
    .then(async response => {
      if (!response.ok) return;
      const payload = await response.json() as { quotes?: Array<{ id?: string; price?: number }> };
      const quote = payload.quotes?.find(item => item.id === "USDKRW");
      rememberUsdKrw(Number(quote?.price ?? 0));
    })
    .catch(() => undefined)
    .finally(() => {
      usdKrwRequest = null;
    });
  return usdKrwRequest;
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setText(node: HTMLElement | null, value: string) {
  if (node && node.textContent !== value) node.textContent = value;
}

function enhanceDesktopAverage(cell: HTMLTableCellElement, averageKrw: number, usdKrw: number) {
  if (!usdKrw) return;
  let display = cell.querySelector<HTMLElement>("[data-position-average-display]");
  if (!display) {
    display = document.createElement("span");
    display.dataset.positionAverageDisplay = "1";
    display.style.display = "inline-flex";
    display.style.flexDirection = "column";
    display.style.alignItems = "flex-start";
    display.style.gap = "2px";
    display.style.lineHeight = "1.2";

    const main = document.createElement("strong");
    main.dataset.positionAverageMain = "1";
    main.style.fontSize = "12px";
    main.style.fontWeight = "400";
    main.style.color = "#171c22";

    const sub = document.createElement("small");
    sub.dataset.positionAverageSub = "1";
    sub.style.fontSize = "10px";
    sub.style.fontWeight = "500";
    sub.style.color = "#8a949e";

    display.appendChild(main);
    display.appendChild(sub);
    cell.replaceChildren(display);
  }

  setText(display.querySelector<HTMLElement>("[data-position-average-main]"), formatUsd(averageKrw / usdKrw));
  setText(display.querySelector<HTMLElement>("[data-position-average-sub]"), formatKrw(averageKrw));
}

function enhanceMobileAverage(target: HTMLElement, averageKrw: number, isUs: boolean, usdKrw: number) {
  let line = target.querySelector<HTMLElement>("[data-mobile-position-average]");
  if (!line) {
    line = document.createElement("span");
    line.dataset.mobilePositionAverage = "1";
    line.style.display = "flex";
    line.style.alignItems = "baseline";
    line.style.gap = "4px";
    line.style.marginTop = "3px";
    line.style.fontSize = "10px";
    line.style.lineHeight = "1.25";
    line.style.color = "#8a949e";

    const label = document.createElement("span");
    label.textContent = "평균단가";

    const main = document.createElement("strong");
    main.dataset.mobilePositionAverageMain = "1";
    main.style.fontSize = "11px";
    main.style.fontWeight = "700";
    main.style.color = "#59636c";

    const sub = document.createElement("small");
    sub.dataset.mobilePositionAverageSub = "1";
    sub.style.fontSize = "9px";
    sub.style.fontWeight = "500";
    sub.style.color = "#9aa2aa";

    line.appendChild(label);
    line.appendChild(main);
    line.appendChild(sub);
    target.appendChild(line);
  }

  const main = line.querySelector<HTMLElement>("[data-mobile-position-average-main]");
  const sub = line.querySelector<HTMLElement>("[data-mobile-position-average-sub]");
  if (isUs && usdKrw) {
    setText(main, formatUsd(averageKrw / usdKrw));
    setText(sub, formatKrw(averageKrw));
    if (sub) sub.style.display = "inline";
  } else {
    setText(main, formatKrw(averageKrw));
    setText(sub, "");
    if (sub) sub.style.display = "none";
  }
}

function installAveragePrices() {
  const holdings = document.querySelector<HTMLElement>(".np-panel.holdings");
  if (!holdings) return;

  const desktopRows = Array.from(holdings.querySelectorAll<HTMLTableRowElement>(".desktop-position-table tbody tr"));
  const mobileRows = Array.from(holdings.querySelectorAll<HTMLButtonElement>(".mobile-position-list > button"));
  const usdKrw = readUsdKrw();

  desktopRows.forEach((row, index) => {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    if (cells.length < 5) return;

    const averageCell = cells[2];
    let averageKrw = Number(averageCell.dataset.averageKrw || 0);
    if (!averageKrw) {
      averageKrw = parseKrw(averageCell.textContent ?? "");
      if (!averageKrw) return;
      averageCell.dataset.averageKrw = String(averageKrw);
    }

    const meta = cells[0].querySelector("small")?.textContent ?? "";
    const isUs = US_EXCHANGE_PATTERN.test(meta);
    if (isUs) enhanceDesktopAverage(averageCell, averageKrw, usdKrw);

    const mobileRow = mobileRows[index];
    if (!mobileRow) return;
    const stockCell = mobileRow.querySelector<HTMLElement>(".stock-cell");
    if (!stockCell) return;
    const info = Array.from(stockCell.children).find(child => child instanceof HTMLElement && !child.classList.contains("instrument-logo"));
    if (info instanceof HTMLElement) enhanceMobileAverage(info, averageKrw, isUs, usdKrw);
  });
}

export default function PortfolioAveragePrices() {
  useEffect(() => {
    cachedUsdKrw = readStoredUsdKrw();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        installAveragePrices();
      });
    };

    const onFastPriceData = (event: Event) => {
      const detail = (event as CustomEvent<{ pathname?: string; usdKrw?: number }>).detail;
      const rate = Number(detail?.usdKrw ?? 0);
      if (detail?.pathname === "/api/market-overview" && rate > 0) rememberUsdKrw(rate);
      schedule();
    };

    schedule();
    if (!cachedUsdKrw) void warmUsdKrw().then(schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener(FAST_PRICE_EVENT, onFastPriceData);
    return () => {
      observer.disconnect();
      window.removeEventListener(FAST_PRICE_EVENT, onFastPriceData);
    };
  }, []);

  return null;
}
