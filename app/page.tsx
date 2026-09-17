import CryptoSourceLabels from "./crypto-source-labels";
import HomeMarketNews from "./home-market-news";
import HomeMarketRankingLogos from "./home-market-ranking-logos";
import HomeMarketRankings from "./home-market-rankings";
import MarketStatusClosedTime from "./market-status-closed-time";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <CryptoSourceLabels />
      <MarketStatusClosedTime />
      <HomeMarketNews />
      <HomeMarketRankingLogos />
      <HomeMarketRankings />
      <TradingDashboard />
    </>
  );
}
