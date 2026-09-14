import catalog from "@/data/instruments.json";
import { apiError, requireUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/safety";

type Market = "KR" | "US" | "CRYPTO";
type Instrument = { market: Market; symbol: string; name: string; exchange: string; currency: "KRW" | "USD" };

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "instrument_search", 120, 60_000, user.id);
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    const market = url.searchParams.get("market") as Market | null;
    if (query.length < 1 || query.length > 40) return Response.json({ instruments: [] });
    if (market && !["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "지원하지 않는 시장입니다." }, { status: 400 });

    const matches = (catalog as Instrument[]).filter(item => {
      if (market && item.market !== market) return false;
      return item.symbol.toLocaleLowerCase("en-US").includes(query) || item.name.toLocaleLowerCase("ko-KR").includes(query);
    }).sort((a, b) => {
      const aExact = a.symbol.toLocaleLowerCase("en-US") === query || a.name.toLocaleLowerCase("ko-KR") === query;
      const bExact = b.symbol.toLocaleLowerCase("en-US") === query || b.name.toLocaleLowerCase("ko-KR") === query;
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aStarts = a.symbol.toLocaleLowerCase("en-US").startsWith(query) || a.name.toLocaleLowerCase("ko-KR").startsWith(query);
      const bStarts = b.symbol.toLocaleLowerCase("en-US").startsWith(query) || b.name.toLocaleLowerCase("ko-KR").startsWith(query);
      return aStarts === bStarts ? a.name.localeCompare(b.name, "ko") : aStarts ? -1 : 1;
    }).slice(0, 20);

    return Response.json({ instruments: matches, totalCatalogSize: catalog.length }, { headers: { "cache-control": "private, max-age=30" } });
  } catch (error) { return apiError(error); }
}
