import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import type { Market } from "@/lib/server/market-data";
import { enforceRateLimit } from "@/lib/server/safety";

const RANGE_MS: Record<string, number> = { "1D": 86_400_000, "1W": 7 * 86_400_000, "1M": 31 * 86_400_000, "3M": 93 * 86_400_000, "1Y": 366 * 86_400_000 };

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "chart", 90, 60_000, user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
    const range = url.searchParams.get("range") ?? "1D";
    if (!market || !["KR","US","CRYPTO"].includes(market) || !/^[A-Z0-9._-]{1,20}$/.test(symbol) || !RANGE_MS[range]) return Response.json({ error:"차트 요청값을 확인해주세요." }, { status:400 });
    const since = Date.now() - RANGE_MS[range];
    const result = await env.DB!.prepare(`SELECT price_micros AS priceMicros,change_rate_ppm AS changeRatePpm,recorded_at AS recordedAt
      FROM price_history WHERE instrument_id=? AND recorded_at>=? ORDER BY recorded_at ASC LIMIT 720`)
      .bind(`${market}:${symbol}`, since).all();
    return Response.json({ points:result.results, range }, { headers:{"cache-control":"no-store"} });
  } catch (error) { return apiError(error); }
}
