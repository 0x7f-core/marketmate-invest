"use client";

import { useEffect, useRef, useState } from "react";

type Market = "KR" | "US" | "CRYPTO";
type QuoteLike = { market: Market; symbol: string; name: string; exchange: string };
type ChartPoint = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type ChartResponse = { points?: ChartPoint[]; range?: string; source?: string; stale?: boolean; error?: string };
type CandleRow = { time: number; open: number; high: number; low: number; close: number };
type CandleSeries = { setData: (rows: CandleRow[]) => void };
type ChartApi = { addSeries: (seriesType: unknown, options: Record<string, unknown>) => CandleSeries; remove: () => void; timeScale: () => { fitContent: () => void } };
type LightweightChartsApi = { createChart: (container: HTMLElement, options: Record<string, unknown>) => ChartApi; CandlestickSeries: unknown };

declare global {
  interface Window { LightweightCharts?: LightweightChartsApi }
}

const RANGES = ["1W", "1M", "3M", "1Y"] as const;
const LIGHTWEIGHT_CHARTS_URL = "https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js";
let chartLibraryPromise: Promise<LightweightChartsApi> | null = null;

function loadLightweightCharts() {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 차트를 표시할 수 있습니다."));
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  chartLibraryPromise ??= new Promise<LightweightChartsApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LIGHTWEIGHT_CHARTS_URL}"]`);
    const script = existing ?? document.createElement("script");
    const finish = () => window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error("차트 라이브러리를 초기화하지 못했습니다."));
    const fail = () => {
      if (!window.LightweightCharts) script.remove();
      reject(new Error("차트 라이브러리를 불러오지 못했습니다."));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = LIGHTWEIGHT_CHARTS_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  }).catch(error => {
    chartLibraryPromise = null;
    const failed = document.querySelector<HTMLScriptElement>(`script[src="${LIGHTWEIGHT_CHARTS_URL}"]`);
    if (failed && !window.LightweightCharts) failed.remove();
    throw error;
  });
  return chartLibraryPromise;
}

export default function MarketChart({ quote }: { quote: QuoteLike }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const seriesRef = useRef<CandleSeries | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const [range, setRange] = useState<(typeof RANGES)[number]>("3M");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const [dataMessage, setDataMessage] = useState("");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    setChartReady(false);
    setLibraryStatus("loading");
    setLibraryMessage("");
    void loadLightweightCharts().then(library => {
      if (cancelled || !containerRef.current) return;
      const chart = library.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          attributionLogo: true,
          background: { type: "solid", color: "#ffffff" },
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
      const series = chart.addSeries(library.CandlestickSeries, {
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
      setChartReady(true);
      setLibraryStatus("ready");
    }).catch(error => {
      if (!cancelled) {
        setLibraryMessage(error instanceof Error ? error.message : "차트 라이브러리를 불러오지 못했습니다.");
        setLibraryStatus("error");
      }
    });
    return () => {
      cancelled = true;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [retryToken]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!chartReady || !series || !chart) return;
    const rows = points
      .filter(point => Number.isFinite(point.time) && point.time > 0 && point.open > 0 && point.high > 0 && point.low > 0 && point.close > 0)
      .map(point => ({ time: Math.floor(point.time / 1_000), open: point.open, high: point.high, low: point.low, close: point.close }));
    series.setData(rows);
    if (rows.length) chart.timeScale().fitContent();
  }, [points, chartReady]);

  useEffect(() => {
    const controller = new AbortController();
    setDataStatus("loading");
    setDataMessage("");
    const params = new URLSearchParams({ market: quote.market, symbol: quote.symbol, exchange: quote.exchange, range });
    fetch(`/api/chart?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as ChartResponse;
        if (!response.ok || !result.points?.length) throw new Error(result.error || "차트 데이터를 불러오지 못했습니다.");
        setPoints(result.points);
        setStale(Boolean(result.stale));
        setDataStatus("ready");
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setPoints([]);
        setStale(false);
        setDataMessage(error instanceof Error ? error.message : "차트 데이터를 불러오지 못했습니다.");
        setDataStatus("error");
      });
    return () => controller.abort();
  }, [quote.market, quote.symbol, quote.exchange, range, retryToken]);

  const loading = libraryStatus === "loading" || dataStatus === "loading";
  const errorMessage = libraryStatus === "error" ? libraryMessage : dataStatus === "error" ? dataMessage : "";

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
        {loading && <div className="naver-light-chart-state">네이버증권 차트를 불러오는 중...</div>}
        {!loading && errorMessage && <div className="naver-light-chart-state error"><b>차트를 표시할 수 없습니다.</b><span>{errorMessage}</span><button onClick={() => setRetryToken(value => value + 1)}>다시 시도</button></div>}
      </div>
    </section>
  );
}
