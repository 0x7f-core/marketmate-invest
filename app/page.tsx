import DeferredEnhancers from "./deferred-enhancers";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <TradingDashboard />
      <DeferredEnhancers />
    </>
  );
}
