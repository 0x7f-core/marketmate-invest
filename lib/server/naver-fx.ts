import { buildNaverPath, naverJson } from "@/lib/server/naver-stock";

type Row = Record<string, unknown>;

function numberValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "string" ? Number(value.replace(/[,%원$]/g, "").trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringValue(record: Row, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function collect(value: unknown, depth = 0, output: Row[] = []) {
  if (depth > 5 || output.length > 100 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  const record = value as Row;
  if (Object.keys(record).some(key => /(?:item|code|symbol|price|value)/i.test(key))) output.push(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") collect(child, depth + 1, output);
  return output;
}

export async function getNaverUsdKrwRate() {
  const result = await naverJson<unknown>(
    buildNaverPath("/api/securityService/integration/indicators", { indicatorCodes: "FX_USDKRW" }),
    { ttlMs: 30_000, staleMs: 10 * 60_000 },
  );
  const rows = collect(result.data);
  const exact = rows.find(row => stringValue(row, ["itemCode", "code", "symbol"]) === "FX_USDKRW") ?? rows[0];
  const rate = exact ? numberValue(exact.currentPrice, exact.closePrice, exact.price, exact.value, exact.nowPrice) : 0;
  if (rate <= 0) throw new Error("NAVER_FX_UNAVAILABLE");
  const change = exact ? numberValue(
    exact.fluctuations,
    exact.compareToPreviousClosePrice,
    exact.compareToPreviousPrice,
    exact.changePrice,
    exact.changeValue,
    exact.priceChange,
    exact.change,
    exact.netChange,
    exact.prevChange,
  ) : 0;
  const changeRate = exact ? numberValue(
    exact.fluctuationsRatio,
    exact.changeRate,
    exact.changeRatio,
    exact.prevChangeRate,
  ) : 0;
  return { rate, change, changeRate, stale: result.stale, fetchedAt: result.fetchedAt };
}
