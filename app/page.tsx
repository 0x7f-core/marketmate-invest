import CryptoSourceLabels from "./crypto-source-labels";
import MarketStatusClosedTime from "./market-status-closed-time";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <CryptoSourceLabels />
      <MarketStatusClosedTime />
      <TradingDashboard />
    </>
  );
}
