"use client";

import { useEffect, useRef, useState } from "react";

type Market = "KR" | "US" | "CRYPTO";
type QuoteLike = { market: Market; symbol: string; name: string; exchange: string };
type ChartPoint = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type ChartPeriod = "DAY" | "WEEK" | "MONTH" | "YEAR";
type ChartResponse = { points?: ChartPoint[]; period?: ChartPeriod; source?: string; stale?: boolean; error?: string };
type CandleRow = { time: number; open: number; high: number; low: number; close: number };
type HistogramRow = { time: number; value: number; color: string };
type ChartSeries = { setData: (rows: CandleRow[] | HistogramRow[]) => void };
type PriceScaleApi = { applyOptions: (options: Record<string, unknown>) => void };
type ChartApi = { addSeries: (seriesType: unknown, options: Record<string, unknown>) => ChartSeries; priceScale: (id: string) => PriceScaleApi; resize: (width: number, height: number) => void; remove: () => void; timeScale: () => { fitContent: () => void } };
type LightweightChartsApi = { createChart: (container: HTMLElement, options: Record<string, unknown>) => ChartApi; CandlestickSeries: unknown; HistogramSeries: unknown };

declare global {
  interface Window { LightweightCharts?: LightweightChartsApi }
}

const PERIODS = [
  { value: "DAY", label: "일봉" },
  { value: "WEEK", label: "주봉" },
  { value: "MONTH", label: "월봉" },
  { value: "YEAR", label: "년봉" },
] as const;
const LIGHTWEIGHT_CHARTS_URL = "https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js";
let chartLibraryPromise: Promise<LightweightChartsApi> | null = null;

function loadLightweightCharts() {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 차트를 표시할 수 있습니다."));
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  chartLibraryPromise ??= new Promise<LightweightChartsApi>((resolve, reject) => {
    const orphan = document.querySelector<HTMLScriptElement>(`script[src="${LIGHTWEIGHT_CHARTS_URL}"]`);
    if (orphan && !window.LightweightCharts) orphan.remove();
    const script = document.createElement("script");
    const finish = () => window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error("차트 라이브러리를 초기화하지 못했습니다."));
    const fail = () => {
      script.remove();
      reject(new Error("차트 라이브러리를 불러오지 못했습니다."));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    script.src = LIGHTWEIGHT_CHARTS_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  }).catch(error => {
    chartLibraryPromise = null;
    const failed = document.querySelector<HTMLScriptElement>(`script[src="${LIGHTWEIGHT_CHARTS_URL}"]`);
    if (failed && !window.LightweightCharts) failed.remove();
    throw error;
  });
  return chartLibraryPromise;
}

export default function MarketChart({ quote, indexId }: { quote: QuoteLike; indexId?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const seriesRef = useRef<ChartSeries | null>(null);
  const volumeSeriesRef = useRef<ChartSeries | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const [period, setPeriod] = useState<ChartPeriod>("DAY");
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
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;
    setChartReady(false);
    setLibraryStatus("loading");
    setLibraryMessage("");
    void loadLightweightCharts().then(library => {
      if (cancelled || !containerRef.current) return;
      const chart = library.createChart(containerRef.current, {
        autoSize: false,
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
        layout: {
          attributionLogo: true,
          background: { type: "solid", color: "#ffffff" },
          textColor: "#8a9199",
          fontFamily: "Arial, 'Noto Sans KR', sans-serif",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#f0f1f3" },
          horzLines: { color: "#f0f1f3" },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.25 } },
        timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false, rightOffset: 2, barSpacing: 7 },
        crosshair: {
          vertLine: { color: "#7d858d", width: 1, style: 3, labelBackgroundColor: "#3f444a" },
          horzLine: { color: "#7d858d", width: 1, style: 3, labelBackgroundColor: "#3f444a" },
        },
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
      const volumeSeries = chart.addSeries(library.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("volume").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.78, bottom: 0.02 },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      volumeSeriesRef.current = volumeSeries;
      const syncChartSize = () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width > 0 && height > 0) chart.resize(width, height);
      };
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(syncChartSize);
        resizeObserver.observe(container);
      }
      resizeFrame = requestAnimationFrame(syncChartSize);
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
      resizeObserver?.disconnect();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [retryToken, indexId]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!chartReady || !series || !chart) return;
    const valid = points.filter(point => Number.isFinite(point.time) && point.time > 0 && point.close > 0);
    const rows = valid
      .filter(point => point.open > 0 && point.high > 0 && point.low > 0)
      .map((point, index) => {
        if (indexId !== "USDKRW") {
          return { time: Math.floor(point.time / 1_000), open: point.open, high: point.high, low: point.low, close: point.close };
        }
        // Naver's FX time-series response contains only closing rates. Use the
        // previous close as the session open so the FX chart keeps the same
        // candle presentation without inventing an intraday high/low range.
        const open = valid[index - 1]?.close ?? point.close;
        return {
          time: Math.floor(point.time / 1_000),
          open,
          high: Math.max(open, point.close),
          low: Math.min(open, point.close),
          close: point.close,
        };
      });
    series.setData(rows);
    volumeSeriesRef.current?.setData(valid
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => Number.isFinite(point.volume) && Number(point.volume) > 0)
      .map(({ point, index }) => {
        const open = indexId === "USDKRW" ? valid[index - 1]?.close ?? point.close : point.open;
        return {
          time: Math.floor(point.time / 1_000),
          value: Number(point.volume),
          color: point.close >= open ? "rgba(239,75,85,.72)" : "rgba(60,127,219,.72)",
        };
      }));
    if (rows.length) chart.timeScale().fitContent();
  }, [points, chartReady, indexId]);

  useEffect(() => {
    const controller = new AbortController();
    setDataStatus("loading");
    setDataMessage("");
    const params = new URLSearchParams({ market: quote.market, symbol: quote.symbol, exchange: quote.exchange, period });
    if (indexId) {
      params.set("kind", "index");
      params.set("id", indexId);
    }
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
  }, [quote.market, quote.symbol, quote.exchange, indexId, period, retryToken]);

  const loading = libraryStatus === "loading" || dataStatus === "loading";
  const errorMessage = libraryStatus === "error" ? libraryMessage : dataStatus === "error" ? dataMessage : "";
  return (
    <section className="naver-light-chart" aria-label={`${quote.name} 차트`}>
      <div className="naver-light-chart-toolbar">
        <div>
          <b>차트</b>
          <small>{stale ? "네이버증권 캐시 시세" : indexId === "USDKRW" ? "네이버 종가 기준" : "네이버증권"}</small>
        </div>
        <div className="naver-light-chart-ranges" role="tablist" aria-label="차트 기간">
          {PERIODS.map(item => <button key={item.value} role="tab" className={period === item.value ? "active" : ""} aria-selected={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</button>)}
        </div>
      </div>
      <div className="naver-light-chart-stage">
        <div ref={containerRef} className="naver-light-chart-canvas" />
        {loading && <div className="naver-light-chart-state">네이버증권 차트를 불러오는 중...</div>}
        {!loading && errorMessage && <div className="naver-light-chart-state error"><b>차트를 표시할 수 없습니다.</b><span>{errorMessage}</span><button onClick={() => setRetryToken(value => value + 1)}>다시 시도</button></div>}
      </div>
      <a className="naver-light-chart-attribution" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
        TradingView Lightweight Charts™ © 2025 TradingView, Inc.
      </a>
    </section>
  );
}
