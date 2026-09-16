import { apiError, requireUser } from "@/lib/server/auth";
import { getNaverMarketInsight, type MarketInsightKind } from "@/lib/server/naver-market-insights";
import { isNaverStockUnavailable } from "@/lib/server/naver-stock";
import { enforceRateLimit } from "@/lib/server/safety";

const KINDS = new Set<MarketInsightKind>([
  "domestic-detail",
  "domestic-price",
  "domestic-investor",
  "domestic-broker",
  "domestic-disclosure",
  "domestic-consensus",
  "domestic-finance-menu",
  "domestic-esg",
  "domestic-etf-list",
  "domestic-etf-detail",
  "domestic-etf-components",
  "domestic-ranking",
  "foreign-basic",
  "foreign-overview",
  "foreign-consensus",
  "foreign-finance",
  "foreign-etf-list",
  "foreign-etf-components",
  "foreign-sector-ranking",
  "crypto-ranking",
  "indicators",
]);

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "market_insights", 90, 60_000, user.id);

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as MarketInsightKind | null;
    if (!kind || !KINDS.has(kind)) {
      return Response.json({ error: "지원하지 않는 네이버증권 데이터 종류입니다." }, { status: 400 });
    }

    const sizeRaw = url.searchParams.get("size");
    const size = sizeRaw === null ? undefined : Number(sizeRaw);
    if (size !== undefined && (!Number.isFinite(size) || size < 1 || size > 100)) {
      return Response.json({ error: "size는 1~100 사이여야 합니다." }, { status: 400 });
    }

    const result = await getNaverMarketInsight(kind, {
      code: url.searchParams.get("code") ?? undefined,
      symbol: url.searchParams.get("symbol") ?? undefined,
      exchange: url.searchParams.get("exchange") ?? undefined,
      section: url.searchParams.get("section") ?? undefined,
      period: url.searchParams.get("period") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      size,
      indicatorCodes: url.searchParams.get("indicatorCodes") ?? undefined,
    });

    return Response.json(result, { headers: { "cache-control": "private, max-age=15" } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return Response.json({ error: "요청한 시장 데이터의 식별자 또는 옵션을 확인해주세요." }, { status: 400 });
    }
    if (isNaverStockUnavailable(error)) {
      return Response.json(
        { error: "네이버증권 시장 데이터를 불러오지 못했습니다.", source: "NAVER" },
        { status: 503, headers: { "retry-after": "30" } },
      );
    }
    return apiError(error);
  }
}
