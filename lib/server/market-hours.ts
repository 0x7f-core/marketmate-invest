import type { Market } from "@/lib/server/market-data";

export type MarketSession = { isOpen: boolean; label: string; notice: string };

function parts(now: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).reduce<Record<string, string>>((result, item) => {
    if (item.type !== "literal") result[item.type] = item.value;
    return result;
  }, {});
  return { date: `${values.year}-${values.month}-${values.day}`, weekday: values.weekday, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

const KR_2026_CLOSED = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
  "2026-05-05", "2026-05-25", "2026-06-03", "2026-08-17", "2026-09-24",
  "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
]);
const US_2026_CLOSED = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);
const US_2026_EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24"]);

export function getMarketSession(market: Market, now = new Date()): MarketSession {
  if (market === "CRYPTO") return { isOpen: true, label: "24시간", notice: "코인은 24시간 주문할 수 있습니다." };
  if (market === "KR") {
    const local = parts(now, "Asia/Seoul");
    const weekday = local.weekday !== "Sat" && local.weekday !== "Sun";
    const holiday = KR_2026_CLOSED.has(local.date);
    const pre = local.minutes >= 8 * 60 && local.minutes < 8 * 60 + 50;
    const main = local.minutes >= 9 * 60 && local.minutes < 15 * 60 + 20;
    const after = local.minutes >= 15 * 60 + 40 && local.minutes < 20 * 60;
    const isOpen = weekday && !holiday && (pre || main || after);
    const label = pre ? "NXT 프리마켓" : main ? "NXT 메인마켓" : after ? "NXT 애프터마켓" : "장 마감";
    return { isOpen, label, notice: isOpen ? `${label} 주문 가능` : "국내주식은 NXT 거래시간(평일 08:00~08:50, 09:00~15:20, 15:40~20:00 KST)에만 주문할 수 있습니다." };
  }
  const local = parts(now, "America/New_York");
  const weekday = local.weekday !== "Sat" && local.weekday !== "Sun";
  const holiday = US_2026_CLOSED.has(local.date);
  const close = US_2026_EARLY_CLOSE.has(local.date) ? 13 * 60 : 16 * 60;
  const isOpen = weekday && !holiday && local.minutes >= 4 * 60 && local.minutes < close;
  const label = local.minutes < 9 * 60 + 30 ? "프리마켓" : isOpen ? "정규장" : "장 마감";
  return { isOpen, label, notice: isOpen ? `미국 ${label} 주문 가능` : "미국주식은 거래일 프리마켓 포함 04:00~16:00 ET에만 주문할 수 있습니다." };
}
