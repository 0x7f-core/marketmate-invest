import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import type { DomesticTradingVenue, Market } from "@/lib/server/market-data";

export type MarketSession = {
  isOpen: boolean;
  label: string;
  notice: string;
  exchange?: string;
  isHoliday?: boolean;
  currentSession?: string;
  isDaylightSavingTime?: boolean;
  openTimeKst?: string;
  closeTimeKst?: string;
  source: "NAVER";
  stale?: boolean;
};

type NaverStatus = Record<string, unknown>;

const US_AFTER_MARKET_CUTOFF_MINUTES_ET = 19 * 60 + 50;

export type DomesticVenueClockSession = {
  exchange: DomesticTradingVenue;
  isOpen: boolean;
  label: "프리마켓" | "동시호가" | "정규장" | "애프터마켓" | "애프터마켓 마감" | "장 마감";
  currentSession: "preMarket" | "openingAuction" | "regularMarket" | "closingAuction" | "afterMarket" | "afterMarketClosing" | "closed";
  openTimeKst?: string;
  closeTimeKst?: string;
};

function asRecord(value: unknown): NaverStatus | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as NaverStatus : null;
}

function stringValue(record: NaverStatus | null, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function booleanValue(record: NaverStatus | null, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "Y" || value === "y" || value === "true") return true;
    if (value === 0 || value === "0" || value === "N" || value === "n" || value === "false") return false;
  }
  return undefined;
}

function statusArray(record: NaverStatus | null) {
  if (!record || !Array.isArray(record.statuses)) return [] as NaverStatus[];
  return record.statuses.map(asRecord).filter((item): item is NaverStatus => Boolean(item));
}

function statusList(payload: unknown) {
  const root = asRecord(payload);
  if (!root) return [] as NaverStatus[];
  const direct = statusArray(root);
  if (direct.length) return direct;
  for (const key of ["data", "result", "body", "payload"]) {
    const nested = statusArray(asRecord(root[key]));
    if (nested.length) return nested;
  }
  return [] as NaverStatus[];
}

function sessionType(record: NaverStatus | null) {
  return stringValue(record, ["marketSessionType", "marketStatusDetailType", "sessionType", "type"]);
}

function sessionDetails(status: NaverStatus) {
  const current = asRecord(status.currentSession);
  const sessions = Array.isArray(status.sessions) ? status.sessions.map(asRecord).filter((item): item is NaverStatus => Boolean(item)) : [];
  const currentType = sessionType(current);
  const detailType = stringValue(current, ["marketStatusDetailType", "detailType"]).toLocaleLowerCase("en-US");
  const state = stringValue(current, ["marketState", "legacyState", "state", "status"]).toUpperCase();
  const stateOpen = ["OPEN", "OPENED", "TRADING", "TRADE", "RUNNING"].includes(state);
  const nonTradingDetail = ["preopen", "break", "close", "closed"].includes(detailType);
  const explicitOpen = stateOpen && !nonTradingDetail;
  const holiday = booleanValue(status, ["isHoliday", "holiday"]) ?? false;
  const matchingSession = sessions.find(item => sessionType(item) === currentType) ?? sessions[0] ?? null;
  const openTimeKst = stringValue(current, ["openTimeKst", "openTime"]) || stringValue(matchingSession, ["openTimeKst", "openTime"]);
  const closeTimeKst = stringValue(current, ["closeTimeKst", "closeTime"]) || stringValue(matchingSession, ["closeTimeKst", "closeTime"]);
  const daylight = booleanValue(status, ["isDaylightSavingTime"]) ?? booleanValue(current, ["isDaylightSavingTime"]);
  return { currentType, detailType, state, isOpen: !holiday && explicitOpen, holiday, openTimeKst, closeTimeKst, daylight };
}

