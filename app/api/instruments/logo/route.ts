import { apiError, requireUser } from "@/lib/server/auth";
import { searchNaverMarket } from "@/lib/server/market-search";
import { naverJson } from "@/lib/server/naver-stock";

const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const NAVER_LOGO_ORIGIN = "https://ssl.pstatic.net";
const NAVER_LOGO_PREFIX = "/imgstock/fn/";
const NAVER_STOCK_LOGO_BASE = "https://ssl.pstatic.net/imgstock/fn/real/logo/stock/";

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

function logoFromBasic(basic: NaverBasic | null) {
  return safeLogoUrl(basic?.itemLogoUrl) || safeLogoUrl(basic?.itemLogoPngUrl);
}

function directStockLogo(symbol: string) {
  const code = cleanSymbol(symbol);
  return code ? safeLogoUrl(`${NAVER_STOCK_LOGO_BASE}Stock${code}.svg`) : "";
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

function redirectLogo(logo: string) {
  return new Response(null, {
    status: 302,
    headers: {
      location: logo,
      "cache-control": "private, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const symbol = cleanSymbol(url.searchParams.get("symbol") ?? "");
    if (!symbol) return new Response(null, { status: 404 });

    let basic: NaverBasic | null = null;
    let resolvedSymbol = symbol;
    let logo = "";

    // Some Naver endpoints accept a plain ticker while others require the
    // Reuters code. Always try the stored value first so legacy rows keep
    // working without a migration.
    try {
      basic = await loadBasic(symbol);
      logo = logoFromBasic(basic);
      const reuters = cleanSymbol(basic.reutersCode ?? "");
      if (reuters) resolvedSymbol = reuters;
    } catch {
      // Canonical resolution below handles ticker-only rows.
    }

    // A successful /basic response may still omit itemLogoUrl. This is common
    // enough that canonical resolution must run on an empty logo too, not only
    // when /basic throws. Autocomplete's reutersCode is Naver's canonical key.
    if (!logo) {
      let canonical = "";
      try {
        canonical = cleanSymbol(await resolveCanonicalSymbol(symbol));
      } catch {
        canonical = "";
      }
      if (canonical) {
        resolvedSymbol = canonical;
        if (!basic || canonical.toUpperCase() !== symbol.toUpperCase()) {
          try {
            basic = await loadBasic(canonical);
            logo = logoFromBasic(basic);
            const reuters = cleanSymbol(basic.reutersCode ?? "");
            if (reuters) resolvedSymbol = reuters;
          } catch {
            // Common-stock SVG fallback below still has a chance to resolve.
          }
        }
      }
    }

    // Metadata-first resolution preserves Naver's three US visual schemes:
    // company CI, ETF issuer branding, and dedicated leverage/inverse icons.
    if (logo) return redirectLogo(logo);

    const fallback = directStockLogo(cleanSymbol(basic?.reutersCode ?? "") || resolvedSymbol);
    if (fallback) return redirectLogo(fallback);

    return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    return apiError(error);
  }
}
