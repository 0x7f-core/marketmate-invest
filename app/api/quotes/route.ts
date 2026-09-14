import { getLiveQuote, type Market } from "@/lib/server/market-data";
import { apiError, requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") as Market | null;
    const exchange = url.searchParams.get("exchange") ?? undefined;
    const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).slice(0, 20);
    if (!market || !["KR", "US", "CRYPTO"].includes(market) || symbols.length === 0) {
      return Response.json({ error: "market과 symbols가 필요합니다." }, { status: 400 });
    }
    const results = await Promise.allSettled(symbols.map(symbol => getLiveQuote(market, symbol.toUpperCase(), symbols.length === 1 ? exchange : undefined)));
    const quotes = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (quotes.length === 0) return Response.json({ error: "실시간 시세를 불러오지 못했습니다." }, { status: 503 });
    return Response.json({ quotes, partial: quotes.length !== symbols.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
