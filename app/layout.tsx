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

const NAVER_US_LOGO_FALLBACK = String.raw`(() => {
  const prefix = "https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock";
  const logoPattern = /\/Stock(.+)\.([ONKA])\.svg(?:\?.*)?$/i;
  const suffixes = ["N", "O", "K", "A"];

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    const source = image.currentSrc || image.src;
    if (!source.startsWith(prefix)) return;

    const match = source.match(logoPattern);
    if (!match) return;

    let base = match[1];
    const currentSuffix = match[2].toUpperCase();
    const embeddedSuffix = base.match(/^(.*)\.([ONKA])$/i);
    const preferredSuffix = embeddedSuffix?.[2]?.toUpperCase();
    if (embeddedSuffix) base = embeddedSuffix[1];

    const tried = new Set(
      (image.dataset.naverLogoTried || "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );
    if (!embeddedSuffix) tried.add(currentSuffix);

    const candidates = [preferredSuffix, ...suffixes].filter(
      (value, index, values) => Boolean(value) && values.indexOf(value) === index,
    );
    const nextSuffix = candidates.find((value) => value && !tried.has(value));
    if (!nextSuffix) return;

    event.stopImmediatePropagation();
    tried.add(nextSuffix);
    image.dataset.naverLogoTried = Array.from(tried).join(",");
    image.src = prefix + base + "." + nextSuffix + ".svg";
  }, true);
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
        <script dangerouslySetInnerHTML={{ __html: NAVER_US_LOGO_FALLBACK }} />
        <script dangerouslySetInnerHTML={{ __html: US_ETF_ORDER_BUTTON_LABEL }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
