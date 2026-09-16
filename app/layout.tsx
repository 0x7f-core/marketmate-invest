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

// The React renderer currently builds a fallback venue suffix from the simplified
// exchange label. Naver autocomplete already returns Reuters-coded US symbols
// such as GEV.N, SOXL.O and SPY.K, so the old renderer can temporarily request
// invalid paths such as StockGEV.N.K.svg or StockSOXL.O.O.svg. Repair those
// paths proactively and, for genuinely missing venue mappings, retry Naver's
// Reuters venue suffixes before the React letter fallback is allowed to run.
const NAVER_US_LOGO_RECOVERY = String.raw`(() => {
  const prefix = "https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock";
  const venueSuffixes = ["N", "O", "K", "A"];

  const parseLogo = (source) => {
    if (!source || !source.startsWith(prefix)) return null;
    const clean = source.split("?")[0].split("#")[0];
    const match = clean.match(/\/Stock(.+)\.([ONKA])\.svg$/i);
    if (!match) return null;
    return { base: match[1], suffix: match[2].toUpperCase() };
  };

  const canonicalizeDuplicatedReutersSuffix = (image) => {
    const source = image.currentSrc || image.src || "";
    if (!source.startsWith(prefix)) return false;
    const clean = source.split("?")[0].split("#")[0];
    const duplicate = clean.match(/\/Stock(.+)\.([ONKA])\.([ONKA])\.svg$/i);
    if (!duplicate) return false;

    const base = duplicate[1];
    const embeddedReutersSuffix = duplicate[2].toUpperCase();
    const corrected = prefix + base + "." + embeddedReutersSuffix + ".svg";
    if (image.src !== corrected) {
      image.dataset.naverLogoBase = base;
      image.dataset.naverLogoTried = embeddedReutersSuffix;
      image.src = corrected;
    }
    return true;
  };

  const scan = (root) => {
    if (root instanceof HTMLImageElement) canonicalizeDuplicatedReutersSuffix(root);
    if (!(root instanceof Element || root instanceof Document)) return;
    root.querySelectorAll("img").forEach((image) => canonicalizeDuplicatedReutersSuffix(image));
  };

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const source = image.currentSrc || image.src || "";
    if (!source.startsWith(prefix)) return;

    // Most failures are caused by an already Reuters-coded symbol receiving a
    // second suffix from the simplified exchange mapping. Fix that exact code
    // first and prevent React's onError fallback from replacing the logo.
    if (canonicalizeDuplicatedReutersSuffix(image)) {
      event.stopImmediatePropagation();
      return;
    }

    const parsed = parseLogo(source);
    if (!parsed) return;

    let base = parsed.base;
    let preferredSuffix = "";
    const embedded = base.match(/^(.*)\.([ONKA])$/i);
    if (embedded) {
      base = embedded[1];
      preferredSuffix = embedded[2].toUpperCase();
    }

    if (image.dataset.naverLogoBase !== base) {
      image.dataset.naverLogoBase = base;
      image.dataset.naverLogoTried = "";
    }

    const tried = new Set(
      (image.dataset.naverLogoTried || "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );
    tried.add(parsed.suffix);

    const candidates = [preferredSuffix].concat(venueSuffixes).filter(
      (value, index, values) => Boolean(value) && values.indexOf(value) === index,
    );
    const nextSuffix = candidates.find((value) => !tried.has(value));
    if (!nextSuffix) return;

    event.stopImmediatePropagation();
    tried.add(nextSuffix);
    image.dataset.naverLogoTried = Array.from(tried).join(",");
    image.src = prefix + base + "." + nextSuffix + ".svg";
  }, true);

  const start = () => {
    scan(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof HTMLImageElement) {
          canonicalizeDuplicatedReutersSuffix(mutation.target);
          continue;
        }
        mutation.addedNodes.forEach((node) => scan(node));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
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
        <script dangerouslySetInnerHTML={{ __html: NAVER_US_LOGO_RECOVERY }} />
        <script dangerouslySetInnerHTML={{ __html: US_ETF_ORDER_BUTTON_LABEL }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
