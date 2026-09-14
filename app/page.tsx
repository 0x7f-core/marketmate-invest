import { headers } from "next/headers";
import TradingDashboard from "./trading-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const h = await headers();
  const email = h.get("oai-authenticated-user-email") ?? "guest@marketmate.local";
  const encodedName = h.get("oai-authenticated-user-full-name");
  const name =
    encodedName &&
    h.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? decodeURIComponent(encodedName)
      : email.split("@")[0];

  return <TradingDashboard userName={name} />;
}
