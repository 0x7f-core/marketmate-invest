"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Point = { time: number; value: number };
type Series = { points: Point[]; stale?: boolean };
type SparklineResponse = {
  series?: Record<string, Series>;
  pollingInterval?: number;
};
type CardQuote = {
  id: string;
  name: string;
  price: number;
  change: number;
  rate: number;
  unit: string;
  trend: "up" | "down" | "flat";
};

const IDS = ["KOSPI", "KOSDAQ", "SPX", "COMP", "BTC", "USDKRW"] as const;
const NAMES = ["코스피", "코스닥", "S&P 500", "나스닥 종합", "비트코인", "원/달러 환율"] as const;
const DEFAULTS: CardQuote[] = IDS.map((id, index) => ({
  id,
  name: NAMES[index],
  price: 0,
  change: 0,
  rate: 0,
  unit: id === "BTC" || id === "USDKRW" ? "원" : "",
  trend: "flat",
}));

function parseNumber(value: string) {
  const match = value.replaceAll(",", "").match(/[+-]?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRate(value: string) {
  const match = value.replaceAll(",", "").match(/\(([+-]?\d+(?:\.\d+)?)\s*%\)/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function readOriginalCards(board: HTMLElement | null): CardQuote[] {
  if (!board) return DEFAULTS;
  const buttons = Array.from(board.querySelectorAll<HTMLButtonElement>(":scope > button"));
  return DEFAULTS.map((fallback, index) => {
    const button = buttons[index];
    if (!button) return fallback;
    const priceText = button.querySelector("strong")?.textContent ?? "";
    const changeNode = button.querySelector("em");
    const changeText = changeNode?.textContent ?? "";
    const nameText = button.querySelector("span")?.childNodes[0]?.textContent?.trim() || fallback.name;
    const trend = changeNode?.classList.contains("up") ? "up" : changeNode?.classList.contains("down") ? "down" : "flat";
    return {
      ...fallback,
      name: nameText,
      price: parseNumber(priceText),
      change: parseNumber(changeText),
      rate: parseRate(changeText),
      unit: priceText.includes("원") ? "원" : fallback.unit,
      trend,
    };
  });
}

function timezoneFor(id: string) {
  return id === "SPX" || id === "COMP" ? "America/New_York" : "Asia/Seoul";
}

function marketOpen(id: string) {
  if (id === "BTC") return true;
  const zone = timezoneFor(id);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(part("weekday"));
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  if (!weekday || !Number.isFinite(minutes)) return false;
  if (id === "SPX" || id === "COMP") return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  if (id === "USDKRW") return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

function statusText(id: string) {
  if (id === "BTC") return "24시간";
  if (id === "USDKRW") return marketOpen(id) ? "고시중" : "고시마감";
  return marketOpen(id) ? "장중" : "장마감";
}

function formatDate(id: string, points: Point[]) {
  const timestamp = points.at(-1)?.time ?? 0;
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezoneFor(id),
    month: "numeric",
    day: "numeric",
  }).format(new Date(timestamp));
}

function formatPrice(card: CardQuote) {
  if (!card.price) return "-";
  if (card.id === "BTC") return `${Math.round(card.price).toLocaleString("ko-KR")}`;
  if (card.id === "USDKRW") return card.price.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return card.price.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(card: CardQuote) {
  const sign = card.change > 0 ? "+" : "";
  const rateSign = card.rate > 0 ? "+" : "";
  const decimals = card.id === "BTC" ? 0 : 2;
  return `${sign}${card.change.toLocaleString("ko-KR", { maximumFractionDigits: decimals })} (${rateSign}${card.rate.toFixed(2)}%)`;
}

function Sparkline({ card, series }: { card: CardQuote; series?: Series }) {
  const points = useMemo(() => {
    const source = (series?.points ?? []).filter(point => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0);
    if (!source.length) return [];
    if (!marketOpen(card.id) || !card.price) return source;
    const last = source.at(-1);
    if (last && Math.abs(last.value - card.price) < Number.EPSILON) return source;
    return [...source, { time: (last?.time ?? 0) + 1, value: card.price }].slice(-500);
  }, [card.id, card.price, series]);

  if (points.length < 2) return <div className="home-index-sparkline empty" aria-hidden="true" />;

  const previousClose = card.price && card.change ? card.price - card.change : points[0].value;
  const values = [...points.map(point => point.value), previousClose].filter(value => Number.isFinite(value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, Math.abs(previousClose) * 0.0025, 1e-6);
  const paddedMin = min - spread * 0.1;
  const paddedMax = max + spread * 0.1;
  const width = 240;
  const height = 64;
  const y = (value: number) => height - ((value - paddedMin) / (paddedMax - paddedMin)) * height;
  const x = (index: number) => points.length === 1 ? 0 : (index / (points.length - 1)) * width;
  const baselineY = y(previousClose);

  return (
    <svg className="home-index-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${card.name} 당일 실시간 선차트`}>
      <line className="spark-baseline" x1="0" x2={width} y1={baselineY} y2={baselineY} />
      {points.slice(0, -1).map((point, index) => {
        const next = points[index + 1];
        const above = (point.value + next.value) / 2 >= previousClose;
        const path = `M ${x(index)} ${y(point.value)} L ${x(index + 1)} ${y(next.value)}`;
        const fill = `M ${x(index)} ${baselineY} L ${x(index)} ${y(point.value)} L ${x(index + 1)} ${y(next.value)} L ${x(index + 1)} ${baselineY} Z`;
        return (
          <g key={`${point.time}:${index}`} className={above ? "positive" : "negative"}>
            <path className="spark-fill" d={fill} />
            <path className="spark-line" d={path} />
          </g>
        );
      })}
    </svg>
  );
}

export default function HomeIndexBoard() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [quotes, setQuotes] = useState<CardQuote[]>(DEFAULTS);
  const [series, setSeries] = useState<Record<string, Series>>({});
  const originalBoardRef = useRef<HTMLElement | null>(null);
  const originalButtonsRef = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const original = document.querySelector<HTMLElement>(".np-home .np-market-focus .index-board:not([data-live-board])");
        if (!original) return;
        originalBoardRef.current = original;
        originalButtonsRef.current = Array.from(original.querySelectorAll<HTMLButtonElement>(":scope > button"));
        original.style.display = "none";
        let slot = original.parentElement?.querySelector<HTMLElement>(":scope > .home-index-board-slot");
        if (!slot && original.parentElement) {
          slot = document.createElement("div");
          slot.className = "home-index-board-slot";
          original.insertAdjacentElement("afterend", slot);
        }
        if (slot) setMount(current => current === slot ? current : slot);
        setQuotes(readOriginalCards(original));
      });
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      if (originalBoardRef.current) originalBoardRef.current.style.removeProperty("display");
    };
  }, []);

  useEffect(() => {
    if (!mount?.isConnected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/market-sparklines", { cache: "no-store" });
        if (!response.ok) throw new Error("SPARKLINE_FETCH_FAILED");
        const payload = await response.json() as SparklineResponse;
        if (!stopped && payload.series) setSeries(payload.series);
        const next = Math.max(30_000, Math.min(120_000, Number(payload.pollingInterval) || 60_000));
        if (!stopped) timer = setTimeout(load, next);
      } catch {
        if (!stopped) timer = setTimeout(load, 60_000);
      }
    };
    void load();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mount]);

  if (!mount?.isConnected) return null;

  return createPortal(
    <>
      <div className="index-board home-index-live-board" data-live-board="1">
        {quotes.map((card, index) => {
          const cardSeries = series[card.id];
          const trend = card.rate > 0 ? "up" : card.rate < 0 ? "down" : card.trend;
          return (
            <button
              type="button"
              className={`home-index-card ${trend}`}
              key={card.id}
              onClick={() => originalButtonsRef.current[index]?.click()}
            >
              <span className="home-index-name">{card.name}</span>
              <strong>{formatPrice(card)}</strong>
              <em>{formatChange(card)}</em>
              <Sparkline card={card} series={cardSeries} />
              <small>{formatDate(card.id, cardSeries?.points ?? [])}<i />{statusText(card.id)}</small>
            </button>
          );
        })}
      </div>
      <style>{`
        .home-index-board-slot{width:100%;min-width:0;background:#fff}
        .home-index-live-board{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;background:#fff}
        .home-index-live-board .home-index-card{min-width:0;min-height:214px;padding:22px 20px 16px;display:flex!important;flex-direction:column;align-items:stretch;gap:0;border:0;border-right:1px solid #edf0f2;border-bottom:1px solid #edf0f2;background:#fff;text-align:left;overflow:hidden}
        .home-index-live-board .home-index-card:nth-child(3n){border-right:0}
        .home-index-live-board .home-index-card:nth-child(n+4){border-bottom:0}
        .home-index-name{display:block!important;color:#202428!important;font-size:16px!important;font-weight:500!important;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .home-index-live-board .home-index-card>strong{display:block;grid-column:auto;margin-top:8px;color:#17191c;font-size:29px;font-weight:700;line-height:1.08;letter-spacing:-.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .home-index-live-board .home-index-card>em{display:block;grid-column:auto;margin-top:6px;font-size:15px;font-weight:500;font-style:normal;line-height:1.2;white-space:nowrap}
        .home-index-live-board .home-index-card.up>em{color:#e93648}.home-index-live-board .home-index-card.down>em{color:#2678d9}.home-index-live-board .home-index-card:not(.up):not(.down)>em{color:#6f7881}
        .home-index-sparkline{display:block;width:100%;height:62px;margin-top:12px;overflow:visible}.home-index-sparkline.empty{background:linear-gradient(180deg,transparent 48%,#edf0f2 49%,#edf0f2 51%,transparent 52%)}
        .home-index-sparkline .spark-baseline{stroke:#d9dde1;stroke-width:.8;stroke-dasharray:2 2;vector-effect:non-scaling-stroke}
        .home-index-sparkline .spark-line{fill:none;stroke-width:1.25;vector-effect:non-scaling-stroke}.home-index-sparkline .spark-fill{stroke:none;opacity:.08}
        .home-index-sparkline .positive .spark-line{stroke:#eb4d5c}.home-index-sparkline .positive .spark-fill{fill:#eb4d5c}.home-index-sparkline .negative .spark-line{stroke:#2d7ed8}.home-index-sparkline .negative .spark-fill{fill:#2d7ed8}
        .home-index-live-board .home-index-card>small{display:flex;align-items:center;gap:7px;margin-top:9px;color:#9aa0a6;font-size:12px;font-weight:400;line-height:1;white-space:nowrap}.home-index-live-board .home-index-card>small i{width:7px;height:7px;border-radius:50%;background:#d0d4d8;flex:none}
        @media(max-width:760px){
          .np-home-main>.live-market-strip{display:none!important}
          .home-index-live-board{grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .home-index-live-board .home-index-card{min-height:190px;padding:17px 12px 13px}
          .home-index-name{font-size:13px!important;letter-spacing:-.035em}
          .home-index-live-board .home-index-card>strong{margin-top:7px;font-size:22px;letter-spacing:-.035em}
          .home-index-live-board .home-index-card>em{margin-top:5px;font-size:12px;letter-spacing:-.025em}
          .home-index-sparkline{height:56px;margin-top:10px}
          .home-index-live-board .home-index-card>small{gap:5px;margin-top:8px;font-size:10px}.home-index-live-board .home-index-card>small i{width:6px;height:6px}
        }
        @media(max-width:390px){
          .home-index-live-board .home-index-card{min-height:180px;padding:15px 9px 12px}
          .home-index-name{font-size:12px!important}
          .home-index-live-board .home-index-card>strong{font-size:20px}
          .home-index-live-board .home-index-card>em{font-size:11px}
          .home-index-sparkline{height:52px}
          .home-index-live-board .home-index-card>small{font-size:9px}
        }
      `}</style>
    </>,
    mount,
  );
}
