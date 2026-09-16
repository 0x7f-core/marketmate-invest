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

const CURSOR = /^[A-Za-z0-9._~+=:/-]{1,512}$/;
const EXCHANGE = /^[A-Za-z0-9 ._-]{1,40}$/;
const DOMESTIC_RANKING_CATEGORIES = new Set(["industries", "themes", "groups"]);
const DOMESTIC_RANKING_SORTS = new Set(["changeRate", "marketCap"]);
const FOREIGN_FINANCE_SECTIONS = new Set(["summary", "finance", "ratios", "balance", "income", "cash"]);
const FINANCE_PERIODS = new Set(["annual", "quarter"]);
const CRYPTO_SORTS = new Set(["top", "up", "down", "marketValue"]);

function invalidOption(kind: MarketInsightKind, url: URL) {
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && !CURSOR.test(cursor)) return true;
  const exchange = url.searchParams.get("exchange");
  if (exchange !== null && !EXCHANGE.test(exchange)) return true;

  const category = url.searchParams.get("category");
  const sort = url.searchParams.get("sort");
  const section = url.searchParams.get("section");
  const period = url.searchParams.get("period");

  if (kind === "domestic-ranking") {
    if (category !== null && !DOMESTIC_RANKING_CATEGORIES.has(category)) return true;
    if (sort !== null && !DOMESTIC_RANKING_SORTS.has(sort)) return true;
  }
  if (kind === "foreign-finance") {
    if (section !== null && !FOREIGN_FINANCE_SECTIONS.has(section)) return true;
    if (period !== null && !FINANCE_PERIODS.has(period)) return true;
  }
  if (kind === "foreign-sector-ranking" && sort !== null && !DOMESTIC_RANKING_SORTS.has(sort)) return true;
  if (kind === "crypto-ranking" && sort !== null && !CRYPTO_SORTS.has(sort)) return true;
  return false;
}

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
    if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 100)) {
      return Response.json({ error: "size는 1~100 사이의 정수여야 합니다." }, { status: 400 });
    }
    if (invalidOption(kind, url)) {
      return Response.json({ error: "요청한 시장 데이터의 옵션을 확인해주세요." }, { status: 400 });
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
