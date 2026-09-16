import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";
import "./naver-market.css";
import "./naver-parity.css";

export const metadata: Metadata = {
  title: "마켓메이트 | 친구들과 하는 실전 모의투자",
  description: "국내주식, 미국주식, 코인의 실제 시세로 친구들과 겨루는 모의투자 대회",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// Naver's stock-logo CDN uses the item code itself (for example StockGEV.svg),
// not the Reuters venue suffix used by quote/search APIs (QQQ.O, SPY.P, etc.).
// The current dashboard renderer can still produce Reuters-suffixed URLs and an
// older recovery script could recursively grow malformed /Stock/Stock/... paths.
// Normalize every Naver stock-logo request to one canonical CDN URL based on the
// final filename only. This also repairs already-corrupted repeated-path URLs.
const NAVER_STOCK_LOGO_NORMALIZER = String.raw`(() => {
  const origin = "https://ssl.pstatic.net";
  const directory = "/imgstock/fn/real/logo/stock/";
  const prefix = origin + directory + "Stock";
  const venueSuffix = /\.(?:O|N|P|K|A)$/i;

  const canonicalUrl = (source) => {
    if (!source) return "";
    let url;
    try {
      url = new URL(source, document.baseURI);
    } catch {
      return "";
    }
    if (url.origin !== origin || !url.pathname.includes(directory)) return "";

    // Always use only the final path component. This is important for repairing
    // malformed URLs such as .../stock/Stock/Stock/.../StockSPY.N.svg.
    const filename = url.pathname.split("/").filter(Boolean).pop() || "";
    const match = filename.match(/^Stock(.+)\.svg$/i);
    if (!match) return "";

    let code = match[1];
    // Search/quote identifiers can contain one or two venue suffixes because the
    // old renderer sometimes appended a suffix to an already Reuters-coded item.
    // Naver logo files use the bare item code, so remove those transport suffixes.
    for (let i = 0; i < 2 && venueSuffix.test(code); i += 1) {
      code = code.replace(venueSuffix, "");
    }
    if (!code || !/^[A-Za-z0-9._-]+$/.test(code)) return "";
    return prefix + code + ".svg";
  };

  const normalizeImage = (image) => {
    if (!(image instanceof HTMLImageElement)) return;
    const source = image.getAttribute("src") || image.src || "";
    const canonical = canonicalUrl(source);
    if (!canonical || image.src === canonical) return;
    image.src = canonical;
  };

  const scan = (root) => {
    if (root instanceof HTMLImageElement) normalizeImage(root);
    if (!(root instanceof Element || root instanceof Document)) return;
    root.querySelectorAll("img").forEach(normalizeImage);
  };

  const start = () => {
    scan(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof HTMLImageElement) {
          normalizeImage(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach(scan);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
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
        <script dangerouslySetInnerHTML={{ __html: NAVER_STOCK_LOGO_NORMALIZER }} />
        <script dangerouslySetInnerHTML={{ __html: US_ETF_ORDER_BUTTON_LABEL }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
