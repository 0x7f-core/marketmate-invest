"use client";

import { useEffect } from "react";

type Market = "KR" | "US" | "CRYPTO";

type PortfolioPosition = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
  quantityMicros: number;
};

type PortfolioResponse = {
  positions?: PortfolioPosition[];
  error?: string;
};

type Order = {
  id: string;
  side: "buy" | "sell";
  status: string;
};

type OrdersResponse = {
  orders?: Order[];
  error?: string;
};

const BUTTON_ID = "portfolio-bulk-sell-button";

function participantIdFromUrl(value: string) {
  try {
    const url = new URL(value, window.location.href);
    if (url.pathname !== "/api/portfolio") return null;
    return url.searchParams.get("participantId");
  } catch {
    return null;
  }
}

function findCurrentParticipantId() {
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const participantId = participantIdFromUrl(entries[index]?.name ?? "");
    if (participantId) return participantId;
  }
  return null;
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function refreshPortfolio() {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".holdings .np-section-title button");
  for (const button of buttons) {
    if (button.textContent?.includes("새로고침")) {
      button.click();
      return;
    }
  }
}

async function bulkSell(button: HTMLButtonElement) {
  const participantId = findCurrentParticipantId();
  if (!participantId) {
    window.alert("현재 대회의 투자현황을 확인한 뒤 다시 시도해주세요.");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent ?? "일괄매도";
  button.textContent = "확인 중...";

  try {
    const [portfolioResponse, ordersResponse] = await Promise.all([
      fetch(`/api/portfolio?participantId=${encodeURIComponent(participantId)}`, { cache: "no-store" }),
      fetch(`/api/orders?participantId=${encodeURIComponent(participantId)}`, { cache: "no-store" }),
    ]);
    const portfolio = await readJson<PortfolioResponse>(portfolioResponse);
    const orders = await readJson<OrdersResponse>(ordersResponse);

    if (!portfolioResponse.ok) throw new Error(portfolio.error ?? "투자현황을 불러오지 못했습니다.");
    const positions = (portfolio.positions ?? []).filter(position => Number(position.quantityMicros) > 0);
    if (!positions.length) {
      window.alert("현재 매도할 보유종목이 없습니다.");
      return;
    }

    const confirmed = window.confirm(
      `현재 보유 중인 ${positions.length}개 종목을 모두 시장가로 매도합니다.\n미체결 매도 주문이 있으면 먼저 취소합니다.\n계속할까요?`,
    );
    if (!confirmed) return;

    button.textContent = "매도 중...";

    if (ordersResponse.ok) {
      const pendingSellOrders = (orders.orders ?? []).filter(order => order.side === "sell" && order.status === "pending");
      for (const order of pendingSellOrders) {
        await fetch(`/api/orders?orderId=${encodeURIComponent(order.id)}`, { method: "DELETE" }).catch(() => undefined);
      }
    }

    let successCount = 0;
    const failures: string[] = [];

    for (const position of positions) {
      const quantity = Number(position.quantityMicros) / 1_000_000;
      if (!Number.isFinite(quantity) || quantity <= 0) continue;

      try {
        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            participantId,
            clientOrderId: crypto.randomUUID(),
            market: position.market,
            symbol: position.symbol,
            name: position.name,
            exchange: position.exchange,
            side: "sell",
            orderType: "market",
            quantity,
          }),
        });
        const result = await readJson<{ error?: string }>(response);
        if (response.ok) successCount += 1;
        else failures.push(`${position.name}: ${result.error ?? "매도 실패"}`);
      } catch {
        failures.push(`${position.name}: 네트워크 오류`);
      }
    }

    refreshPortfolio();

    if (!failures.length) {
      window.alert(`${successCount}개 종목의 일괄매도를 완료했습니다.`);
      return;
    }

    const preview = failures.slice(0, 6).join("\n");
    const more = failures.length > 6 ? `\n외 ${failures.length - 6}건` : "";
    window.alert(`일괄매도 결과: 성공 ${successCount}건 · 실패 ${failures.length}건\n\n${preview}${more}`);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "일괄매도를 처리하지 못했습니다.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function installBulkSellButton() {
  const holdings = document.querySelector<HTMLElement>(".np-panel.holdings");
  if (!holdings) return;

  const title = holdings.querySelector<HTMLElement>(".np-section-title");
  const heading = title?.querySelector("h2")?.textContent?.trim();
  if (!title || heading !== "내 투자현황" || title.querySelector(`#${BUTTON_ID}`)) return;

  const controls = title.querySelector<HTMLElement>(":scope > div") ?? title;
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "일괄매도";
  button.setAttribute("aria-label", "보유종목 일괄매도");
  Object.assign(button.style, {
    height: "32px",
    padding: "0 10px",
    border: "1px solid #efb4b9",
    borderRadius: "6px",
    background: "#ffffff",
    color: "#e5484d",
    fontSize: "12px",
    fontWeight: "700",
    whiteSpace: "nowrap",
    cursor: "pointer",
  });
  button.addEventListener("click", () => void bulkSell(button));

  const refreshButton = Array.from(controls.querySelectorAll<HTMLButtonElement>("button"))
    .find(item => item.textContent?.includes("새로고침"));
  if (refreshButton) controls.insertBefore(button, refreshButton);
  else controls.appendChild(button);
}

export default function PortfolioBulkSell() {
  useEffect(() => {
    let scheduled = false;
    const scheduleInstall = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        installBulkSellButton();
      });
    };

    scheduleInstall();
    const observer = new MutationObserver(scheduleInstall);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
