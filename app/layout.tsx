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

  const domesticSessionTimes = {
    KRX: {
      preOpenClosingPrice: ["08:40", "08:50"],
      openingAuction: ["08:50", "09:00"],
      regularMarket: ["09:00", "15:20"],
      closingAuction: ["15:20", "15:30"],
      regularMarketClosing: ["15:30", "15:40"],
      afterHoursClosingPrice: ["15:40", "16:00"],
      afterMarket: ["16:00", "20:00"],
      afterMarketClosing: ["20:00", "08:40"],
      closed: ["20:00", "08:40"],
    },
    NXT: {
      preMarket: ["08:00", "08:50"],
      preMarketClosing: ["08:50", "09:00"],
      regularMarket: ["09:00", "15:20"],
      regularMarketClosing: ["15:20", "15:40"],
      afterMarket: ["15:40", "20:00"],
      afterMarketClosing: ["20:00", "08:00"],
      closed: ["20:00", "08:00"],
    },
  };

  const timeText = (market, status) => {
    if (market === "KR") {
      const exchange = String(status?.exchange || "KRX").toUpperCase();
      const session = String(status?.currentSession || "");
      const range = domesticSessionTimes[exchange]?.[session];
      if (Array.isArray(range) && range.length === 2) return range[0] + "~" + range[1];
    }
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

// LiveMarketStrip currently renders a fixed five-item list even though the market
// overview API already includes USDKRW. Keep the desktop strip in sync with that
// existing Naver-backed quote until the strip itself is refactored away from its
// fixed list. No additional market-data source is introduced here.
const DESKTOP_USDKRW_MARKET_STRIP = String.raw`(() => {
  let latest = null;
  let timer = 0;
  let loading = false;

  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };

  const goToUsdKrwIndex = () => {
    const marketNav = Array.from(document.querySelectorAll(".np-desktop-header > nav button"))
      .find((button) => (button.textContent || "").trim() === "시세");
    if (marketNav instanceof HTMLButtonElement) marketNav.click();
    requestAnimationFrame(() => {
      const indexTab = Array.from(document.querySelectorAll(".np-market-tabs button"))
        .find((button) => (button.textContent || "").trim() === "지수");
      if (indexTab instanceof HTMLButtonElement) indexTab.click();
      requestAnimationFrame(() => {
        const usdKrw = Array.from(document.querySelectorAll(".np-index-selector button"))
          .find((button) => /원[·\/]달러/.test((button.textContent || "").trim()));
        if (usdKrw instanceof HTMLButtonElement) usdKrw.click();
      });
    });
  };

  const ensureButton = (strip) => {
    let button = strip.querySelector("[data-market-strip-usdkrw]");
    if (button instanceof HTMLButtonElement) return button;

    button = document.createElement("button");
    button.type = "button";
    button.dataset.marketStripUsdkrw = "1";

    const label = document.createElement("span");
    label.append(document.createTextNode("원/달러 환율"));
    const source = document.createElement("small");
    source.dataset.marketStripUsdkrwSource = "1";
    source.textContent = "시세 확인 중";
    label.appendChild(source);

    const price = document.createElement("strong");
    price.dataset.marketStripUsdkrwPrice = "1";
    price.textContent = "-";

    const rate = document.createElement("em");
    rate.dataset.marketStripUsdkrwRate = "1";

    button.append(label, price, rate);
    button.addEventListener("click", goToUsdKrwIndex);
    strip.appendChild(button);
    return button;
  };

  const render = () => {
    const strip = document.querySelector(".np-desktop-header > .live-market-strip");
    if (!(strip instanceof HTMLElement)) return;
    const button = ensureButton(strip);
    const source = button.querySelector("[data-market-strip-usdkrw-source]");
    const price = button.querySelector("[data-market-strip-usdkrw-price]");
    const rate = button.querySelector("[data-market-strip-usdkrw-rate]");
    if (!(source instanceof HTMLElement) || !(price instanceof HTMLElement) || !(rate instanceof HTMLElement)) return;

    if (!latest) {
      setText(source, "시세 확인 중");
      setText(price, "-");
      setText(rate, "");
      rate.className = "";
      return;
    }

    const value = Number(latest.price || 0);
    const changeRate = Number(latest.rate || 0);
    setText(source, "네이버증권");
    setText(price, value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + String(latest.unit || "원"));
    setText(rate, (changeRate >= 0 ? "+" : "") + changeRate.toFixed(2) + "%");
    const className = changeRate >= 0 ? "up" : "down";
    if (rate.className !== className) rate.className = className;
  };

  const schedule = (delay) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(load, Math.max(2000, Math.min(120000, Number(delay) || 10000)));
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch("/api/market-overview", { cache: "no-store" });
      if (!response.ok) throw new Error("MARKET_OVERVIEW_FAILED");
      const payload = await response.json();
      const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
      const quote = quotes.find((item) => item?.id === "USDKRW");
      if (quote) latest = quote;
      render();
      schedule(payload?.pollingInterval);
    } catch {
      render();
      schedule(10000);
    } finally {
      loading = false;
    }
  };

  const start = () => {
    render();
    void load();
    const observer = new MutationObserver(() => render());
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
        <script dangerouslySetInnerHTML={{ __html: US_ETF_ORDER_BUTTON_LABEL }} />
        <script dangerouslySetInnerHTML={{ __html: TRADING_FEE_GUIDE }} />
        <script dangerouslySetInnerHTML={{ __html: LIVE_MARKET_STATUS_BOARD }} />
        <script dangerouslySetInnerHTML={{ __html: DESKTOP_USDKRW_MARKET_STRIP }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}