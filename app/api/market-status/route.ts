import { apiError, requireUser } from "@/lib/server/auth";
import type { Market } from "@/lib/server/market-data";
import { getCheckedMarketSession } from "@/lib/server/market-hours";
import { getResponsiveMarketSession } from "@/lib/server/market-session-ui";
import { enforceRateLimit } from "@/lib/server/safety";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "market_status", 90, 60_000, user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    if (!market || !["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "시장을 확인해주세요." }, { status: 400 });
    const live = url.searchParams.get("live") === "1";
    const session = live ? await getCheckedMarketSession(market) : await getResponsiveMarketSession(market);
    return Response.json({ market, ...session }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
