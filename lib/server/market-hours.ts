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

function statusList(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as NaverStatus[];
  const statuses = (payload as NaverStatus).statuses;
  return Array.isArray(statuses) ? statuses.filter(item => item && typeof item === "object") as NaverStatus[] : [];
}

function sessionDetails(status: NaverStatus) {
  const current = asRecord(status.currentSession);
  const sessions = Array.isArray(status.sessions) ? status.sessions.map(asRecord).filter((item): item is NaverStatus => Boolean(item)) : [];
  const currentType = stringValue(current, ["marketSessionType", "sessionType", "type"]);
  const state = stringValue(current, ["marketState", "legacyState", "state", "status"]).toUpperCase();
  const explicitOpen = ["OPEN", "OPENED", "TRADING", "TRADE", "RUNNING"].includes(state);
  const holiday = booleanValue(status, ["isHoliday", "holiday"]) ?? false;
  const matchingSession = sessions.find(item => stringValue(item, ["marketSessionType", "sessionType", "type"]) === currentType) ?? sessions[0] ?? null;
  const openTimeKst = stringValue(current, ["openTimeKst", "openTime"]) || stringValue(matchingSession, ["openTimeKst", "openTime"]);
  const closeTimeKst = stringValue(current, ["closeTimeKst", "closeTime"]) || stringValue(matchingSession, ["closeTimeKst", "closeTime"]);
  const daylight = booleanValue(status, ["isDaylightSavingTime"]) ?? booleanValue(current, ["isDaylightSavingTime"]);
  return { currentType, state, isOpen: !holiday && explicitOpen, holiday, openTimeKst, closeTimeKst, daylight };
}

function sessionLabel(type: string, market: Market) {
  const normalized = type.toLocaleLowerCase("en-US");
  if (normalized.includes("pre")) return "프리마켓";
  if (normalized.includes("after")) return "애프터마켓";
  if (normalized.includes("regular") || normalized.includes("main") || normalized.includes("normal")) return "정규장";
  if (normalized.includes("closing")) return "종가매매";
  return type || (market === "US" ? "미국장" : "국내장");
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

  const exchanges = market === "KR" ? ["krx", "nxt"] : ["nasdaq"];
  try {
    const result = await naverJson<unknown>(buildNaverPath("/api/stockSecurity/market-status/current", { exchanges }), { ttlMs: 5_000, staleMs: 120_000 });
    if (result.stale) return closedFallback(market, true);

    const statuses = statusList(result.data).filter(status => exchanges.includes(stringValue(status, ["exchange"]).toLocaleLowerCase("en-US")));
    if (!statuses.length) return closedFallback(market);

    const detailed = statuses.map(status => ({
      status,
      exchange: stringValue(status, ["exchange"]).toLocaleLowerCase("en-US"),
      detail: sessionDetails(status),
    }));
    const selected = market === "KR"
      ? detailed.find(item => item.exchange === "krx" && item.detail.isOpen)
        ?? detailed.find(item => item.exchange === "nxt" && item.detail.isOpen)
        ?? detailed.find(item => item.exchange === "krx" && !item.detail.holiday)
        ?? detailed.find(item => !item.detail.holiday)
        ?? detailed[0]
      : detailed.find(item => item.detail.isOpen) ?? detailed.find(item => !item.detail.holiday) ?? detailed[0];
    const exchange = stringValue(selected.status, ["exchange"]).toUpperCase();
    const detail = selected.detail;
    const label = detail.holiday ? "휴장일" : detail.isOpen ? sessionLabel(detail.currentType, market) : "장 마감";
    const schedule = detail.openTimeKst && detail.closeTimeKst ? ` · ${detail.openTimeKst}~${detail.closeTimeKst} KST` : "";
    const dst = market === "US" && detail.daylight !== undefined ? ` · ${detail.daylight ? "서머타임" : "표준시"}` : "";
    return {
      isOpen: detail.isOpen,
      label: `${label}${exchange ? ` · ${exchange}` : ""}`,
      notice: detail.holiday
        ? "네이버증권 기준 휴장일로 주문할 수 없습니다."
        : detail.isOpen
          ? `${sessionLabel(detail.currentType, market)} 주문 가능${schedule}${dst}`
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
