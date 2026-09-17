import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";
import "./naver-market.css";
import "./naver-parity.css";
import "./order-closed.css";
import "./market-status-board.css";

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

// U.S. ETF/ETN names are often much wider than the order card. The old enhancer
// depended entirely on the quote header meta text (symbol · exchange), so a
// transient stale header during instrument switching could leave the full fund
// name on the buy/sell buttons. Resolve the ticker from several independent
// signals and cache the Naver-search fallback so the action label stays stable.
const US_ETF_ORDER_BUTTON_LABEL = String.raw`(() => {
  const etfNamePattern = /(?:\bETF\b|\bETN\b|SPDR|iShares|Vanguard|Invesco|ProShares|Direxion|VanEck|Global X|ARK(?:K|W|G|F|Q)?\b|WisdomTree|Schwab|First Trust|Pacer|GraniteShares|YieldMax|Roundhill|Simplify|Defiance|REX Shares|T-REX|MicroSectors|Amplify|Innovator|Avantis)/i;
  const usExchangePattern = /^(?:NAS|NYS|AMS|NASDAQ|NYSE|AMEX|USA)$/i;
  const tickerCache = new Map();
  const tickerRequests = new Map();

  const cleanTicker = (value) => String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\.(?:O|K|N|P|A)$/i, "")
    .split(/[._]/)[0]
    .replace(/[^A-Z0-9-]/g, "");

  const tickerFromLogo = (quoteHead) => {
    const image = quoteHead.querySelector(".instrument-logo img");
    if (!(image instanceof HTMLImageElement)) return "";
    const sources = [image.currentSrc, image.src].filter(Boolean);
    for (const source of sources) {
      try {
        const url = new URL(source, window.location.href);
        const symbol = url.searchParams.get("symbol");
        const fromQuery = cleanTicker(symbol);
        if (fromQuery) return fromQuery;
      } catch {}
      const decoded = decodeURIComponent(String(source));
      const stockLogo = decoded.match(/\/Stock([A-Z0-9._-]+)\.svg(?:[?#]|$)/i);
      const fromLogo = cleanTicker(stockLogo?.[1]);
      if (fromLogo) return fromLogo;
    }
    return "";
  };

  const isUsContext = (exchange) => {
    if (usExchangePattern.test(exchange)) return true;
    const activeTab = Array.from(document.querySelectorAll(".np-market-tabs button")).some((button) =>
      button.classList.contains("active") && /미국|글로벌/.test(button.textContent || ""),
    );
    if (activeTab) return true;
    const session = document.querySelector(".order-panel .session")?.textContent || "";
    return /NASDAQ|NYSE|AMEX|미국/i.test(session);
  };

  const applyTicker = (ticker) => {
    if (!ticker) return;
    document.querySelectorAll("button.order-buy, button.order-sell").forEach((node) => {
      if (!(node instanceof HTMLButtonElement) || node.disabled) return;
      const side = node.classList.contains("order-buy") ? "매수" : "매도";
      const label = ticker + " " + side;
      if (node.textContent?.trim() !== label) node.textContent = label;
    });
  };

  const searchTicker = (name) => {
    if (tickerCache.has(name)) return Promise.resolve(tickerCache.get(name) || "");
    if (tickerRequests.has(name)) return tickerRequests.get(name);
    const request = fetch("/api/instruments/search?q=" + encodeURIComponent(name) + "&market=US", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const instruments = Array.isArray(payload?.instruments) ? payload.instruments : [];
        const exact = instruments.find((item) => item?.market === "US" && String(item?.name || "").trim().toLowerCase() === name.toLowerCase());
        const candidate = exact || instruments.find((item) => item?.market === "US");
        const ticker = cleanTicker(candidate?.symbol);
        if (ticker) tickerCache.set(name, ticker);
        return ticker;
      })
      .catch(() => "")
      .finally(() => tickerRequests.delete(name));
    tickerRequests.set(name, request);
    return request;
  };

  const apply = () => {
    const quoteHead = document.querySelector(".np-quote-head");
    if (!quoteHead) return;

    const name = quoteHead.querySelector(".stock-title h1")?.textContent?.trim() || "";
    if (!name || !etfNamePattern.test(name)) return;

    const meta = quoteHead.querySelector(".stock-title small")?.textContent || "";
    const parts = meta.split("·").map((value) => value.trim());
    const rawSymbol = parts[0] || "";
    const exchange = parts[1] || "";
    if (!isUsContext(exchange)) return;

    const metaTicker = usExchangePattern.test(exchange) ? cleanTicker(rawSymbol) : "";
    const ticker = metaTicker || tickerFromLogo(quoteHead) || tickerCache.get(name) || "";
    if (ticker) {
      applyTicker(ticker);
      return;
    }

    void searchTicker(name).then((resolved) => {
      const currentName = document.querySelector(".np-quote-head .stock-title h1")?.textContent?.trim() || "";
      if (resolved && currentName === name) applyTicker(resolved);
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
      attributeFilter: ["class", "src"],
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();`;

