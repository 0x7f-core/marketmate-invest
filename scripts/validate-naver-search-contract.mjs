import { readFile } from "node:fs/promises";
import { join } from "node:path";

const source = await readFile(join(process.cwd(), "lib/server/market-search.ts"), "utf8");
const failures = [];

for (const field of ["typeCode", "typeName", "nationCode", "nationName", "reutersCode"]) {
  if (!source.includes(`\"${field}\"`)) failures.push(`Naver autocomplete field is not handled: ${field}`);
}

if (!source.includes('/^\\/domestic\\//i.test(url)')) {
  failures.push("domestic autocomplete URL fallback is missing");
}

if (!source.includes("classifySupportedNation") || !source.includes('if (nationKind === "FOREIGN") return null;')) {
  failures.push("unsupported foreign nation metadata must be rejected before market classification");
}
if (!source.includes('if (nationKind === "KR") return "KR";') || !source.includes('if (nationKind === "US") return "US";')) {
  failures.push("KR/US nation metadata classification is missing");
}

if (!source.includes('/KOSPI|KOSDAQ|KRX|NXT|국내|코스피|코스닥/i.test(`${exchange} ${type}`)')) {
  failures.push("domestic typeCode/typeName classification is missing");
}

const foreignNationIndex = source.indexOf('if (nationKind === "FOREIGN") return null;');
const genericReutersIndex = source.indexOf("looksLikeCaseSensitiveReutersCode(reuters)");
if (foreignNationIndex < 0 || genericReutersIndex < 0 || foreignNationIndex > genericReutersIndex) {
  failures.push("foreign nation rejection must run before generic Reuters-code fallbacks");
}

if (!source.includes('if (/^[A-Za-z0-9]{6}$/.test(code)) return "KR";')) {
  failures.push("six-character domestic code fallback is missing");
}

if (!source.includes('const exchangeRaw = text(record, ["exchangeName", "exchangeType", "exchange", "marketName", "marketType", "typeCode", "typeName", "nationType"]);')) {
  failures.push("autocomplete exchange normalization must retain typeCode/typeName support");
}

if (!source.includes('normalizeSupportedExchange("US", exchange)') || !source.includes("hasUnsupportedForeignReutersSuffix(reuters)")) {
  failures.push("US classification must reject non-US exchanges and known foreign Reuters suffixes");
}
if (!source.includes("normalizeSupportedExchange(market, exchangeRaw)")) {
  failures.push("normalized search results must use the shared supported-exchange policy");
}

if (!source.includes("const initialSearch = hasHangulInitialQuery(query);")) {
  failures.push("Hangul initial-consonant searches must be enabled for every supported market");
}
if (!source.includes("if (initialSearch && koreanPatternIndex(item.name, query) < 0) continue;")) {
  failures.push("initial-consonant matching must apply to KR, US, and CRYPTO results");
}
if (!source.includes("const patternIndex = koreanPatternIndex(item.name, query);")) {
  failures.push("initial-consonant results must use the shared ranking path for every market");
}

if (failures.length) {
  console.error("Naver search contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Naver search contract validation passed.");
