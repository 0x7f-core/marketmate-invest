"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Market = "KR" | "US" | "CRYPTO";
type Category = "tradingValue" | "volume" | "up" | "down" | "marketCap";
type RankingItem = {
  market: Market;
  rank: number;
  symbol: string;
  name: string;
  exchange: string;
  currency: "KRW" | "USD";
  price: number;
  change: number;
  changeRate: number;
  volume: number;
  tradingValue: number;
  marketCap: number;
};
type RankingResponse = {
  market: Market;
  category: Category;
  items: RankingItem[];
  source: "NAVER";
  fetchedAt: number;
  stale: boolean;
  pollingInterval: number;
};
type MarketStatusResponse = {
  market?: Market;
  isOpen?: boolean;
  label?: string;
  currentSession?: string;
};
type CacheEntry = { data: RankingResponse; expiresAt: number };

const MARKETS: Array<{ key: Market; label: string }> = [
  { key: "KR", label: "국내" },
  { key: "US", label: "미국" },
  { key: "CRYPTO", label: "가상자산" },
];
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "tradingValue", label: "거래대금" },
  { key: "volume", label: "거래량" },
  { key: "up", label: "상승" },
  { key: "down", label: "하락" },
  { key: "marketCap", label: "시가총액" },
];
const clientCache = new Map<string, CacheEntry>();
const DEFAULT_REFRESH_MS = 15_000;

function cacheKey(market: Market, category: Category) {
  return `${market}:${category}`;
}

function displaySymbol(item: RankingItem) {
  if (item.market === "US") return item.symbol.replace(/\.(?:O|K|N|P|A)$/i, "");
  if (item.market === "CRYPTO") return item.symbol.replace(/^KRW-/, "");
  return item.symbol;
}

