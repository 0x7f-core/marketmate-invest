import { apiError, requireUser } from "@/lib/server/auth";
import { getCheckedMarketSession } from "@/lib/server/market-hours";
import type { Market } from "@/lib/server/market-data";
import { enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "market_status", 90, 60_000, user.id);
    const market = new URL(request.url).searchParams.get("market") as Market | null;
    if (!market || !["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "시장을 확인해주세요." }, { status: 400 });
    return Response.json({ market, ...await getCheckedMarketSession(market) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