function sessionLabel(type: string, market: Market) {
  const normalized = type.toLocaleLowerCase("en-US");
  if (normalized.includes("closing")) {
    if (normalized.includes("after")) return "애프터마켓 마감";
    if (normalized.includes("regular") || normalized.includes("main") || normalized.includes("normal")) return "정규장 마감";
    if (normalized.includes("pre")) return "프리마켓 마감";
    return "마감 세션";
  }
  if (normalized.includes("pre")) return "프리마켓";
  if (normalized.includes("after")) return "애프터마켓";
  if (normalized.includes("regular") || normalized.includes("main") || normalized.includes("normal")) return "정규장";
  return type || (market === "US" ? "미국장" : "국내장");
}

function clockPartsNow(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return {
    weekday: value("weekday"),
    minutes: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1,
  };
}

function clockMinutesNow(timeZone: string) {
  return clockPartsNow(timeZone).minutes;
}

function newYorkMinutesNow() {
  return clockMinutesNow("America/New_York");
}

export function getDomesticVenueClockSession(venue: DomesticTradingVenue): DomesticVenueClockSession {
  const now = clockPartsNow("Asia/Seoul");
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday);
  const minutes = now.minutes;

  if (!weekday || minutes < 0) {
    return { exchange: venue, isOpen: false, label: "장 마감", currentSession: "closed" };
  }

  if (minutes < 8 * 60 || minutes >= 20 * 60) {
    return {
      exchange: venue,
      isOpen: false,
      label: "애프터마켓 마감",
      currentSession: "afterMarketClosing",
      openTimeKst: "20:00",
      closeTimeKst: "08:00",
    };
  }

  if (venue === "NXT") {
    if (minutes < 8 * 60 + 50) return { exchange: venue, isOpen: true, label: "프리마켓", currentSession: "preMarket", openTimeKst: "08:00", closeTimeKst: "08:50" };
    if (minutes < 9 * 60) return { exchange: venue, isOpen: false, label: "동시호가", currentSession: "openingAuction", openTimeKst: "08:50", closeTimeKst: "09:00" };
    if (minutes < 15 * 60 + 20) return { exchange: venue, isOpen: true, label: "정규장", currentSession: "regularMarket", openTimeKst: "09:00", closeTimeKst: "15:20" };
    if (minutes < 15 * 60 + 40) return { exchange: venue, isOpen: false, label: "동시호가", currentSession: "closingAuction", openTimeKst: "15:20", closeTimeKst: "15:40" };
    return { exchange: venue, isOpen: true, label: "애프터마켓", currentSession: "afterMarket", openTimeKst: "15:40", closeTimeKst: "20:00" };
  }

  if (minutes < 8 * 60 + 50) return { exchange: venue, isOpen: false, label: "장 마감", currentSession: "closed" };
  if (minutes < 9 * 60) return { exchange: venue, isOpen: false, label: "동시호가", currentSession: "openingAuction", openTimeKst: "08:50", closeTimeKst: "09:00" };
  if (minutes < 15 * 60 + 20) return { exchange: venue, isOpen: true, label: "정규장", currentSession: "regularMarket", openTimeKst: "09:00", closeTimeKst: "15:20" };
  if (minutes < 15 * 60 + 30) return { exchange: venue, isOpen: false, label: "장 마감", currentSession: "closed" };
  if (minutes < 16 * 60) return { exchange: venue, isOpen: false, label: "동시호가", currentSession: "closingAuction", openTimeKst: "15:30", closeTimeKst: "16:00" };
  return { exchange: venue, isOpen: true, label: "애프터마켓", currentSession: "afterMarket", openTimeKst: "16:00", closeTimeKst: "20:00" };
}

export function getDomesticOverviewClockSession() {
  const krx = getDomesticVenueClockSession("KRX");
  const nxt = getDomesticVenueClockSession("NXT");
  if (krx.isOpen) return krx;
  if (nxt.isOpen) return nxt;
  if (krx.currentSession !== "closed") return krx;
  if (nxt.currentSession !== "closed") return nxt;
  return krx;
}

function beforeUsAfterMarketCutoff() {
  const minutes = newYorkMinutesNow();
  return minutes >= 0 && minutes < US_AFTER_MARKET_CUTOFF_MINUTES_ET;
}

