import { apiError, requireUser } from "@/lib/server/auth";
import { getTrackedMarketIndexDetail, isTrackedMarketIndexId } from "@/lib/server/market-data";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { enforceRateLimit } from "@/lib/server/safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "index-detail", 120, 60_000, user.id);
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") ?? "").toUpperCase();
    if (!isTrackedMarketIndexId(id)) {
      return Response.json({ error: "지수 요청값을 확인해주세요." }, { status: 400 });
    }
    const quote = await getTrackedMarketIndexDetail(id);
    if (quote.stale) {
      return Response.json(
        { error: "네이버증권 최신 지수 시세 갱신이 지연되고 있습니다.", source: "NAVER", stale: true },
        { status: 503, headers: { "retry-after": "10", "cache-control": "no-store" } },
      );
    }
    return Response.json(
      { quote, source: "NAVER" },
      { headers: { "cache-control": "private, max-age=2" } },
    );
  } catch (error) {
    if (isNaverStockUnavailable(error) || (error instanceof Error && error.message === "NAVER_EMPTY_INDEX")) {
      return Response.json(
        { error: "네이버증권 지수 시세를 불러오지 못했습니다.", source: "NAVER" },
        { status: 503, headers: { "retry-after": "10", "cache-control": "no-store" } },
      );
    }
    return apiError(error);
  }
}
