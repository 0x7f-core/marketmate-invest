"use client";

import { useEffect } from "react";

const FEE_TEXT = "거래 수수료는 국내주식 KRX 0.015% · NXT 0.0145%, 미국주식 0.07%, 가상자산 0.05%가 매수·매도 시 적용됩니다.";
const TAX_TEXT = "국내 일반주식은 매도 시 거래세 0.20%가 추가 적용되며 ETF·ETN·ELW는 거래세가 없습니다.";
const END_TEXT = "대회 기간이 끝나면 신규 주문과 대기 주문 체결이 제한됩니다.";

function findGuideList() {
  const direct = document.querySelector<HTMLUListElement>(".trading-guide ul");
  if (direct) return direct;

  const heading = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3"))
    .find(node => node.textContent?.replace(/\s+/g, "").includes("거래시간·유의사항"));
  if (!heading) return null;
  const section = heading.closest("section") ?? heading.parentElement;
  return section?.querySelector<HTMLUListElement>("ul") ?? null;
}

function makeItem(text: string, marker: string) {
  const item = document.createElement("li");
  item.dataset[marker] = "1";
  item.textContent = text;
  return item;
}

function patchTradingFeeGuide() {
  const list = findGuideList();
  if (!list) return;

  const items = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
  const legacyFee = items.find(item => /수수료는\s*0원/.test(item.textContent ?? ""));
  const feeItem = list.querySelector<HTMLLIElement>("[data-trading-fee]")
    ?? items.find(item => (item.textContent ?? "").includes("거래 수수료"));

  let resolvedFee = feeItem;
  if (legacyFee) {
    legacyFee.textContent = FEE_TEXT;
    legacyFee.dataset.tradingFee = "1";
    resolvedFee = legacyFee;
  } else if (resolvedFee) {
    if (resolvedFee.textContent !== FEE_TEXT) resolvedFee.textContent = FEE_TEXT;
    resolvedFee.dataset.tradingFee = "1";
  }

  const refreshed = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
  const endItem = refreshed.find(item => {
    const text = item.textContent ?? "";
    return text.includes("대회 기간이 끝나면") || text.includes("대회 종료 후");
  });

  if (!resolvedFee) {
    resolvedFee = makeItem(FEE_TEXT, "tradingFee");
    if (endItem) list.insertBefore(resolvedFee, endItem);
    else list.appendChild(resolvedFee);
  }

  let taxItem = list.querySelector<HTMLLIElement>("[data-trading-tax]")
    ?? Array.from(list.querySelectorAll<HTMLLIElement>("li")).find(item => (item.textContent ?? "").includes("ETF·ETN·ELW"));
  if (!taxItem) {
    taxItem = makeItem(TAX_TEXT, "tradingTax");
    resolvedFee.insertAdjacentElement("afterend", taxItem);
  } else {
    taxItem.textContent = TAX_TEXT;
    taxItem.dataset.tradingTax = "1";
  }

  const afterPatchItems = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
  const hasCompetitionEndNotice = afterPatchItems.some(item => {
    const text = item.textContent ?? "";
    return text.includes("대회 기간이 끝나면") || text.includes("대회 종료 후");
  });
  if (!hasCompetitionEndNotice) taxItem.insertAdjacentElement("afterend", makeItem(END_TEXT, "competitionEnd"));
}

export default function TradingFeeGuide() {
  useEffect(() => {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patchTradingFeeGuide();
      });
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
