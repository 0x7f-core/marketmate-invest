import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { getTradingQuote } from "@/lib/server/trading-quote";
import { getUsListingExchange } from "@/lib/server/us-listing-exchange";

type StaleInstrument = {
  id: string;
  market: Market;
  symbol: string;
  exchange: string;
  receivedAt: number;
};

async function refreshLeaderboardQuote(instrument: StaleInstrument, refreshStartedAt: number) {
  let claimed = false;
  if (instrument.receivedAt > 0) {
    const claim = await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
      .bind(refreshStartedAt, instrument.id, instrument.receivedAt).run();
    if ((claim.meta.changes ?? 0) !== 1) return;
    claimed = true;
  }

  try {
    const usListing = instrument.market === "US"
      ? await getUsListingExchange(instrument.symbol, instrument.exchange)
      : "";
    const quote = await getTradingQuote(instrument.market, instrument.symbol, usListing || instrument.exchange);
    if (quote.stale) throw new Error("NAVER_STALE_QUOTE");
    if (instrument.market === "KR" && quote.venue) {
      await env.DB!.prepare("UPDATE instruments SET exchange=? WHERE id=?").bind(quote.venue, instrument.id).run();
    } else if (instrument.market === "US" && usListing && usListing !== instrument.exchange) {
      await env.DB!.prepare("UPDATE instruments SET exchange=? WHERE id=?").bind(usListing, instrument.id).run();
    }
    await persistQuoteSnapshot(quote);
  } catch {
    if (claimed) {
      await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
        .bind(instrument.receivedAt, instrument.id, refreshStartedAt).run().catch(() => undefined);
    }
    // Existing snapshots remain untouched; a never-priced position is marked incomplete below.
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const competitionId = new URL(request.url).searchParams.get("competitionId");
    if (!competitionId) return Response.json({ error: "competitionId가 필요합니다." }, { status: 400 });
    const member = await env.DB!.prepare("SELECT 1 FROM participants WHERE competition_id=? AND user_id=?").bind(competitionId, user.id).first();
    if (!member) throw new Error("FORBIDDEN");

    const refreshStartedAt = Date.now();
    const staleBefore = refreshStartedAt - 15_000;
    const stale = await env.DB!.prepare(
      `SELECT DISTINCT i.id,i.market,i.symbol,i.exchange,COALESCE(q.received_at,0) AS receivedAt
       FROM positions pos JOIN participants p ON p.id=pos.participant_id
       JOIN instruments i ON i.id=pos.instrument_id LEFT JOIN quote_snapshots q ON q.instrument_id=i.id
       WHERE p.competition_id=? AND pos.quantity_micros>0 AND (q.received_at IS NULL OR q.received_at<?)
       ORDER BY COALESCE(q.received_at,0) ASC LIMIT 8`,
    ).bind(competitionId, staleBefore).all<StaleInstrument>();

    await Promise.allSettled(stale.results.map(instrument => refreshLeaderboardQuote(instrument, refreshStartedAt)));

    const rows = await env.DB!.prepare(
      `SELECT p.id AS participantId,u.nickname,p.joined_at AS joinedAt,p.cash_krw AS cashKrw,p.realized_pnl_krw AS realizedPnlKrw,
              c.initial_cash_krw AS initialCashKrw,
              (SELECT COUNT(*) FROM fills f WHERE f.participant_id=p.id) AS fillCount,
              (SELECT COUNT(DISTINCT f.instrument_id) FROM fills f WHERE f.participant_id=p.id) AS tradedInstrumentCount,
              (SELECT GROUP_CONCAT(holding.label, ', ')
                 FROM (
                   SELECT CASE WHEN i2.market='KR' THEN i2.name ELSE i2.symbol END AS label
                   FROM positions pos2
                   JOIN instruments i2 ON i2.id=pos2.instrument_id
                   LEFT JOIN quote_snapshots q2 ON q2.instrument_id=pos2.instrument_id
                   WHERE pos2.participant_id=p.id AND pos2.quantity_micros>0
                   ORDER BY (pos2.quantity_micros / 1000000.0) * (COALESCE(q2.price_micros,pos2.average_price_micros) / 1000000.0) DESC,
                            pos2.updated_at DESC
                   LIMIT 3
                 ) holding
              ) AS recentSymbols,
              COALESCE(SUM(CASE WHEN pos.id IS NOT NULL AND q.price_micros IS NULL THEN 1 ELSE 0 END),0) AS pricingIncomplete,
              p.cash_krw + COALESCE(SUM((pos.quantity_micros / 1000000.0) * (COALESCE(q.price_micros,pos.average_price_micros) / 1000000.0)),0) AS totalAssetKrw
       FROM participants p JOIN users u ON u.id=p.user_id JOIN competitions c ON c.id=p.competition_id
       LEFT JOIN positions pos ON pos.participant_id=p.id AND pos.quantity_micros>0
       LEFT JOIN quote_snapshots q ON q.instrument_id=pos.instrument_id
       WHERE p.competition_id=?
       GROUP BY p.id,u.nickname,p.joined_at,p.cash_krw,p.realized_pnl_krw,c.initial_cash_krw
       ORDER BY totalAssetKrw DESC,p.joined_at ASC LIMIT 100`
    ).bind(competitionId).all();
    const topPicks = await env.DB!.prepare(
      `SELECT i.market,i.symbol,i.name,i.exchange,i.currency,
              COUNT(DISTINCT pos.participant_id) AS holderCount,
              COALESCE(SUM(
                (pos.quantity_micros / 1000000.0) *
                (COALESCE(q.price_micros,pos.average_price_micros) / 1000000.0)
              ),0) AS totalMarketValueKrw
       FROM positions pos
       JOIN participants p ON p.id=pos.participant_id
       JOIN instruments i ON i.id=pos.instrument_id
       LEFT JOIN quote_snapshots q ON q.instrument_id=pos.instrument_id
       WHERE p.competition_id=? AND pos.quantity_micros>0
       GROUP BY i.id,i.market,i.symbol,i.name,i.exchange,i.currency
       HAVING COUNT(DISTINCT pos.participant_id)>=2
       ORDER BY holderCount DESC,totalMarketValueKrw DESC,i.name ASC
       LIMIT 10`
    ).bind(competitionId).all();

    return Response.json({
      leaderboard: rows.results.map((row, index) => ({
        ...row,
        rank: index + 1,
        pricingIncomplete: Number(row.pricingIncomplete ?? 0),
        unrealizedPnlKrw: Number(row.totalAssetKrw) - Number(row.initialCashKrw) - Number(row.realizedPnlKrw),
      })),
      topPicks: topPicks.results.map((row, index) => ({
        ...row,
        rank: index + 1,
        holderCount: Number(row.holderCount ?? 0),
        totalMarketValueKrw: Number(row.totalMarketValueKrw ?? 0),
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