// The competition page is rendered inside a large client dashboard. Keep the
// displayed rate notice synchronized from one small global enhancer instead of
// duplicating the rates across multiple responsive layouts.
const TRADING_FEE_GUIDE = String.raw`(() => {
  const text = "거래비용: 국내 KRX 0.015% · NXT 0.0145%, 미국주식 0.07%(이벤트 혜택 기준), 가상자산 업비트 KRW 0.05%의 수수료가 매수·매도 모두 적용됩니다. 국내 일반주식은 매도 시 거래세 0.20%가 추가되며 ETF·ETN·ELW는 거래세가 없습니다.";

  const apply = () => {
    document.querySelectorAll(".trading-guide ul").forEach((list) => {
      if (!(list instanceof HTMLUListElement) || list.querySelector("[data-trading-fee-guide]")) return;
      const item = document.createElement("li");
      item.dataset.tradingFeeGuide = "1";
      item.textContent = text;
      list.prepend(item);
    });
  };

  const start = () => {
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();`;

// The home page originally showed static implementation notes in the market-status
// row. Replace them with the same compact, live session summary pattern used by
// Npay Securities: domestic, U.S., and crypto state in one line, backed by this
// app's Naver market-status API. Canonical order checks remain server-side.
const LIVE_MARKET_STATUS_BOARD = String.raw`(() => {
  const markets = ["KR", "US", "CRYPTO"];
  const names = { KR: "국내", US: "미국", CRYPTO: "가상자산" };
  const cache = new Map();
  let loading = false;

  const cleanLabel = (value) => String(value || "")
    .replace(/\s*·\s*(?:KRX|NXT|NASDAQ)\b/gi, "")
    .trim();

  const clock = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/(\d{1,2}):(\d{2})/);
    if (!match) return "";
    return match[1].padStart(2, "0") + ":" + match[2];
  };

  const sessionText = (market, status) => {
    const label = cleanLabel(status?.label) || (status?.isOpen ? "거래중" : "장 마감");
    if (market === "KR") {
      const exchange = String(status?.exchange || "KRX").toUpperCase();
      return exchange + " " + label;
    }
    return label;
  };

  const timeText = (market, status) => {
    const open = clock(status?.openTimeKst);
    const close = clock(status?.closeTimeKst);
    return open && close ? open + "~" + close : "";
  };

  const makeItem = (market, status) => {
    const item = document.createElement("span");
    item.className = "market-status-item";
    if (status?.notice) item.title = String(status.notice);

    const dot = document.createElement("i");
    dot.className = "market-status-dot" + (status?.isOpen ? "" : " closed");
    item.appendChild(dot);

    const name = document.createElement("b");
    name.className = "market-status-name";
    name.textContent = names[market];
    item.appendChild(name);

    if (!status) {
      const waiting = document.createElement("span");
      waiting.className = "market-status-loading";
      waiting.textContent = "확인 중";
      item.appendChild(waiting);
      return item;
    }

    if (market === "CRYPTO") {
      const badge = document.createElement("span");
      badge.className = "market-status-badge";
      badge.textContent = "실시간";
      item.appendChild(badge);
      return item;
    }

    const session = document.createElement("span");
    session.className = "market-status-session" + (status.isOpen ? " open" : "");
    session.textContent = sessionText(market, status);
    item.appendChild(session);

    const times = timeText(market, status);
    if (times) {
      const time = document.createElement("span");
      time.className = "market-status-time";
      time.textContent = times;
      item.appendChild(time);
    }

    if (status.isHoliday) {
      const badge = document.createElement("span");
      badge.className = "market-status-badge closed";
      badge.textContent = "휴장";
      item.appendChild(badge);
    }

    return item;
  };

  const render = () => {
    document.querySelectorAll(".np-market-status").forEach((board) => {
      if (!(board instanceof HTMLElement)) return;
      board.dataset.marketStatusLive = "1";
      board.setAttribute("aria-label", "실시간 거래 가능 시간");
      board.setAttribute("aria-live", "polite");
      board.replaceChildren(...markets.map((market) => makeItem(market, cache.get(market))));
    });
  };

  const load = async () => {
    if (loading || !document.querySelector(".np-market-status")) return;
    loading = true;
    render();
    try {
      const results = await Promise.all(markets.map(async (market) => {
        try {
          const response = await fetch("/api/market-status?market=" + market, { cache: "no-store" });
          if (!response.ok) return null;
          return [market, await response.json()];
        } catch {
          return null;
        }
      }));
      results.forEach((entry) => {
        if (entry) cache.set(entry[0], entry[1]);
      });
      render();
    } finally {
      loading = false;
    }
  };

  const start = () => {
    render();
    void load();
    window.setInterval(load, 20_000);
    const observer = new MutationObserver(() => {
      const board = document.querySelector(".np-market-status");
      if (board instanceof HTMLElement && board.dataset.marketStatusLive !== "1") {
        render();
        void load();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
        <script dangerouslySetInnerHTML={{ __html: TRADING_FEE_GUIDE }} />
        <script dangerouslySetInnerHTML={{ __html: LIVE_MARKET_STATUS_BOARD }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