function isUsAfterMarket(type: string) {
  const normalized = type.toLocaleLowerCase("en-US");
  return normalized.includes("after") && !normalized.includes("closing");
}

function minusTenMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  const total = (hour * 60 + minute - 10 + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function usAfterMarketCloseKst(detail: ReturnType<typeof sessionDetails>) {
  return minusTenMinutes(detail.closeTimeKst) || (detail.daylight === false ? "09:50" : "08:50");
}

function isSupportedTradingSession(market: Market, detail: ReturnType<typeof sessionDetails>) {
  if (!detail.isOpen || !detail.currentType) return false;
  const type = detail.currentType.toLocaleLowerCase("en-US");
  if (type.includes("closing")) return false;
  if (market === "US") return !type.includes("after") || beforeUsAfterMarketCutoff();
  return true;
}

function domesticNotice(session: DomesticVenueClockSession, naverOpen: boolean) {
  const schedule = session.openTimeKst && session.closeTimeKst ? ` · ${session.openTimeKst}~${session.closeTimeKst} KST` : "";
  if (session.currentSession === "openingAuction" || session.currentSession === "closingAuction") {
    return `${session.exchange} ${session.label} 시간에는 모의주문을 받지 않습니다${schedule}.`;
  }
  if (session.currentSession === "afterMarketClosing") {
    return `${session.exchange} 애프터마켓이 마감되었습니다${schedule}.`;
  }
  if (!session.isOpen) {
    return `${session.exchange} 현재 거래 가능 시간이 아닙니다.`;
  }
  if (!naverOpen) {
    return `현재 시간은 ${session.exchange} ${session.label} 구간이지만 네이버증권 장 상태가 열림으로 확인되지 않아 안전을 위해 주문을 중단합니다${schedule}.`;
  }
  return `${session.exchange} ${session.label} 주문 가능${schedule}.`;
}

function closedFallback(market: Market, stale = false): MarketSession {
  return {
    isOpen: false,
    label: stale ? "장 상태 갱신 지연" : "장 상태 확인 불가",
    notice: stale
      ? `${market === "US" ? "미국주식" : "국내주식"} 장 상태가 최신 정보가 아니어서 안전을 위해 주문을 중단합니다.`
      : `${market === "US" ? "미국주식" : "국내주식"} 네이버증권 장 상태를 확인할 수 없어 안전을 위해 주문을 중단합니다.`,
    source: "NAVER",
    stale,
  };
}

export async function getCheckedMarketSession(
  market: Market,
  preferredDomesticVenue?: DomesticTradingVenue,
): Promise<MarketSession> {
  if (market === "CRYPTO") {
    return { isOpen: true, label: "24시간", notice: "가상자산은 네이버증권 시세 기준으로 24시간 주문할 수 있습니다.", source: "NAVER" };
  }

  const exchanges = market === "KR" ? ["krx", "nxt"] : ["nasdaq"];
  try {
    const result = await naverJson<unknown>(buildNaverPath("/api/stockSecurity/market-status/current", { exchanges }), { ttlMs: 5_000, staleMs: 120_000 });
    if (result.stale) return closedFallback(market, true);

    const statuses = statusList(result.data).filter(status => exchanges.includes(stringValue(status, ["exchange"]).toLocaleLowerCase("en-US")));
    if (!statuses.length) return closedFallback(market);

    const detailed = statuses.map(status => {
      const exchange = stringValue(status, ["exchange"]).toLocaleLowerCase("en-US");
      const detail = sessionDetails(status);
      return { status, exchange, detail, tradable: isSupportedTradingSession(market, detail) };
    });

    if (market === "KR") {
      const withClock = detailed
        .filter(item => item.exchange === "krx" || item.exchange === "nxt")
        .map(item => {
          const venue = item.exchange.toUpperCase() as DomesticTradingVenue;
          const clock = getDomesticVenueClockSession(venue);
          const tradable = !item.detail.holiday && clock.isOpen && item.detail.isOpen;
          return { ...item, venue, clock, tradable };
        });

      const preferredExchange = preferredDomesticVenue?.toLocaleLowerCase("en-US");
      const selected = preferredExchange
        ? withClock.find(item => item.exchange === preferredExchange)
        : withClock.find(item => item.venue === "KRX" && item.tradable)
          ?? withClock.find(item => item.venue === "NXT" && item.tradable)
          ?? withClock.find(item => item.venue === "KRX" && !item.detail.holiday && item.clock.currentSession !== "closed")
          ?? withClock.find(item => item.venue === "NXT" && !item.detail.holiday && item.clock.currentSession !== "closed")
          ?? withClock.find(item => item.venue === "KRX" && !item.detail.holiday)
          ?? withClock.find(item => !item.detail.holiday)
          ?? withClock[0];

      if (!selected) return closedFallback(market);

      const { venue, clock, detail } = selected;
      const isOpen = selected.tradable;
      return {
        isOpen,
        label: `${detail.holiday ? "휴장일" : clock.label} · ${venue}`,
        notice: detail.holiday
          ? `네이버증권 기준 ${venue} 휴장일로 주문할 수 없습니다.`
          : domesticNotice(clock, detail.isOpen),
        exchange: venue,
        isHoliday: detail.holiday,
        currentSession: clock.currentSession,
        openTimeKst: clock.openTimeKst,
        closeTimeKst: clock.closeTimeKst,
        source: "NAVER",
        stale: false,
      };
    }

    const selected = detailed.find(item => item.tradable) ?? detailed.find(item => !item.detail.holiday) ?? detailed[0];
    const exchange = stringValue(selected.status, ["exchange"]).toUpperCase();
    const rawDetail = selected.detail;
    const afterMarket = isUsAfterMarket(rawDetail.currentType);
    const detail = afterMarket ? { ...rawDetail, closeTimeKst: usAfterMarketCloseKst(rawDetail) } : rawDetail;
    const isOpen = selected.tradable;
    const afterMarketCutoffReached = afterMarket && rawDetail.isOpen && !isOpen && !beforeUsAfterMarketCutoff();
    const sessionName = sessionLabel(detail.currentType, market);
    const excludedOpenSession = detail.isOpen && !isOpen;
    const label = detail.holiday
      ? "휴장일"
      : afterMarketCutoffReached
        ? "애프터마켓 마감"
        : isOpen
          ? sessionName
          : excludedOpenSession
            ? sessionName
            : "장 마감";
    const schedule = detail.openTimeKst && detail.closeTimeKst ? ` · ${detail.openTimeKst}~${detail.closeTimeKst} KST` : "";
    const dst = detail.daylight !== undefined ? ` · ${detail.daylight ? "서머타임" : "표준시"}` : "";
    return {
      isOpen,
      label: `${label}${exchange ? ` · ${exchange}` : ""}`,
      notice: detail.holiday
        ? "네이버증권 기준 휴장일로 주문할 수 없습니다."
        : afterMarketCutoffReached
          ? `애프터마켓 모의주문은 ${detail.closeTimeKst || (detail.daylight === false ? "09:50" : "08:50")} KST에 마감되었습니다${dst}.`
          : isOpen
            ? `${sessionName} 주문 가능${schedule}${dst}`
            : excludedOpenSession
              ? `${sessionName}은 현재 모의투자 주문 대상에서 제외됩니다${schedule}${dst}.`
              : `네이버증권 기준 현재 거래 세션이 닫혀 있습니다${schedule}${dst}.`,
      exchange: exchange || undefined,
      isHoliday: detail.holiday,
      currentSession: detail.currentType || undefined,
      isDaylightSavingTime: detail.daylight,
      openTimeKst: detail.openTimeKst || undefined,
      closeTimeKst: detail.closeTimeKst || undefined,
      source: "NAVER",
      stale: false,
    };
  } catch {
    return closedFallback(market);
  }
}
