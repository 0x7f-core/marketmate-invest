type SupportedMarket = "KR" | "US" | "CRYPTO";

export type SupportedNation = "KR" | "US" | "FOREIGN" | null;

const FOREIGN_REUTERS_SUFFIXES = new Set([
  "T", "HK", "SS", "SZ", "L", "DE", "F", "PA", "TO", "V", "AX", "NS", "BO", "SI", "KS", "KQ",
  "TW", "TWO", "MI", "AS", "BR", "S", "SW", "ST", "HE", "CO", "OL", "VI", "MC", "WA", "PR", "BU",
  "AT", "IR", "JO", "KL", "BK", "JK", "J", "SA", "MX",
]);

function canonical(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

export function classifySupportedNation(value: string): SupportedNation {
  const nation = canonical(value);
  if (!nation) return null;

  if (["KR", "KOR", "KOREA", "SOUTH KOREA", "REPUBLIC OF KOREA", "KOREA REPUBLIC OF", "대한민국", "한국"].includes(nation)) return "KR";
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "AMERICA", "미국", "미합중국"].includes(nation)) return "US";
  return "FOREIGN";
}

export function normalizeSupportedExchange(market: SupportedMarket, value: string | null | undefined) {
  const raw = (value ?? "").normalize("NFKC").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/[\s._-]+/g, "");

  // Naver's crypto search rows identify KRW markets as UPBIT, while older UI
  // state used NAVER/CRYPTO as source-like exchange labels. Accept those legacy
  // aliases but canonicalize executable crypto orders to UPBIT. The actual quote
  // data still comes from Naver's /api/polling/coin/price endpoint.
  if (market === "CRYPTO") return ["UPBIT", "NAVER", "CRYPTO"].includes(compact) ? "UPBIT" : "";

  if (market === "KR") {
    if (compact === "KR" || compact === "KRX" || compact.includes("한국거래소")) return "KRX";
    if (compact === "NXT" || compact.includes("넥스트레이드")) return "NXT";
    if (compact === "KOSPI" || compact.includes("코스피")) return "KOSPI";
    if (compact === "KOSDAQ" || compact.includes("코스닥")) return "KOSDAQ";
    if (compact === "KONEX" || compact.includes("코넥스")) return "KONEX";
    return "";
  }

  if (compact.includes("NYSEAMERICAN") || compact.includes("AMEX") || ["AMS", "ASE"].includes(compact)) return "AMS";
  if (compact.includes("NYSEARCA") || compact === "ARCA" || compact.includes("CBOE") || compact.includes("BATS") || compact.includes("BZX")) return "USA";
  if (compact.includes("OTCQX") || compact.includes("OTCQB") || compact === "OTC") return "USA";
  if (compact.includes("NYSE") || ["NYS", "NYQ"].includes(compact)) return "NYS";
  if (compact.includes("NASDAQ") || ["NAS", "NSQ", "NMS"].includes(compact)) return "NAS";
  if (["USA", "US"].includes(compact)) return compact;
  return "";
}

export function hasUnsupportedForeignReutersSuffix(symbol: string) {
  const clean = symbol.normalize("NFKC").trim().toUpperCase();
  const match = clean.match(/\.([A-Z]{1,4})$/);
  return Boolean(match && FOREIGN_REUTERS_SUFFIXES.has(match[1]));
}

export function isSupportedUsSymbolInput(symbol: string) {
  const clean = symbol.normalize("NFKC").trim();
  if (!clean || /^\d/.test(clean)) return false;
  return !hasUnsupportedForeignReutersSuffix(clean);
}
