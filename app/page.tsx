import ActivityPriceDetails from "./activity-price-details";
import ActivityQuantityUnits from "./activity-quantity-units";
import CryptoSourceLabels from "./crypto-source-labels";
import DesktopNavLabel from "./desktop-nav-label";
import DesktopSearchFavorites from "./desktop-search-favorites";
import HomeDashboardOrder from "./home-dashboard-order";
import HomeIndexBoard from "./home-index-board";
import HomeMarketNews from "./home-market-news";
import HomeMarketRankingLogos from "./home-market-ranking-logos";
import HomeMarketRankings from "./home-market-rankings";
import MarketStatusClosedTime from "./market-status-closed-time";
import MobileInstrumentSearch from "./mobile-instrument-search";
import PortfolioAveragePrices from "./portfolio-average-prices";
import PortfolioBulkSell from "./portfolio-bulk-sell";
import QuoteIdentityGuard from "./quote-identity-guard";
import TradingFeeGuide from "./trading-fee-guide";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <ActivityPriceDetails />
      <ActivityQuantityUnits />
      <CryptoSourceLabels />
      <DesktopNavLabel />
      <DesktopSearchFavorites />
      <MarketStatusClosedTime />
      <MobileInstrumentSearch />
      <PortfolioAveragePrices />
      <PortfolioBulkSell />
      <QuoteIdentityGuard />
      <TradingFeeGuide />
      <HomeIndexBoard />
      <HomeMarketNews />
      <HomeMarketRankingLogos />
      <HomeMarketRankings />
      <HomeDashboardOrder />
      <TradingDashboard />
    </>
  );
}
