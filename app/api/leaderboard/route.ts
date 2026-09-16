import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { persistQuoteSnapshot, type Market } from "@/lib/server/market-data";
import { getTradingQuote } from "@/lib/server/trading-quote";

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
      `SELECT DISTINCT i.id,i.market,i.symbol,i.exchange,q.received_at AS receivedAt
       FROM positions pos JOIN participants p ON p.id=pos.participant_id
       JOIN instruments i ON i.id=pos.instrument_id JOIN quote_snapshots q ON q.instrument_id=i.id
       WHERE p.competition_id=? AND pos.quantity_micros>0 AND q.received_at<?
       ORDER BY q.received_at ASC LIMIT 8`,
    ).bind(competitionId, staleBefore).all<{ id: string; market: Market; symbol: string; exchange: string; receivedAt: number }>();
    for (const instrument of stale.results) {
      const claim = await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
        .bind(refreshStartedAt, instrument.id, instrument.receivedAt).run();
      if ((claim.meta.changes ?? 0) !== 1) continue;
      try {
        const quote = await getTradingQuote(instrument.market, instrument.symbol, instrument.exchange);
        if (quote.stale) throw new Error("NAVER_STALE_QUOTE");
        await persistQuoteSnapshot(quote);
      } catch {
        await env.DB!.prepare("UPDATE quote_snapshots SET received_at=? WHERE instrument_id=? AND received_at=?")
          .bind(instrument.receivedAt, instrument.id, refreshStartedAt).run().catch(() => undefined);
        // The previous validated price stays in the ranking until Naver returns a fresh quote.
      }
    }
    const rows = await env.DB!.prepare(
      `SELECT p.id AS participantId,u.nickname,p.cash_krw AS cashKrw,p.realized_pnl_krw AS realizedPnlKrw,
              c.initial_cash_krw AS initialCashKrw,
              (SELECT COUNT(*) FROM fills f WHERE f.participant_id=p.id) AS fillCount,
              (SELECT COUNT(DISTINCT f.instrument_id) FROM fills f WHERE f.participant_id=p.id) AS tradedInstrumentCount,
              (SELECT GROUP_CONCAT(recent.symbol, ', ')
                 FROM (SELECT i2.symbol AS symbol FROM fills f2 JOIN instruments i2 ON i2.id=f2.instrument_id
                       WHERE f2.participant_id=p.id GROUP BY f2.instrument_id ORDER BY MAX(f2.executed_at) DESC LIMIT 3) recent
              ) AS recentSymbols,
              p.cash_krw + COALESCE(SUM((pos.quantity_micros / 1000000.0) * (q.price_micros / 1000000.0)),0) AS totalAssetKrw
       FROM participants p JOIN users u ON u.id=p.user_id JOIN competitions c ON c.id=p.competition_id
       LEFT JOIN positions pos ON pos.participant_id=p.id AND pos.quantity_micros>0
       LEFT JOIN quote_snapshots q ON q.instrument_id=pos.instrument_id
       WHERE p.competition_id=? GROUP BY p.id,u.nickname,p.cash_krw,p.realized_pnl_krw,c.initial_cash_krw
       ORDER BY totalAssetKrw DESC,p.joined_at ASC LIMIT 100`
    ).bind(competitionId).all();
    return Response.json({ leaderboard: rows.results.map((row, index) => ({
      ...row,
      rank: index + 1,
      unrealizedPnlKrw: Number(row.totalAssetKrw) - Number(row.initialCashKrw) - Number(row.realizedPnlKrw),
    })) });
  } catch (error) { return apiError(error); }
}
