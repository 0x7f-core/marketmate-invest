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
    const session = pre ? "프리마켓" : regular ? "정규장" : after ? "애프터마켓" : afterCutoff ? "애프터마켓 마감" : "장 마감";
    const currentSession = pre ? "preMarket" : regular ? "regularMarket" : after ? "afterMarket" : afterCutoff ? "afterMarketClosing" : "closed";
    const isDst = now.zone.toUpperCase().includes("EDT");
    const hours = isDst
      ? pre ? ["17:00", "22:30"] : regular ? ["22:30", "05:00"] : afterWindow ? ["05:00", "08:50"] : ["22:30", "05:00"]
      : pre ? ["18:00", "23:30"] : regular ? ["23:30", "06:00"] : afterWindow ? ["06:00", "09:50"] : ["23:30", "06:00"];
    return {
      isOpen,
      label: `${session} · NASDAQ`,
      notice: afterCutoff
        ? `애프터마켓 모의주문은 ${hours[1]} KST에 마감되었습니다 · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`
        : isOpen
          ? `${session} 빠른 시간 판정입니다 · ${hours[0]}~${hours[1]} KST · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`
          : `미국 현지 거래시간 밖입니다 · 정규장 ${hours[0]}~${hours[1]} KST · 주문 시 네이버증권 장 상태를 다시 확인합니다${isDst ? " · 서머타임" : " · 표준시"}.`,
      exchange: "NASDAQ",
      currentSession,
      isDaylightSavingTime: isDst,
      openTimeKst: hours[0],
      closeTimeKst: hours[1],
      source: "NAVER" as const,
      stale: true,
    };
  }

  const now = localClock("Asia/Seoul");
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday);
  const nxtPre = weekday && now.minutes >= 8 * 60 && now.minutes < 8 * 60 + 50;
  const morningBreak = weekday && now.minutes >= 8 * 60 + 50 && now.minutes < 9 * 60;
  const krx = weekday && now.minutes >= 9 * 60 && now.minutes < 15 * 60 + 30;
  const nxtAfternoon = weekday && now.minutes >= 15 * 60 + 30 && now.minutes < 20 * 60;
  const isOpen = nxtPre || krx || nxtAfternoon;
  const exchange = krx ? "KRX" : (nxtPre || nxtAfternoon) ? "NXT" : "KRX";
  const currentSession = nxtPre ? "preMarket" : krx ? "regularMarket" : nxtAfternoon ? "afterMarket" : morningBreak ? "morningBreak" : "closed";
  const session = nxtPre ? "NXT 프리마켓" : krx ? "KRX 정규장" : nxtAfternoon ? "NXT 오후 거래" : morningBreak ? "거래 준비시간" : "장 마감";
  const openTimeKst = nxtPre ? "08:00" : krx ? "09:00" : nxtAfternoon ? "15:30" : morningBreak ? "09:00" : "09:00";
  const closeTimeKst = nxtPre ? "08:50" : krx ? "15:30" : nxtAfternoon ? "20:00" : morningBreak ? "09:00" : "15:30";
  return {
    isOpen,
    label: isOpen ? `${session} · ${exchange}` : session,
    notice: morningBreak
      ? "국내주식은 08:50~09:00 KST에는 주문할 수 없습니다. KRX 정규장은 09:00 KST에 시작합니다."
      : isOpen
        ? `${session} 빠른 시간 판정입니다 · ${openTimeKst}~${closeTimeKst} KST · 주문 시 네이버증권 장 상태를 다시 확인합니다.`
        : "국내주식 거래시간 밖입니다 · NXT 프리마켓 08:00~08:50 / KRX 정규장 09:00~15:30 / NXT 오후 거래 15:30~20:00 KST · 주문 시 네이버증권 장 상태를 다시 확인합니다.",
    exchange,
    currentSession,
    openTimeKst,
    closeTimeKst,
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
