const LOWERCASE_SUFFIX = /_[a-z]+(?:\.|$)/;

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
  return market === "US" ? normalizeNaverReutersCode(clean) : clean.toUpperCase();
}

export function naverAutocompleteQueryForForeignCode(code: string) {
  const clean = code.trim();
  return LOWERCASE_SUFFIX.test(clean) ? clean : clean.replaceAll("_", ".");
}

export function looksLikeCaseSensitiveReutersCode(code: string) {
  return LOWERCASE_SUFFIX.test(code.trim());
}
