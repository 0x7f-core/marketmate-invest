import { getCheckedMarketSession, getDomesticOverviewClockSession } from "@/lib/server/market-hours";
import type { Market } from "@/lib/server/market-data";

function localClock(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return {
    weekday: value("weekday"),
    minutes: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1,
    zone: value("timeZoneName"),
  };
}

function quickFallback(market: Market) {
  if (market === "CRYPTO") {
    return {
      isOpen: true,
      label: "24시간",
      notice: "가상자산은 24시간 주문할 수 있습니다.",
      currentSession: "always",
      source: "NAVER" as const,
      stale: false,
    };
  }

  if (market === "US") {
    const now = localClock("America/New_York");
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday);
    const pre = weekday && now.minutes >= 4 * 60 && now.minutes < 9 * 60 + 30;
    const regular = weekday && now.minutes >= 9 * 60 + 30 && now.minutes < 16 * 60;
    const afterWindow = weekday && now.minutes >= 16 * 60 && now.minutes < 20 * 60;
    const after = afterWindow && now.minutes < 19 * 60 + 50;
    const afterCutoff = afterWindow && !after;
    const isOpen = pre || regular || after;
    const session = pre ? "프리마켓" : regular ? "정규장" : after ? "애프터마켓" : "장 마감";
    const currentSession = pre ? "preMarket" : regular ? "regularMarket" : after ? "afterMarket" : afterCutoff ? "afterMarketClosing" : "closed";
    const isDst = now.zone.toUpperCase().includes("EDT");
    const fullHours = isDst ? ["17:00", "08:50"] : ["18:00", "09:50"];
    const hours = isDst
      ? pre ? ["17:00", "22:30"] : regular ? ["22:30", "05:00"] : afterWindow ? ["05:00", "08:50"] : fullHours
      : pre ? ["18:00", "23:30"] : regular ? ["23:30", "06:00"] : afterWindow ? ["06:00", "09:50"] : fullHours;
    return {
      isOpen,
      label: `${session} · NASDAQ`,
      notice: afterCutoff
        ? `애프터마켓 모의주문은 ${hours[1]} KST에 마감되었습니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`
        : isOpen
          ? `${session} 빠른 시간 판정입니다 · ${hours[0]}~${hours[1]} KST · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`
          : `미국주식 전체 주문 가능 시간은 ${fullHours[0]}~${fullHours[1]} KST입니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`,
      exchange: "NASDAQ",
      currentSession,
      isDaylightSavingTime: isDst,
      openTimeKst: hours[0],
      closeTimeKst: hours[1],
      source: "NAVER" as const,
      stale: true,
    };
  }

  const domestic = getDomesticOverviewClockSession();
  const schedule = domestic.openTimeKst && domestic.closeTimeKst
    ? ` · ${domestic.openTimeKst}~${domestic.closeTimeKst} KST`
    : "";
  const notice = domestic.currentSession === "afterMarketClosing"
    ? `${domestic.exchange} 장 마감${schedule} · 주문 시 네이버증권 장 상태를 다시 확인합니다.`
    : domestic.isOpen
      ? `${domestic.exchange} ${domestic.label} 빠른 시간 판정입니다${schedule} · 주문 시 네이버증권 장 상태를 다시 확인합니다.`
      : `${domestic.exchange} ${domestic.label} 구간에는 모의주문을 받지 않습니다${schedule} · 주문 시 네이버증권 장 상태를 다시 확인합니다.`;

  return {
    isOpen: domestic.isOpen,
    label: `${domestic.label} · ${domestic.exchange}`,
    notice,
    exchange: domestic.exchange,
    currentSession: domestic.currentSession,
    openTimeKst: domestic.openTimeKst,
    closeTimeKst: domestic.closeTimeKst,
    source: "NAVER" as const,
    stale: true,
  };
}

export async function getResponsiveMarketSession(market: Market) {
  if (market === "CRYPTO") return quickFallback(market);
  const fallback = quickFallback(market);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const resolved = await Promise.race([
      getCheckedMarketSession(market),
      new Promise<typeof fallback>(resolve => {
        timer = setTimeout(() => resolve(fallback), 450);
      }),
    ]);

    if (market === "US" && !resolved.isOpen) {
      const now = localClock("America/New_York");
      const isDst = now.zone.toUpperCase().includes("EDT");
      return {
        ...resolved,
        isDaylightSavingTime: isDst,
        openTimeKst: isDst ? "17:00" : "18:00",
        closeTimeKst: isDst ? "08:50" : "09:50",
      };
    }

    return resolved;
  } finally {
    if (timer) clearTimeout(timer);
  }
}