function formatPrice(item: RankingItem) {
  if (!Number.isFinite(item.price) || item.price <= 0) return "-";
  if (item.currency === "USD") {
    return `$${item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  return item.price.toLocaleString("ko-KR", { maximumFractionDigits: item.market === "CRYPTO" && item.price < 100 ? 4 : 0 });
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatVolume(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number, currency: "KRW" | "USD") {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (currency === "USD") {
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
  }
  return `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 2 }).format(value)}원`;
}

function metricLabel(category: Category) {
  return CATEGORIES.find(item => item.key === category)?.label ?? "";
}

function metricValue(item: RankingItem, category: Category) {
  if (category === "volume") return formatVolume(item.volume);
  if (category === "tradingValue") return formatMoney(item.tradingValue, item.currency);
  if (category === "marketCap") return formatMoney(item.marketCap, item.currency);
  return formatRate(item.changeRate);
}

function rateClass(value: number) {
  return value > 0 ? "up" : value < 0 ? "down" : "";
}

function localMinutes(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  return {
    weekday: read("weekday"),
    minutes: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1,
  };
}

function isBeforeRegularOpen(market: Market, status: MarketStatusResponse | null) {
  if (market === "CRYPTO") return false;
  const session = status?.currentSession ?? "";
  if (session === "preMarket" || session === "openingAuction") return true;
  if (["regularMarket", "afterMarket", "closingAuction", "afterMarketClosing"].includes(session)) return false;

  const clock = localMinutes(market === "KR" ? "Asia/Seoul" : "America/New_York");
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(clock.weekday)) return false;
  const regularOpen = market === "KR" ? 9 * 60 : 9 * 60 + 30;
  return clock.minutes >= 0 && clock.minutes < regularOpen;
}

function RankingLogo({ item }: { item: RankingItem }) {
  if (item.market === "CRYPTO") return null;
  return (
    <span className="mm-rank-logo" aria-hidden="true">
      <b>{item.name.trim().slice(0, 1) || displaySymbol(item).slice(0, 1)}</b>
      <img
        src={`/api/instruments/logo?symbol=${encodeURIComponent(item.symbol)}`}
        alt=""
        loading="lazy"
        onError={event => { event.currentTarget.style.display = "none"; }}
      />
    </span>
  );
}

function RankingSkeleton() {
  return (
    <div className="mm-ranking-skeleton" aria-label="실시간 랭킹 불러오는 중">
      {Array.from({ length: 10 }, (_, index) => <i key={index} />)}
    </div>
  );
}

function RankingSection() {
  const [market, setMarket] = useState<Market>("KR");
  const [category, setCategory] = useState<Category>("tradingValue");
  const [data, setData] = useState<RankingResponse | null>(() => clientCache.get(cacheKey("KR", "tradingValue"))?.data ?? null);
  const [marketStatus, setMarketStatus] = useState<MarketStatusResponse | null>(null);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");

  const load = useCallback(async (force = false) => {
    const key = cacheKey(market, category);
    const cached = clientCache.get(key);
    const now = Date.now();
    if (!force && cached && cached.expiresAt > now) {
      setData(cached.data);
      setLoading(false);
      setError("");
      return;
    }

    if (!cached) {
      setData(null);
      setLoading(true);
    } else {
      setData(cached.data);
    }
    setError("");

    try {
      const response = await fetch(`/api/market-rankings?market=${market}&category=${category}&_=${now}`, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      if (!response.ok) throw new Error("RANKING_FAILED");
      const result = await response.json() as RankingResponse;
      if (!Array.isArray(result.items) || !result.items.length) throw new Error("RANKING_EMPTY");
      const ttl = Math.max(5_000, Math.min(60_000, Number(result.pollingInterval) || DEFAULT_REFRESH_MS));
      clientCache.set(key, { data: result, expiresAt: Date.now() + ttl });
      setData(result);
    } catch {
      if (!cached) setError("실시간 랭킹을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [market, category]);

  useEffect(() => {
    const cached = clientCache.get(cacheKey(market, category));
    setData(cached?.data ?? null);
    setLoading(!cached);
    setError("");
    void load(false);
  }, [market, category, load]);

  useEffect(() => {
    if (market === "CRYPTO") {
      setMarketStatus(null);
      return;
    }
    let active = true;
    fetch(`/api/market-status?market=${market}`, { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<MarketStatusResponse> : null)
      .then(result => { if (active) setMarketStatus(result); })
      .catch(() => { if (active) setMarketStatus(null); });
    return () => { active = false; };
  }, [market]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, Math.max(DEFAULT_REFRESH_MS, data?.pollingInterval ?? DEFAULT_REFRESH_MS));
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [data?.pollingInterval, load]);

  const items = useMemo(() => data?.items.slice(0, 10) ?? [], [data]);
  const preOpen = isBeforeRegularOpen(market, marketStatus);

  return (
    <section className="np-panel mm-market-rankings" aria-labelledby="mm-market-ranking-title">
      <div className="mm-ranking-title">
        <h2 id="mm-market-ranking-title">실시간 랭킹</h2>
        <span><i /> 네이버증권</span>
      </div>

      <div className="mm-ranking-market-tabs" role="tablist" aria-label="실시간 랭킹 시장">
        {MARKETS.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={market === item.key}
            className={market === item.key ? "active" : ""}
            onClick={() => setMarket(item.key)}
          >{item.label}</button>
        ))}
      </div>

      <div className="mm-ranking-category-tabs" role="tablist" aria-label="실시간 랭킹 기준">
        {CATEGORIES.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={category === item.key}
            className={category === item.key ? "active" : ""}
            onClick={() => setCategory(item.key)}
          >{item.label}</button>
        ))}
      </div>

      {preOpen ? (
        <div className="mm-ranking-preopen-notice" role="status">
          현재 개장 전입니다. 거래대금·거래량·상승·하락 순위는 정규장 개장 후 확인할 수 있습니다.
        </div>
      ) : null}

      <div className="mm-ranking-desktop-head" aria-hidden="true">
        <span>순위</span><span>종목명</span><span>현재가</span><span>등락률</span><span>거래량</span><span>거래대금</span><span>시가총액</span>
      </div>

      {loading && !items.length ? <RankingSkeleton /> : error && !items.length ? (
        <div className="mm-ranking-error">
          <p>{preOpen && category !== "marketCap" ? "정규장 개장 후 해당 순위를 확인할 수 있습니다." : error}</p>
          {preOpen && category !== "marketCap" ? null : <button type="button" onClick={() => void load(true)}>다시 불러오기</button>}
        </div>
      ) : (
        <ol className="mm-ranking-list" aria-live="polite">
          {items.map(item => (
            <li key={`${market}:${category}:${item.symbol}`}>
              <b className="mm-rank-number">{item.rank}</b>
              <span className="mm-rank-stock">
                <RankingLogo item={item} />
                <span className="mm-rank-stock-text">
                  <strong>{item.name}</strong>
                  <small>{displaySymbol(item)} · {item.exchange}</small>
                </span>
              </span>
              <strong className="mm-rank-price">{formatPrice(item)}</strong>
              <em className={`mm-rank-rate ${rateClass(item.changeRate)}`}>{formatRate(item.changeRate)}</em>
              <span className="mm-rank-volume">{formatVolume(item.volume)}</span>
              <span className="mm-rank-value">{formatMoney(item.tradingValue, item.currency)}</span>
              <span className="mm-rank-cap">{formatMoney(item.marketCap, item.currency)}</span>
              <span className="mm-rank-mobile-metric"><small>{metricLabel(category)}</small><b className={category === "up" || category === "down" ? rateClass(item.changeRate) : ""}>{metricValue(item, category)}</b></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function HomeMarketRankings() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    const attach = () => {
      if (!active) return;
      const home = document.querySelector<HTMLElement>(".np-home .np-home-main");
      if (!home) {
        setTarget(current => current?.isConnected ? current : null);
        return;
      }
      let slot = home.querySelector<HTMLElement>(":scope > .home-market-ranking-slot");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "home-market-ranking-slot";
        const news = home.querySelector<HTMLElement>(":scope > .np-news");
        if (news) home.insertBefore(slot, news);
        else home.appendChild(slot);
      }
      setTarget(current => current === slot ? current : slot);
    };

    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    attach();
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {target && target.isConnected ? createPortal(<RankingSection />, target) : null}
      <style>{`
        .home-market-ranking-slot{width:100%;min-width:0}
        .mm-market-rankings{overflow:hidden;background:#fff}
        .mm-ranking-title{height:56px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eef0f2}
        .mm-ranking-title h2{margin:0;font-size:17px;letter-spacing:-.035em}
        .mm-ranking-title>span{display:flex;align-items:center;gap:6px;color:#8a9299;font-size:11px}
        .mm-ranking-title>span i{width:6px;height:6px;border-radius:50%;background:#19a974}
        .mm-ranking-market-tabs{height:50px;padding:0 20px;display:flex;gap:28px;border-bottom:1px solid #eef0f2;background:#fff}
        .mm-ranking-market-tabs button{position:relative;border:0;background:#fff;color:#7b838b;font-size:14px;font-weight:700;padding:0 1px}
        .mm-ranking-market-tabs button.active{color:#17191c;font-weight:900}
        .mm-ranking-market-tabs button.active:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:#17191c}
        .mm-ranking-category-tabs{padding:14px 20px 13px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid #eef0f2}
        .mm-ranking-category-tabs::-webkit-scrollbar{display:none}
        .mm-ranking-category-tabs button{flex:none;height:34px;padding:0 14px;border:1px solid #e4e7e9;border-radius:17px;background:#fff;color:#606870;font-size:12px;font-weight:700;white-space:nowrap}
        .mm-ranking-category-tabs button.active{border-color:#17191c;background:#17191c;color:#fff}
        .mm-ranking-preopen-notice{padding:10px 20px;background:#fafbfb;border-bottom:1px solid #eef0f2;color:#707981;font-size:12px;line-height:1.5;letter-spacing:-.02em}
        .mm-ranking-desktop-head,.mm-ranking-list li{display:grid;grid-template-columns:48px minmax(180px,1fr) 110px 90px 110px 120px 120px;align-items:center}
        .mm-ranking-desktop-head{height:40px;padding:0 20px;background:#fafbfb;color:#8a9299;font-size:11px;border-bottom:1px solid #eef0f2}
        .mm-ranking-desktop-head span:nth-child(n+3){text-align:right}
        .mm-ranking-list{list-style:none;margin:0;padding:0}
        .mm-ranking-list li{min-height:61px;padding:8px 20px;border-bottom:1px solid #eef0f2;font-size:12px}
        .mm-ranking-list li:last-child{border-bottom:0}
        .mm-rank-number{color:#4c555d;font-size:13px;font-variant-numeric:tabular-nums}
        .mm-rank-stock{display:flex;min-width:0;align-items:center;gap:10px}
        .mm-rank-logo{position:relative;display:flex;flex:0 0 30px;width:30px;height:30px;align-items:center;justify-content:center;overflow:hidden;border:1px solid #edf0f2;border-radius:50%;background:#f7f8f9;color:#8c949b;font-size:11px;font-weight:800}
        .mm-rank-logo img{position:absolute;inset:0;width:100%;height:100%;padding:2px;background:#fff;object-fit:contain}
        .mm-rank-stock-text{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}
        .mm-rank-stock-text strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#22272c;font-size:13px}
        .mm-rank-stock-text small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#989fa5;font-size:10px}
        .mm-rank-price,.mm-rank-rate,.mm-rank-volume,.mm-rank-value,.mm-rank-cap{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
        .mm-rank-price{color:#22272c;font-size:12px}
        .mm-rank-rate{font-style:normal;font-weight:700}
        .mm-rank-volume,.mm-rank-value,.mm-rank-cap{color:#596169}
        .mm-rank-mobile-metric{display:none}
        .mm-ranking-skeleton i{display:block;height:61px;border-bottom:1px solid #eef0f2;background:linear-gradient(90deg,#fff 0,#f7f8f9 45%,#fff 100%);background-size:220% 100%;animation:mm-ranking-shimmer 1.1s linear infinite}
        @keyframes mm-ranking-shimmer{to{background-position:-120% 0}}
        .mm-ranking-error{min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#7b838b;font-size:13px}
        .mm-ranking-error p{margin:0}.mm-ranking-error button{height:32px;padding:0 12px;border:1px solid #dfe3e6;border-radius:6px;background:#fff;color:#4e565e;font-size:12px}
        @media(max-width:900px) and (min-width:761px){
          .mm-ranking-desktop-head,.mm-ranking-list li{grid-template-columns:42px minmax(150px,1fr) 100px 78px 95px 105px 105px}
          .mm-ranking-title,.mm-ranking-market-tabs,.mm-ranking-category-tabs,.mm-ranking-preopen-notice,.mm-ranking-desktop-head,.mm-ranking-list li{padding-left:16px;padding-right:16px}
        }
        @media(max-width:760px){
          .home-market-ranking-slot{background:#fff}
          .mm-market-rankings{border-width:0 0 9px!important;border-color:#f0f2f3!important;border-radius:0!important}
          .mm-ranking-title{height:52px;padding:0 16px}
          .mm-ranking-title h2{font-size:16px}
          .mm-ranking-market-tabs{height:44px;padding:0;gap:0}
          .mm-ranking-market-tabs button{flex:1;font-size:13px}
          .mm-ranking-market-tabs button.active:after{left:22%;right:22%;height:2px}
          .mm-ranking-category-tabs{padding:11px 16px 12px;gap:7px}
          .mm-ranking-category-tabs button{height:32px;padding:0 13px;font-size:12px}
          .mm-ranking-preopen-notice{padding:10px 16px;font-size:11px}
          .mm-ranking-desktop-head{display:none}
          .mm-ranking-list li{min-height:70px;padding:10px 16px;display:grid;grid-template-columns:28px minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:8px;row-gap:4px}
          .mm-rank-number{grid-column:1;grid-row:1/3;align-self:center;font-size:13px}
          .mm-rank-stock{grid-column:2;grid-row:1/3;align-self:center;gap:8px}
          .mm-rank-logo{flex-basis:32px;width:32px;height:32px}
          .mm-rank-stock-text strong{font-size:14px}.mm-rank-stock-text small{font-size:10px}
          .mm-rank-price{grid-column:3;grid-row:1;text-align:right;font-size:13px}
          .mm-rank-rate{grid-column:3;grid-row:2;text-align:right;font-size:12px}
          .mm-rank-volume,.mm-rank-value,.mm-rank-cap{display:none}
          .mm-rank-mobile-metric{display:none}
          .mm-ranking-skeleton i{height:70px}
        }
      `}</style>
    </>
  );
}
