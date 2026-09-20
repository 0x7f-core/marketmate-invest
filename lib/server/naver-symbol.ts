const LOWERCASE_SUFFIX = /_[a-z]+(?:\.|$)/;
const US_REUTERS_SUFFIX = /[._](?:O|K|N|P|A)$/i;

export function normalizeNaverReutersCode(code: string) {
  const clean = code.trim();
  const [base, ...underscoreParts] = clean.split("_");
  if (!underscoreParts.length) return clean.toUpperCase();

  const rest = underscoreParts.join("_");
  const dot = rest.indexOf(".");
  if (dot < 0) return `${base.toUpperCase()}_${rest}`;
  return `${base.toUpperCase()}_${rest.slice(0, dot)}.${rest.slice(dot + 1).toUpperCase()}`;
}

export function normalizeNaverMarketSymbol(market: "KR" | "US" | "CRYPTO", symbol: string) {
  const clean = symbol.trim();
  if (market === "US") return normalizeNaverReutersCode(clean);
  if (market === "CRYPTO") {
    const ticker = clean.toUpperCase()
      .replace(/^KRW-/, "")
      .replace(/_KRW_(?:UPBIT|BITHUMB)$/, "");
    return ticker ? `KRW-${ticker}` : "";
  }
  return clean.toUpperCase();
}

// Search endpoints may return the same US listing as NVDA, NVDA.O, or
// NVDA_O depending on the query and endpoint. Keep one identity for search,
// while retaining the original Reuters code for quote resolution.
export function usSearchTickerCore(symbol: string) {
  return symbol
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replaceAll("_", ".")
    .replace(US_REUTERS_SUFFIX, "");
}

export function naverAutocompleteQueryForForeignCode(code: string) {
  const clean = code.trim();
  return LOWERCASE_SUFFIX.test(clean) ? clean : clean.replaceAll("_", ".");
}

export function looksLikeCaseSensitiveReutersCode(code: string) {
  return LOWERCASE_SUFFIX.test(code.trim());
}
