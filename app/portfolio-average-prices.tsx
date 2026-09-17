"use client";

import { useEffect } from "react";

const US_EXCHANGE_PATTERN = /\b(?:NAS|NYS|AMS|NASDAQ|NYSE|AMEX|USA)\b/i;

function parseKrw(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readUsdKrw() {
  const node = document.querySelector<HTMLElement>("[data-market-strip-usdkrw-price]");
  return node ? parseKrw(node.textContent ?? "") : 0;
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
    main.style.fontSize = "13px";
    main.style.fontWeight = "700";
    main.style.color = "#171c22";

    const sub = document.createElement("small");
    sub.dataset.positionAverageSub = "1";
    sub.style.fontSize = "10px";
    sub.style.fontWeight = "500";
    sub.style.color = "#8a949e";

    display.append(main, sub);
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

    line.append(label, main, sub);
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
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        installAveragePrices();
      });
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
