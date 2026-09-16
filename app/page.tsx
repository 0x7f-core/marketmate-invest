import CryptoSourceLabels from "./crypto-source-labels";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <CryptoSourceLabels />
      <TradingDashboard />
    </>
  );
}
