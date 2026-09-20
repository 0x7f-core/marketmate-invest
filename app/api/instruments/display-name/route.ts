import { apiError, requireUser } from "@/lib/server/auth";
import { resolveUsDisplayName } from "@/lib/server/market-search";
import { enforceRateLimit } from "@/lib/server/safety";

const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "instrument_display_name", 120, 60_000, user.id);
    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") ?? "").normalize("NFKC").trim();
    const exchange = (url.searchParams.get("exchange") ?? "").normalize("NFKC").trim().slice(0, 30);
    const fallback = (url.searchParams.get("fallback") ?? "").normalize("NFKC").trim().slice(0, 120);
    if (!SYMBOL_PATTERN.test(symbol)) return Response.json({ error: "종목 코드가 올바르지 않습니다." }, { status: 400 });

    const name = await resolveUsDisplayName(symbol, exchange, fallback || symbol);
    return Response.json({ market: "US", symbol, name }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    return apiError(error);
  }
}
