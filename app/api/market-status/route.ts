import { apiError, requireUser } from "@/lib/server/auth";
import { getMarketSession } from "@/lib/server/market-hours";
import type { Market } from "@/lib/server/market-data";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const market = new URL(request.url).searchParams.get("market") as Market | null;
    if (!market || !["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "시장을 확인해주세요." }, { status: 400 });
    return Response.json({ market, ...getMarketSession(market) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
