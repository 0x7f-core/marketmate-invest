"use client";

import { useEffect } from "react";

type CompetitionInvite = {
  id: string;
  name: string;
  inviteCode: string;
};

function replaceTextNode(element: Element | null, from: string, to: string) {
  if (!element) return;
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue?.includes(from)) continue;
    const next = node.nodeValue.replaceAll(from, to);
    if (next !== node.nodeValue) node.nodeValue = next;
  }
}

async function copyInviteCode(code: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = code;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function patchCompetitionInviteCode(competitions: CompetitionInvite[]) {
  const overview = document.querySelector<HTMLElement>(".contest-overview");
  if (!overview) return;

  const host = overview.firstElementChild as HTMLElement | null;
  if (!host) return;

  const selector = overview.querySelector("select");
  const selectedId = selector instanceof HTMLSelectElement ? selector.value : "";
  const title = overview.querySelector("h1")?.textContent?.trim() ?? "";
  const competition = (selectedId ? competitions.find(item => item.id === selectedId) : undefined)
    ?? competitions.find(item => item.name === title);

  const existingRow = host.querySelector(".competition-invite-code");
  let row: HTMLElement | null = existingRow instanceof HTMLElement ? existingRow : null;
  if (!competition?.inviteCode) {
    row?.remove();
    return;
  }

  if (!row) {
    row = document.createElement("p");
    row.className = "competition-invite-code";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    host.appendChild(row);
  }

  const existingValue = row.querySelector(".competition-invite-code-value");
  let value: HTMLElement | null = existingValue instanceof HTMLElement ? existingValue : null;
  if (!value) {
    value = document.createElement("span");
    value.className = "competition-invite-code-value";
    row.appendChild(value);
  }
  const nextValue = `참가 코드 ${competition.inviteCode}`;
  if (value.textContent !== nextValue) value.textContent = nextValue;

  const existingCopyButton = row.querySelector(".competition-invite-copy");
  let copyButton: HTMLButtonElement | null = existingCopyButton instanceof HTMLButtonElement ? existingCopyButton : null;
  if (!copyButton) {
    copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "competition-invite-copy";
    copyButton.textContent = "복사";
    copyButton.style.border = "1px solid #dfe3e6";
    copyButton.style.background = "#fff";
    copyButton.style.borderRadius = "6px";
    copyButton.style.padding = "4px 8px";
    copyButton.style.fontSize = "12px";
    copyButton.style.color = "#59636c";
    row.appendChild(copyButton);
  }

  const activeCopyButton = copyButton;
  if (activeCopyButton.dataset.inviteCode === competition.inviteCode && activeCopyButton.onclick) return;
  activeCopyButton.dataset.inviteCode = competition.inviteCode;
  activeCopyButton.onclick = async () => {
    const code = activeCopyButton.dataset.inviteCode ?? "";
    if (!code) return;
    try {
      await copyInviteCode(code);
      activeCopyButton.textContent = "복사됨";
      window.setTimeout(() => {
        activeCopyButton.textContent = "복사";
      }, 1200);
    } catch {
      activeCopyButton.textContent = "복사 실패";
      window.setTimeout(() => {
        activeCopyButton.textContent = "복사";
      }, 1200);
    }
  };
}

function patchCompetitionTradingGuide() {
  const guide = document.querySelector(".trading-guide");
  if (!guide) return;

  const descriptions = guide.querySelectorAll("dd");
  const tradingHours = [
    "평일 NXT 프리마켓 08:00~08:50 · 08:50~09:00 동시호가 주문 불가 · 09:00~15:20 주문 가능 · 15:20~15:30 동시호가 주문 불가 · NXT 애프터마켓 15:30~20:00 (KST)",
    "서머타임 17:00~08:50 · 표준시 18:00~09:50 (KST, 프리·정규·애프터 포함)",
    "UPBIT 시세 기준 24시간 365일 주문 가능",
  ];
  descriptions.forEach((element, index) => {
    const next = tradingHours[index];
    if (next && element.textContent !== next) element.textContent = next;
  });

  const notices = [
    "모든 주문은 모의체결이며 실제 증권계좌나 거래소로 전송되지 않습니다.",
    "국내·미국주식은 네이버증권 장 상태가 거래 가능으로 확인될 때만 주문할 수 있으며, 휴장·시세 지연·장 상태 확인 실패 시 주문이 차단됩니다.",
    "시장가는 주문 시점의 최신 유효 시세로 체결되며, 지정가는 조건을 충족하면 체결되고 충족하지 않으면 미체결 주문으로 남습니다.",
    "미체결 지정가 매수는 주문 가능 현금을, 지정가 매도는 보유수량을 예약하며 체결 전에는 취소할 수 있습니다.",
    "미국주식은 주문 시점의 원/달러 환율을 적용해 원화로 계산되며 시세·환율 변동에 따라 체결금액과 평가금액이 달라질 수 있습니다.",
    "현재 모의체결 수수료는 0원이며, 대회 기간이 끝나면 신규 주문과 대기 주문 체결이 제한됩니다.",
    "대회에서 나가면 해당 대회의 보유자산·주문·체결 등 투자 기록이 삭제됩니다.",
  ];
  const list = guide.querySelector("ul");
  if (!list) return;
  while (list.children.length < notices.length) {
    const item = document.createElement("li");
    item.textContent = notices[list.children.length];
    list.appendChild(item);
  }
  while (list.children.length > notices.length) list.lastElementChild?.remove();
  Array.from(list.children).forEach((element, index) => {
    const next = notices[index];
    if (next && element.textContent !== next) element.textContent = next;
  });
}

function patchCryptoSourceLabels() {
  document.querySelectorAll('select[aria-label="보유종목 정렬 기준"] option').forEach(option => {
    if (option instanceof HTMLOptionElement && option.textContent === "종목 이름") option.textContent = "종목명";
  });

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
      if (value.includes("UPBIT 최신 시세")) element.textContent = value.replaceAll("UPBIT 최신 시세", "네이버증권 최신 시세");
    });
    return;
  }

  if (quoteMeta?.textContent?.includes(" · NAVER")) {
    quoteMeta.textContent = quoteMeta.textContent.replace(/\s·\sNAVER\b/, " · UPBIT");
  }
  replaceTextNode(livePill, "네이버 실시간", "UPBIT 실시간");
  document.querySelectorAll(".order-status").forEach(element => {
    const value = element.textContent ?? "";
    if (value.includes("네이버증권 최신 시세")) element.textContent = value.replaceAll("네이버증권 최신 시세", "UPBIT 최신 시세");
  });
}

