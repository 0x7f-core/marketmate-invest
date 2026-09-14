import { env } from "cloudflare:workers";
import { kisGetRoot, type Market } from "@/lib/server/market-data";

export type MarketSession = { isOpen: boolean; label: string; notice: string };

function parts(now: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).reduce<Record<string, string>>((result, item) => {
    if (item.type !== "literal") result[item.type] = item.value;
    return result;
  }, {});
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    year: Number(values.year),
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function isoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const date = utcDate(year, month, day);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  else if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = utcDate(year, month, 1);
  return isoDate(utcDate(year, month, 1 + ((7 + weekday - first.getUTCDay()) % 7) + (nth - 1) * 7));
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  last.setUTCDate(last.getUTCDate() - ((7 + last.getUTCDay() - weekday) % 7));
  return isoDate(last);
}

function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utcDate(year, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}

function usClosedDates(year: number) {
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const dates = new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    isoDate(goodFriday),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
  const nextNewYear = observedFixedHoliday(year + 1, 1, 1);
  if (nextNewYear.startsWith(String(year))) dates.add(nextNewYear);
  return dates;
}

function usEarlyCloseDates(year: number) {
  const thanksgiving = utcDate(year, 11, Number(nthWeekday(year, 11, 4, 4).slice(-2)));
  thanksgiving.setUTCDate(thanksgiving.getUTCDate() + 1);
  const dates = new Set([isoDate(thanksgiving)]);
  for (const [month, day] of [[7, 3], [12, 24]] as const) {
    const date = utcDate(year, month, day);
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5 && !usClosedDates(year).has(isoDate(date))) dates.add(isoDate(date));
  }
  return dates;
}

function usKoreanHours(now: Date, earlyClose: boolean) {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(now).find(item => item.type === "timeZoneName")?.value ?? "GMT-5";
  const daylight = offset.includes("-4");
  return {
    pre: daylight ? "17:00" : "18:00",
    close: earlyClose ? (daylight ? "02:00" : "03:00") : (daylight ? "05:00" : "06:00"),
    season: daylight ? "서머타임" : "표준시",
  };
}

const KR_2026_CLOSED = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
  "2026-05-05", "2026-05-25", "2026-06-03", "2026-08-17", "2026-09-24",
  "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
]);
const krCalendarMemory = new Map<string, boolean>();

async function kisKrOpen(date: string) {
  const memoized = krCalendarMemory.get(date);
  if (memoized !== undefined) return memoized;
  const stored = await env.DB?.prepare("SELECT is_open AS isOpen FROM market_calendar WHERE market='KR' AND date=?")
    .bind(date).first<{ isOpen: number }>();
  if (stored) {
    const isOpen = Boolean(stored.isOpen);
    krCalendarMemory.set(date, isOpen);
    return isOpen;
  }
  const compact = date.replaceAll("-", "");
  const root = await kisGetRoot("/uapi/domestic-stock/v1/quotations/chk-holiday", "CTCA0903R", {
    BASS_DT: compact, CTX_AREA_FK: "", CTX_AREA_NK: "",
  });
  const rows = (Array.isArray(root.output) ? root.output : [root.output]) as Array<Record<string, unknown>>;
  const row = rows.find(item => String(item?.bass_dt ?? item?.BASS_DT ?? "") === compact) ?? rows[0];
  const isOpen = String(row?.opnd_yn ?? row?.OPND_YN ?? "N").toUpperCase() === "Y";
  krCalendarMemory.set(date, isOpen);
  await env.DB?.prepare(`INSERT INTO market_calendar (id,market,date,is_open,source,updated_at) VALUES (?, 'KR', ?, ?, 'KIS', ?)
    ON CONFLICT(market,date) DO UPDATE SET is_open=excluded.is_open,source=excluded.source,updated_at=excluded.updated_at`)
    .bind(`KR:${date}`, date, isOpen ? 1 : 0, Date.now()).run();
  return isOpen;
}

export function getMarketSession(market: Market, now = new Date()): MarketSession {
  if (market === "CRYPTO") return { isOpen: true, label: "24시간", notice: "코인은 연중무휴 24시간 주문할 수 있습니다." };
  if (market === "KR") {
    const local = parts(now, "Asia/Seoul");
    const weekday = local.weekday !== "Sat" && local.weekday !== "Sun";
    const holiday = KR_2026_CLOSED.has(local.date);
    const pre = local.minutes >= 8 * 60 && local.minutes < 8 * 60 + 50;
    const main = local.minutes >= 9 * 60 && local.minutes < 15 * 60 + 20;
    const after = local.minutes >= 15 * 60 + 40 && local.minutes < 20 * 60;
    const isOpen = weekday && !holiday && (pre || main || after);
    const label = holiday ? "휴장일" : pre ? "NXT 프리마켓" : main ? "NXT 메인마켓" : after ? "NXT 애프터마켓" : "장 마감";
    return {
      isOpen,
      label,
      notice: isOpen ? `${label} 주문 가능` : holiday
        ? "오늘은 국내 주식시장 휴장일로 주문할 수 없습니다."
        : "국내주식은 개장일 08:00~08:50, 09:00~15:20, 15:40~20:00(한국시간)에만 주문할 수 있습니다.",
    };
  }
  const local = parts(now, "America/New_York");
  const weekday = local.weekday !== "Sat" && local.weekday !== "Sun";
  const holiday = usClosedDates(local.year).has(local.date);
  const earlyClose = usEarlyCloseDates(local.year).has(local.date);
  const close = earlyClose ? 13 * 60 : 16 * 60;
  const isOpen = weekday && !holiday && local.minutes >= 4 * 60 && local.minutes < close;
  const hours = usKoreanHours(now, earlyClose);
  const sessionName = local.minutes < 9 * 60 + 30 ? "프리마켓" : isOpen ? "정규장" : "장 마감";
  const schedule = `${hours.pre}~익일 ${hours.close} (한국시간·${hours.season})`;
  return {
    isOpen,
    label: holiday ? "미국장 휴장" : `${sessionName} · ${hours.season}`,
    notice: isOpen ? `${sessionName} 주문 가능 · ${schedule}` : holiday
      ? "오늘은 미국 주식시장 휴장일로 주문할 수 없습니다."
      : `미국주식은 거래일 프리마켓 포함 ${schedule}에만 주문할 수 있습니다.`,
  };
}

export async function getCheckedMarketSession(market: Market, now = new Date()) {
  const session = getMarketSession(market, now);
  if (market !== "KR" || !session.isOpen) return session;
  const date = parts(now, "Asia/Seoul").date;
  try {
    if (await kisKrOpen(date)) return session;
    return { isOpen: false, label: "휴장일", notice: "오늘은 한국투자증권 기준 국내 주식시장 휴장일로 주문할 수 없습니다." };
  } catch {
    return session;
  }
}
