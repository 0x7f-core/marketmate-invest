import ActivityQuantityUnits from "./activity-quantity-units";
import CryptoSourceLabels from "./crypto-source-labels";
import DesktopNavLabel from "./desktop-nav-label";
import HomeDashboardOrder from "./home-dashboard-order";
import HomeMarketNews from "./home-market-news";
import HomeMarketRankingLogos from "./home-market-ranking-logos";
import HomeMarketRankings from "./home-market-rankings";
import MarketStatusClosedTime from "./market-status-closed-time";
import PortfolioBulkSell from "./portfolio-bulk-sell";
import QuoteIdentityGuard from "./quote-identity-guard";
import TradingFeeGuide from "./trading-fee-guide";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <ActivityQuantityUnits />
      <CryptoSourceLabels />
      <DesktopNavLabel />
      <MarketStatusClosedTime />
      <PortfolioBulkSell />
      <QuoteIdentityGuard />
      <TradingFeeGuide />
      <HomeMarketNews />
      <HomeMarketRankingLogos />
      <HomeMarketRankings />
      <HomeDashboardOrder />
      <TradingDashboard />
    </>
  );
}