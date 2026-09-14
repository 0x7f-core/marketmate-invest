import { unzipSync } from "fflate";
import { writeFile } from "node:fs/promises";

const KIS_MASTER_ROOT = "https://new.real.download.dws.co.kr/common/master";
const sources = [
  { key: "kospi", url: `${KIS_MASTER_ROOT}/kospi_code.mst.zip`, market: "KR", exchange: "KOSPI", format: "domestic" },
  { key: "kosdaq", url: `${KIS_MASTER_ROOT}/kosdaq_code.mst.zip`, market: "KR", exchange: "KOSDAQ", format: "domestic" },
  { key: "nas", url: `${KIS_MASTER_ROOT}/nasmst.cod.zip`, market: "US", exchange: "NAS", format: "overseas" },
  { key: "nys", url: `${KIS_MASTER_ROOT}/nysmst.cod.zip`, market: "US", exchange: "NYS", format: "overseas" },
  { key: "ams", url: `${KIS_MASTER_ROOT}/amsmst.cod.zip`, market: "US", exchange: "AMS", format: "overseas" },
];

const decoder = new TextDecoder("euc-kr");

async function downloadZip(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const first = Object.values(files)[0];
  if (!first) throw new Error(`${url}: empty archive`);
  return first;
}

function parseDomestic(bytes, exchange) {
  return decoder.decode(bytes).split(/\r?\n/).flatMap(line => {
    const symbol = line.slice(0, 9).trim();
    const nameEnd = Math.max(21, line.length - (exchange === "KOSPI" ? 228 : 222));
    const name = line.slice(21, nameEnd).trim();
    if (!/^[0-9A-Z]{6}$/.test(symbol) || !name) return [];
    return [{ market: "KR", symbol, name, exchange, currency: "KRW" }];
  });
}

function parseOverseas(bytes, exchange) {
  return decoder.decode(bytes).split(/\r?\n/).flatMap(line => {
    const fields = line.split("\t");
    const symbol = fields[4]?.trim();
    const koreanName = fields[6]?.trim();
    const englishName = fields[7]?.trim();
    const securityType = fields[8]?.trim();
    if (!symbol || !["2", "3"].includes(securityType)) return [];
    return [{ market: "US", symbol, name: koreanName || englishName || symbol, exchange, currency: "USD" }];
  });
}

async function upbitMarkets() {
  const response = await fetch("https://api.upbit.com/v1/market/all?is_details=false", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Upbit: HTTP ${response.status}`);
  const rows = await response.json();
  return rows.flatMap(row => row.market?.startsWith("KRW-")
    ? [{ market: "CRYPTO", symbol: row.market, name: row.korean_name || row.english_name || row.market, exchange: "UPBIT", currency: "KRW" }]
    : []);
}

const groups = await Promise.all(sources.map(async source => {
  const bytes = await downloadZip(source.url);
  return source.format === "domestic" ? parseDomestic(bytes, source.exchange) : parseOverseas(bytes, source.exchange);
}));
groups.push(await upbitMarkets());

const seen = new Set();
const catalog = groups.flat().filter(item => {
  const key = `${item.market}:${item.symbol}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a, b) => a.market.localeCompare(b.market) || a.symbol.localeCompare(b.symbol));

await writeFile(new URL("../data/instruments.json", import.meta.url), `${JSON.stringify(catalog)}\n`);
const counts = Object.groupBy(catalog, item => item.market);
console.log(JSON.stringify({ total: catalog.length, KR: counts.KR?.length ?? 0, US: counts.US?.length ?? 0, CRYPTO: counts.CRYPTO?.length ?? 0 }));
