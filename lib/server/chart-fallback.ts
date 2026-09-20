import type { ChartPoint } from "@/lib/server/market-data";

export type ChartFallbackResult = {
  points: ChartPoint[];
  stale: boolean;
};

export type ChartFallbackAttempt = () => Promise<ChartFallbackResult | null>;

/**
 * Run chart data sources in one consistent order.
 *
 * An attempt is accepted only when it contains enough points to render more
 * than a single candle. Empty/partial responses and endpoint errors continue
 * to the next source. If every source fails with an error, the last error is
 * rethrown so the API route can return the normal chart error response.
 */
export async function runChartFallback(
  attempts: readonly ChartFallbackAttempt[],
  minimumPoints = 2,
): Promise<ChartFallbackResult> {
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && result.points.length >= minimumPoints) return result;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return { points: [], stale: false };
}
