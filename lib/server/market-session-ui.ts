import { getCheckedMarketSession } from "@/lib/server/market-hours";
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
      source: "NAVER" as const,
      stale: false,
    };
  }

  if (market === "US") {
    const now = localClock("America/New_York");
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday);
    const pre = weekday && now.minutes >= 4 * 60 && now.minutes < 9 * 60 + 30;
    const regular = weekday && now.minutes >= 9 * 60 + 30 && now.minutes < 16 * 60;
    const after = weekday && now.minutes >= 16 * 60 && now.minutes < 20 * 60;
    const isOpen = pre || regular || after;
    const session = pre ? "프리마켓" : regular ? "정규장" : after ? "애프터마켓" : "장 마감";
    const isDst = now.zone.toUpperCase().includes("EDT");
    return {
      isOpen,
      label: `${session} · NASDAQ`,
      notice: isOpen
        ? `${session} 빠른 시간 판정입니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`
        : `미국 현지 거래시간 밖입니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`,
      exchange: "NASDAQ",
      currentSession: pre ? "preMarket" : regular ? "regularMarket" : after ? "afterMarket" : "closed",
      isDaylightSavingTime: isDst,
      source: "NAVER" as const,
      stale: true,
    };
  }

  const now = localClock("Asia/Seoul");
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday);
  const krx = weekday && now.minutes >= 9 * 60 && now.minutes < 15 * 60 + 30;
  const nxt = weekday && now.minutes >= 8 * 60 && now.minutes < 20 * 60;
  const isOpen = krx || nxt;
  return {
    isOpen,
    label: isOpen ? `${krx ? "정규장 · KRX" : "NXT 거래시간"}` : "장 마감",
    notice: isOpen
      ? `${krx ? "KRX 정규장" : "NXT 거래시간"} 빠른 시간 판정입니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다.`
      : "국내주식 거래시간 밖입니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다.",
    exchange: krx ? "KRX" : nxt ? "NXT" : undefined,
    currentSession: krx ? "regularMarket" : nxt ? "nxt" : "closed",
    source: "NAVER" as const,
    stale: true,
  };
}

export async function getResponsiveMarketSession(market: Market) {
  if (market === "CRYPTO") return quickFallback(market);
  const fallback = quickFallback(market);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getCheckedMarketSession(market),
      new Promise<typeof fallback>(resolve => {
        timer = setTimeout(() => resolve(fallback), 450);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