export default function CryptoSourceLabels() {
  useEffect(() => {
    let active = true;
    let competitions: CompetitionInvite[] = [];
    let competitionTimer: ReturnType<typeof setTimeout> | undefined;
    let competitionLoading = false;
    let lastCompetitionLoadAt = 0;
    let scheduled = false;

    const schedulePatch = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patchCryptoSourceLabels();
        patchCompetitionInviteCode(competitions);
        patchCompetitionTradingGuide();
      });
    };

    const loadCompetitionInvites = async (force = false) => {
      if (!active || !document.querySelector(".contest-overview") || competitionLoading) return;
      if (!force && competitions.length && Date.now() - lastCompetitionLoadAt < 60_000) {
        schedulePatch();
        return;
      }

      competitionLoading = true;
      try {
        const response = await fetch("/api/competitions", { cache: "no-store" });
        const data = response.ok ? await response.json() as { competitions?: CompetitionInvite[] } : null;
        if (!active) return;
        competitions = data?.competitions ?? [];
        lastCompetitionLoadAt = Date.now();
        schedulePatch();
      } catch {
        // Keep the last known invite codes if the request temporarily fails.
      } finally {
        competitionLoading = false;
        if (competitionTimer) clearTimeout(competitionTimer);
        if (active && document.querySelector(".contest-overview")) {
          competitionTimer = setTimeout(() => void loadCompetitionInvites(true), 60_000);
        }
      }
    };

    const sync = () => {
      schedulePatch();
      if (document.querySelector(".contest-overview")) void loadCompetitionInvites();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
      if (competitionTimer) clearTimeout(competitionTimer);
    };
  }, []);

  return null;
}
