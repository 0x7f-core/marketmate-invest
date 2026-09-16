import { apiError, requireUser } from "@/lib/server/auth";
import { searchNaverMarket } from "@/lib/server/market-search";
import { naverJson } from "@/lib/server/naver-stock";

const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const NAVER_LOGO_ORIGIN = "https://ssl.pstatic.net";
const NAVER_LOGO_PREFIX = "/imgstock/fn/";

type NaverBasic = {
  reutersCode?: string;
  itemLogoUrl?: string;
  itemLogoPngUrl?: string;
  stockEndType?: string;
  isEtf?: boolean;
  isEtfAmerica?: boolean;
};

function cleanSymbol(value: string) {
  const symbol = value.normalize("NFKC").trim();
  return SYMBOL_PATTERN.test(symbol) ? symbol : "";
}

function safeLogoUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== NAVER_LOGO_ORIGIN || !url.pathname.startsWith(NAVER_LOGO_PREFIX)) return "";
    return url.href;
  } catch {
    return "";
  }
}

async function loadBasic(symbol: string) {
  const result = await naverJson<NaverBasic>(
    `/api/securityService/stock/${symbol}/basic`,
    { ttlMs: 24 * 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 },
  );
  return result.data;
}

function comparableTicker(symbol: string) {
  return symbol.toUpperCase().replace(/\.[A-Z]$/, "");
}

async function resolveCanonicalSymbol(symbol: string) {
  const search = await searchNaverMarket(symbol, "US");
  const wanted = symbol.toUpperCase();
  const wantedTicker = comparableTicker(symbol);
  const exact = search.instruments.find(item => item.symbol.toUpperCase() === wanted);
  const sameTicker = search.instruments.find(item => comparableTicker(item.symbol) === wantedTicker);
  return (exact ?? sameTicker ?? search.instruments[0])?.symbol ?? "";
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const symbol = cleanSymbol(url.searchParams.get("symbol") ?? "");
    if (!symbol) return new Response(null, { status: 404 });

    let basic: NaverBasic | null = null;
    try {
      basic = await loadBasic(symbol);
    } catch {
      const canonical = cleanSymbol(await resolveCanonicalSymbol(symbol));
      if (canonical && canonical.toUpperCase() !== symbol.toUpperCase()) basic = await loadBasic(canonical);
    }

    let logo = safeLogoUrl(basic?.itemLogoUrl);
    if (!logo) logo = safeLogoUrl(basic?.itemLogoPngUrl);
    if (!logo) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=300" } });

    return new Response(null, {
      status: 302,
      headers: {
        location: logo,
        "cache-control": "private, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
