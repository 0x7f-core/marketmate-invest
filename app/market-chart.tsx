"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";

type Market = "KR" | "US" | "CRYPTO";
type QuoteLike = { market: Market; symbol: string; name: string; exchange: string };
type ChartPoint = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type ChartResponse = { points?: ChartPoint[]; range?: string; source?: string; stale?: boolean; error?: string };

const RANGES = ["1W", "1M", "3M", "1Y"] as const;

export default function MarketChart({ quote }: { quote: QuoteLike }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>("3M");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      attributionLogo: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#6b7280",
        fontFamily: "Arial, 'Noto Sans KR', sans-serif",
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: { borderColor: "#e5e7eb" },
      timeScale: { borderColor: "#e5e7eb", timeVisible: false, secondsVisible: false },
      crosshair: { vertLine: { labelBackgroundColor: "#374151" }, horzLine: { labelBackgroundColor: "#374151" } },
      localization: { locale: "ko-KR" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#f04452",
      downColor: "#3182f6",
      borderUpColor: "#f04452",
      borderDownColor: "#3182f6",
      wickUpColor: "#f04452",
      wickDownColor: "#3182f6",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const rows = points
      .filter(point => Number.isFinite(point.time) && point.time > 0 && point.open > 0 && point.high > 0 && point.low > 0 && point.close > 0)
      .map(point => ({
        time: Math.floor(point.time / 1_000) as UTCTimestamp,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      }));
    series.setData(rows);
    if (rows.length) chart.timeScale().fitContent();
  }, [points]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setMessage("");
    const params = new URLSearchParams({ market: quote.market, symbol: quote.symbol, exchange: quote.exchange, range });
    fetch(`/api/chart?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as ChartResponse;
        if (!response.ok || !result.points?.length) throw new Error(result.error || "차트 데이터를 불러오지 못했습니다.");
        setPoints(result.points);
        setStale(Boolean(result.stale));
        setStatus("ready");
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setPoints([]);
        setStale(false);
        setMessage(error instanceof Error ? error.message : "차트 데이터를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => controller.abort();
  }, [quote.market, quote.symbol, quote.exchange, range]);

  return (
    <section className="naver-light-chart" aria-label={`${quote.name} 차트`}>
      <div className="naver-light-chart-toolbar">
        <div>
          <b>차트</b>
          <small>{stale ? "네이버증권 캐시 시세" : "네이버증권"}</small>
        </div>
        <div className="naver-light-chart-ranges" role="tablist" aria-label="차트 기간">
          {RANGES.map(item => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}
        </div>
      </div>
      <div className="naver-light-chart-stage">
        <div ref={containerRef} className="naver-light-chart-canvas" />
        {status === "loading" && <div className="naver-light-chart-state">네이버증권 차트를 불러오는 중...</div>}
        {status === "error" && <div className="naver-light-chart-state error"><b>차트를 표시할 수 없습니다.</b><span>{message}</span><button onClick={() => setRange(current => current === "3M" ? "1M" : "3M")}>다시 시도</button></div>}
      </div>
    </section>
  );
}
