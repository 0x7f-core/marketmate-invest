import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";
import type { Market } from "@/lib/server/market-data";

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
const KR_NXT_PREMARKET_CLOSE_MINUTES = 8 * 60 + 50;
const KR_KRX_REGULAR_OPEN_MINUTES = 9 * 60;
const KR_CLOSING_AUCTION_START_MINUTES = 15 * 60 + 20;
const KR_CLOSING_AUCTION_END_MINUTES = 15 * 60 + 30;

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
  const state = stringValue(current, ["marketState", "legacyState", "state", "status"]).toUpperCase();
  const explicitOpen = ["OPEN", "OPENED", "TRADING", "TRADE", "RUNNING"].includes(state);
  const holiday = booleanValue(status, ["isHoliday", "holiday"]) ?? false;
  const matchingSession = sessions.find(item => sessionType(item) === currentType) ?? sessions[0] ?? null;
  const openTimeKst = stringValue(current, ["openTimeKst", "openTime"]) || stringValue(matchingSession, ["openTimeKst", "openTime"]);
  const closeTimeKst = stringValue(current, ["closeTimeKst", "closeTime"]) || stringValue(matchingSession, ["closeTimeKst", "closeTime"]);
  const daylight = booleanValue(status, ["isDaylightSavingTime"]) ?? booleanValue(current, ["isDaylightSavingTime"]);
  return { currentType, state, isOpen: !holiday && explicitOpen, holiday, openTimeKst, closeTimeKst, daylight };
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

function clockMinutesNow(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
}

function newYorkMinutesNow() {
  return clockMinutesNow("America/New_York");
}

function isKrMorningBreak() {
  const minutes = clockMinutesNow("Asia/Seoul");
  return minutes >= KR_NXT_PREMARKET_CLOSE_MINUTES && minutes < KR_KRX_REGULAR_OPEN_MINUTES;
}

function isKrClosingAuction() {
  const minutes = clockMinutesNow("Asia/Seoul");
  return minutes >= KR_CLOSING_AUCTION_START_MINUTES && minutes < KR_CLOSING_AUCTION_END_MINUTES;
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

function isSupportedTradingSession(market: Market, exchange: string, detail: ReturnType<typeof sessionDetails>) {
  if (!detail.isOpen || !detail.currentType) return false;
  if (market === "KR") return !isKrMorningBreak() && !isKrClosingAuction();
  const type = detail.currentType.toLocaleLowerCase("en-US");
  if (type.includes("closing")) return false;
  if (market === "US") return !type.includes("after") || beforeUsAfterMarketCutoff();
  return true;
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

export async function getCheckedMarketSession(market: Market): Promise<MarketSession> {
  if (market === "CRYPTO") {
    return { isOpen: true, label: "24시간", notice: "가상자산은 네이버증권 시세 기준으로 24시간 주문할 수 있습니다.", source: "NAVER" };
  }

  if (market === "KR" && isKrMorningBreak()) {
    return {
      isOpen: false,
      label: "거래 준비시간",
      notice: "국내주식은 NXT 프리마켓 종료 후 08:50~09:00 KST에는 주문할 수 없습니다. KRX 정규장은 09:00 KST에 시작합니다.",
      exchange: "NXT",
      currentSession: "morningBreak",
      openTimeKst: "09:00",
      closeTimeKst: "15:30",
      source: "NAVER",
      stale: false,
    };
  }

  if (market === "KR" && isKrClosingAuction()) {
    return {
      isOpen: false,
      label: "동시호가",
      notice: "국내주식은 15:20~15:30 KST 동시호가 시간에는 모의투자 주문을 받지 않습니다. 15:30 KST부터 다시 주문할 수 있습니다.",
      exchange: "KRX",
      currentSession: "closingAuction",
      openTimeKst: "15:30",
      closeTimeKst: "20:00",
      source: "NAVER",
      stale: false,
    };
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
      return { status, exchange, detail, tradable: isSupportedTradingSession(market, exchange, detail) };
    });
    const selected = market === "KR"
      ? detailed.find(item => item.exchange === "krx" && item.tradable)
        ?? detailed.find(item => item.exchange === "nxt" && item.tradable)
        ?? detailed.find(item => item.exchange === "krx" && !item.detail.holiday)
        ?? detailed.find(item => !item.detail.holiday)
        ?? detailed[0]
      : detailed.find(item => item.tradable) ?? detailed.find(item => !item.detail.holiday) ?? detailed[0];
    const exchange = stringValue(selected.status, ["exchange"]).toUpperCase();
    const rawDetail = selected.detail;
    const afterMarket = market === "US" && isUsAfterMarket(rawDetail.currentType);
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
    const dst = market === "US" && detail.daylight !== undefined ? ` · ${detail.daylight ? "서머타임" : "표준시"}` : "";
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
