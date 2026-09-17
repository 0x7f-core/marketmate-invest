import type { Market } from "@/lib/server/market-data";

export type TradingSide = "buy" | "sell";
export type DomesticSecurityType = "STOCK" | "ETF" | "ETN" | "ELW" | "UNKNOWN";

export const TRADING_COST_PPM = {
  KR_KRX_COMMISSION: 150, // 0.015%
  KR_NXT_COMMISSION: 145, // 0.0145%
  KR_SELL_TAX: 2_000, // 0.20%
  US_COMMISSION: 700, // 0.07% promotional rate requested for the simulation
  UPBIT_KRW_COMMISSION: 500, // 0.05%
} as const;

const DOMESTIC_TRANSACTION_TAX_EXEMPT = new Set<DomesticSecurityType>(["ETF", "ETN", "ELW"]);

function chargeKrw(tradeValueKrw: number, ppm: number) {
  const value = Math.max(0, Math.trunc(tradeValueKrw));
  if (!value || !ppm) return 0;
  return Number((BigInt(value) * BigInt(ppm)) / 1_000_000n);
}

export function commissionPpm(market: Market, exchange?: string | null) {
  if (market === "US") return TRADING_COST_PPM.US_COMMISSION;
  if (market === "CRYPTO") return TRADING_COST_PPM.UPBIT_KRW_COMMISSION;
  return String(exchange ?? "").toUpperCase() === "NXT"
    ? TRADING_COST_PPM.KR_NXT_COMMISSION
    : TRADING_COST_PPM.KR_KRX_COMMISSION;
}

export function calculateTradingCosts({
  market,
  exchange,
  side,
  tradeValueKrw,
  securityType,
}: {
  market: Market;
  exchange?: string | null;
  side: TradingSide;
  tradeValueKrw: number;
  securityType?: DomesticSecurityType | null;
}) {
  const commissionRatePpm = commissionPpm(market, exchange);
  const taxExempt = market === "KR" && DOMESTIC_TRANSACTION_TAX_EXEMPT.has(securityType ?? "UNKNOWN");
  const taxRatePpm = market === "KR" && side === "sell" && !taxExempt ? TRADING_COST_PPM.KR_SELL_TAX : 0;
  const commissionKrw = chargeKrw(tradeValueKrw, commissionRatePpm);
  const taxKrw = chargeKrw(tradeValueKrw, taxRatePpm);
  return {
    commissionRatePpm,
    taxRatePpm,
    commissionKrw,
    taxKrw,
    totalCostKrw: commissionKrw + taxKrw,
  };
}

export function buySettlementKrw(market: Market, exchange: string | null | undefined, tradeValueKrw: number) {
  return tradeValueKrw + calculateTradingCosts({ market, exchange, side: "buy", tradeValueKrw }).totalCostKrw;
}
