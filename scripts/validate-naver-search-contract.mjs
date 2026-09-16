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

if (!source.includes('/KOR|KOREA|대한민국/i.test(nation)')) {
  failures.push("domestic nationCode/nationName classification is missing");
}

if (!source.includes('/KOSPI|KOSDAQ|KRX|NXT|국내|코스피|코스닥/i.test(`${exchange} ${type}`)')) {
  failures.push("domestic typeCode/typeName classification is missing");
}

const domesticIndex = source.indexOf('return "KR";');
const genericReutersUsIndex = source.indexOf('if (reuters && looksLikeCaseSensitiveReutersCode(reuters)) return "US";');
if (domesticIndex < 0 || genericReutersUsIndex < 0 || domesticIndex > genericReutersUsIndex) {
  failures.push("domestic autocomplete classification must run before generic Reuters-code US fallback");
}

if (!source.includes('if (/^[A-Za-z0-9]{6}$/.test(code)) return "KR";')) {
  failures.push("six-character domestic code fallback is missing");
}

if (!source.includes('const exchangeRaw = text(record, ["exchangeName", "exchangeType", "exchange", "marketName", "marketType", "typeCode", "typeName", "nationType"]);')) {
  failures.push("autocomplete exchange normalization must retain typeCode/typeName support");
}

if (failures.length) {
  console.error("Naver search contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Naver search contract validation passed.");
