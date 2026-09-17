export type FillReturnKind = "current" | "realized";

type FillReturnInput = {
  instrumentId: string;
  side: "buy" | "sell";
  quantityMicros: number;
  priceMicros: number;
  fxRateMicros: number;
  feeKrw?: number | null;
  currentPriceKrwMicros?: number | null;
};

type PositionState = {
  quantityMicros: number;
  averagePriceKrwMicros: number;
};

function nativePriceToKrwMicros(priceMicros: number, fxRateMicros: number) {
  return Number((BigInt(Math.round(priceMicros)) * BigInt(Math.round(fxRateMicros)) + 500_000n) / 1_000_000n);
}

function feePerUnitKrwMicros(feeKrw: number, quantityMicros: number) {
  if (feeKrw <= 0 || quantityMicros <= 0) return 0;
  return Number((BigInt(Math.round(feeKrw)) * 1_000_000_000_000n) / BigInt(Math.round(quantityMicros)));
}

export function annotateFillReturns<T extends FillReturnInput>(fills: T[]) {
  const positions = new Map<string, PositionState>();

  return fills.map(fill => {
    const quantityMicros = Math.max(0, Math.round(fill.quantityMicros));
    const feeKrw = Math.max(0, Number(fill.feeKrw ?? 0));
    const priceKrwMicros = nativePriceToKrwMicros(fill.priceMicros, fill.fxRateMicros);
    const previous = positions.get(fill.instrumentId) ?? { quantityMicros: 0, averagePriceKrwMicros: 0 };

    let returnRate: number | null = null;
    const returnRateKind: FillReturnKind = fill.side === "buy" ? "current" : "realized";

    if (fill.side === "buy") {
      const buyCostPriceKrwMicros = priceKrwMicros + feePerUnitKrwMicros(feeKrw, quantityMicros);
      const currentPriceKrwMicros = Number(fill.currentPriceKrwMicros ?? 0);
      if (buyCostPriceKrwMicros > 0 && currentPriceKrwMicros > 0) {
        returnRate = ((currentPriceKrwMicros - buyCostPriceKrwMicros) / buyCostPriceKrwMicros) * 100;
      }

      const nextQuantityMicros = previous.quantityMicros + quantityMicros;
      const nextAveragePriceKrwMicros = nextQuantityMicros > 0
        ? Number(
            (BigInt(previous.quantityMicros) * BigInt(previous.averagePriceKrwMicros)
              + BigInt(quantityMicros) * BigInt(buyCostPriceKrwMicros))
            / BigInt(nextQuantityMicros),
          )
        : 0;
      positions.set(fill.instrumentId, {
        quantityMicros: nextQuantityMicros,
        averagePriceKrwMicros: nextAveragePriceKrwMicros,
      });
    } else {
      if (quantityMicros > 0 && previous.quantityMicros >= quantityMicros && previous.averagePriceKrwMicros > 0) {
        const costBasisKrw = Number(BigInt(quantityMicros) * BigInt(previous.averagePriceKrwMicros)) / 1_000_000_000_000;
        const grossRealizedKrw = Number(BigInt(quantityMicros) * BigInt(priceKrwMicros - previous.averagePriceKrwMicros)) / 1_000_000_000_000;
        const realizedKrw = grossRealizedKrw - feeKrw;
        if (costBasisKrw > 0) returnRate = (realizedKrw / costBasisKrw) * 100;
      }

      const nextQuantityMicros = Math.max(0, previous.quantityMicros - quantityMicros);
      positions.set(fill.instrumentId, {
        quantityMicros: nextQuantityMicros,
        averagePriceKrwMicros: nextQuantityMicros === 0 ? 0 : previous.averagePriceKrwMicros,
      });
    }

    return { ...fill, returnRate, returnRateKind };
  });
}
