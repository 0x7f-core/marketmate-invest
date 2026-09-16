"use client";

import { useEffect } from "react";

type FxQuote = {
  id: string;
  price: number;
  rate: number;
  unit: string;
};

type CompetitionInvite = {
  id: string;
  name: string;
  inviteCode: string;
};

function replaceTextNode(element: Element | null, from: string, to: string) {
  if (!element) return;
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue?.includes(from)) continue;
    node.nodeValue = node.nodeValue.replaceAll(from, to);
  }
}

function patchHorizontalFx(fx: FxQuote | null) {
  if (!fx) return;
  document.querySelectorAll(".live-market-strip").forEach(strip => {
    let button = strip.querySelector<HTMLButtonElement>('button[data-market-id="USDKRW"]');
    if (!button) {
      button = document.createElement("button");
      button.dataset.marketId = "USDKRW";
      button.innerHTML = "<span>원/달러 환율<small>네이버증권</small></span><strong></strong><em></em>";
      strip.appendChild(button);
    }
    const price = button.querySelector("strong");
    const rate = button.querySelector("em");
    if (price) price.textContent = `${fx.price.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${fx.unit || "원"}`;
    if (rate) {
      rate.className = fx.rate >= 0 ? "up" : "down";
      rate.textContent = `${fx.rate >= 0 ? "+" : ""}${fx.rate.toFixed(2)}%`;
    }
  });
}

function patchCompetitionInviteCode(competitions: CompetitionInvite[]) {
  const overview = document.querySelector<HTMLElement>(".contest-overview");
  if (!overview) return;

  const host = overview.firstElementChild as HTMLElement | null;
  if (!host) return;

  const selectedId = overview.querySelector<HTMLSelectElement>("select")?.value ?? "";
  const title = overview.querySelector("h1")?.textContent?.trim() ?? "";
  const competition = (selectedId ? competitions.find(item => item.id === selectedId) : undefined)
    ?? competitions.find(item => item.name === title);

  let row = host.querySelector<HTMLElement>(".competition-invite-code");
  if (!competition?.inviteCode) {
    row?.remove();
    return;
  }

  if (!row) {
    row = document.createElement("p");
    row.className = "competition-invite-code";
    host.appendChild(row);
  }

  row.textContent = `참가 코드 ${competition.inviteCode}`;
}

function patchCryptoSourceLabels(fx: FxQuote | null) {
  document.querySelectorAll(".np-market-status span").forEach(element => {
    if (element.textContent?.includes("가상자산 · 네이버증권 24시간 시세")) {
      replaceTextNode(element, "가상자산 · 네이버증권 24시간 시세", "가상자산 · UPBIT 24시간 시세");
    }
  });

  document.querySelectorAll(".live-market-strip button").forEach(button => {
    if (!button.textContent?.includes("비트코인")) return;
    const source = button.querySelector("small");
    if (source?.textContent === "네이버증권") source.textContent = "UPBIT";
  });

  document.querySelectorAll(".index-board button").forEach(button => {
    if (!button.textContent?.includes("비트코인")) return;
    const source = button.querySelector("small");
    if (source?.textContent === "네이버증권 · 실시간") source.textContent = "UPBIT · 실시간";
  });

  document.querySelectorAll(".trading-guide dd").forEach(element => {
    if (element.textContent === "네이버증권 가상자산 시세 기준 24시간 주문 가능") {
      element.textContent = "UPBIT 시세 기준 24시간 주문 가능";
    }
  });

  document.querySelectorAll("small").forEach(element => {
    const value = element.textContent ?? "";
    if (/KRW-[A-Z0-9._-]+\s*·\s*NAVER\b/.test(value)) {
      element.textContent = value.replace(/\bNAVER\b/g, "UPBIT");
    }
  });

  patchHorizontalFx(fx);

  const cryptoActive = Array.from(document.querySelectorAll(".np-market-tabs button")).some(button =>
    button.classList.contains("active") && button.textContent?.trim() === "가상자산",
  );

  const quoteMeta = document.querySelector(".np-quote .stock-title small");
  const livePill = document.querySelector(".np-quote .live-pill");

  if (!cryptoActive) {
    if (quoteMeta?.textContent?.includes(" · UPBIT")) {
      quoteMeta.textContent = quoteMeta.textContent.replace(/\s·\sUPBIT\b/, " · NAVER");
    }
    replaceTextNode(livePill, "UPBIT 실시간", "네이버 실시간");
    document.querySelectorAll(".order-status").forEach(element => {
      const value = element.textContent ?? "";
      if (value.includes("UPBIT 최신 시세")) {
        element.textContent = value.replaceAll("UPBIT 최신 시세", "네이버증권 최신 시세");
      }
    });
    return;
  }

  if (quoteMeta?.textContent?.includes(" · NAVER")) {
    quoteMeta.textContent = quoteMeta.textContent.replace(/\s·\sNAVER\b/, " · UPBIT");
  }

  replaceTextNode(livePill, "네이버 실시간", "UPBIT 실시간");

  document.querySelectorAll(".order-status").forEach(element => {
    const value = element.textContent ?? "";
    if (value.includes("네이버증권 최신 시세")) {
      element.textContent = value.replaceAll("네이버증권 최신 시세", "UPBIT 최신 시세");
    }
  });
}

export default function CryptoSourceLabels() {
  useEffect(() => {
    let active = true;
    let latestFx: FxQuote | null = null;
    let competitions: CompetitionInvite[] = [];
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let competitionTimer: ReturnType<typeof setTimeout> | undefined;
    let scheduled = false;

    const schedulePatch = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patchCryptoSourceLabels(latestFx);
        patchCompetitionInviteCode(competitions);
      });
    };

    const loadFx = async () => {
      try {
        const response = await fetch("/api/market-overview", { cache: "no-store" });
        const data = response.ok ? await response.json() as { quotes?: FxQuote[]; pollingInterval?: number } : null;
        if (!active) return;
        latestFx = data?.quotes?.find(item => item.id === "USDKRW") ?? null;
        schedulePatch();
        pollTimer = setTimeout(loadFx, Math.max(5_000, Math.min(120_000, data?.pollingInterval ?? 10_000)));
      } catch {
        if (active) pollTimer = setTimeout(loadFx, 10_000);
      }
    };

    const loadCompetitionInvites = async () => {
      try {
        const response = await fetch("/api/competitions", { cache: "no-store" });
        const data = response.ok ? await response.json() as { competitions?: CompetitionInvite[] } : null;
        if (!active) return;
        competitions = data?.competitions ?? [];
        schedulePatch();
      } catch {
        // Keep the last known invite codes if the request temporarily fails.
      } finally {
        if (active) competitionTimer = setTimeout(loadCompetitionInvites, 20_000);
      }
    };

    schedulePatch();
    void loadFx();
    void loadCompetitionInvites();
    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      active = false;
      observer.disconnect();
      if (pollTimer) clearTimeout(pollTimer);
      if (competitionTimer) clearTimeout(competitionTimer);
    };
  }, []);

  return null;
}
