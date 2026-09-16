import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";
import "./naver-market.css";
import "./naver-parity.css";
import "./order-closed.css";

// User-facing U.S. tickers hide Reuters venue suffixes in trading-dashboard while canonical API symbols stay unchanged.
export const metadata: Metadata = {
  title: "마켓메이트 | 친구들과 하는 실전 모의투자",
  description: "국내주식, 미국주식, 코인의 실제 시세로 친구들과 겨루는 모의투자 대회",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// InstrumentLogo still uses the app favicon as its crypto placeholder. Naver's
// public crypto profile data exposes the native logo URL as
// /imgstock/fn/real/logo/crypto/Crypto{ticker}.svg. Replace only favicon images
// inside instrument-logo elements, deriving the plain ticker from the nearby
// normalized KRW symbol. If Naver has no logo, React's existing image error
// fallback still takes over.
const NAVER_CRYPTO_LOGO = String.raw`(() => {
  const logoBase = "https://ssl.pstatic.net/imgstock/fn/real/logo/crypto/Crypto";

  const tickerFromText = (text) => {
    const value = String(text || "").toUpperCase();
    const marketSymbol = value.match(/\bKRW[-_]([A-Z0-9]{2,15})\b/);
    if (marketSymbol) return marketSymbol[1];
    const fqnfTicker = value.match(/\b([A-Z0-9]{2,15})_KRW_(?:UPBIT|BITHUMB)\b/);
    if (fqnfTicker) return fqnfTicker[1];
    return "";
  };

  const tickerForImage = (image) => {
    let node = image.closest(".instrument-logo");
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const ticker = tickerFromText(node.textContent);
      if (ticker) return ticker;
    }
    return "";
  };

  const apply = () => {
    document.querySelectorAll(".instrument-logo img").forEach((image) => {
      if (!(image instanceof HTMLImageElement)) return;
      const source = image.currentSrc || image.src || "";
      if (!/\/favicon\.svg(?:[?#]|$)/i.test(source)) return;
      const ticker = tickerForImage(image);
      if (!ticker) return;
      const target = logoBase + ticker + ".svg";
      if (image.src !== target) image.src = target;
    });
  };

  const start = () => {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();`;

const US_ETF_ORDER_BUTTON_LABEL = String.raw`(() => {
  const etfNamePattern = /(?:\bETF\b|\bETN\b|SPDR|iShares|Vanguard|Invesco|ProShares|Direxion|VanEck|Global X|ARK(?:K|W|G|F|Q)?\b|WisdomTree|Schwab|First Trust|Pacer|GraniteShares|YieldMax|Roundhill|Simplify|Defiance|REX Shares|T-REX|MicroSectors|Amplify|Innovator|Avantis)/i;
  const usExchangePattern = /^(?:NAS|NYS|AMS|NASDAQ|NYSE|AMEX|USA)$/i;

  const apply = () => {
    const quoteHead = document.querySelector(".np-quote-head");
    if (!quoteHead) return;

    const name = quoteHead.querySelector(".stock-title h1")?.textContent?.trim() || "";
    if (!etfNamePattern.test(name)) return;

    const meta = quoteHead.querySelector(".stock-title small")?.textContent || "";
    const parts = meta.split("·").map((value) => value.trim());
    const rawSymbol = parts[0] || "";
    const exchange = parts[1] || "";
    if (!rawSymbol || !usExchangePattern.test(exchange)) return;

    const ticker = rawSymbol.split(/[._]/)[0].toUpperCase();
    if (!ticker) return;

    document.querySelectorAll("button.order-buy, button.order-sell").forEach((node) => {
      if (!(node instanceof HTMLButtonElement) || node.disabled) return;
      const side = node.classList.contains("order-buy") ? "매수" : "매도";
      const label = ticker + " " + side;
      if (node.textContent?.trim() !== label) node.textContent = label;
    });
  };

  const start = () => {
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NAVER_CRYPTO_LOGO }} />
        <script dangerouslySetInnerHTML={{ __html: US_ETF_ORDER_BUTTON_LABEL }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
