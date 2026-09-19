"use client";

import { useEffect, useRef, useState } from "react";

type Market = "KR" | "US" | "CRYPTO";
type QuoteLike = { market: Market; symbol: string; name: string; exchange: string };
type ChartPoint = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type ChartResponse = { points?: ChartPoint[]; range?: string; source?: string; stale?: boolean; error?: string };
type CandleRow = { time: number; open: number; high: number; low: number; close: number };
type LineRow = { time: number; value: number };
type HistogramRow = { time: number; value: number; color: string };
type ChartSeries = { setData: (rows: CandleRow[] | LineRow[] | HistogramRow[]) => void };
type ChartApi = { addSeries: (seriesType: unknown, options: Record<string, unknown>) => ChartSeries; remove: () => void; timeScale: () => { fitContent: () => void } };
type LightweightChartsApi = { createChart: (container: HTMLElement, options: Record<string, unknown>) => ChartApi; CandlestickSeries: unknown; LineSeries: unknown; HistogramSeries: unknown };

declare global {
  interface Window { LightweightCharts?: LightweightChartsApi }
}

const RANGES = ["1W", "1M", "3M", "1Y"] as const;
const FX_RANGES = ["1M", "3M", "1Y"] as const;
type FxChartImages = Partial<Record<(typeof FX_RANGES)[number], string>>;
const DEFAULT_FX_CHART_IMAGES: Record<(typeof FX_RANGES)[number], string> = {
  "1M": "https://financial-vn.pstatic.net/chart/mobile/marketindex/month/FX_USDKRW_end.png",
  "3M": "https://financial-vn.pstatic.net/chart/mobile/marketindex/month3/FX_USDKRW_end.png",
  "1Y": "https://financial-vn.pstatic.net/chart/mobile/marketindex/year/FX_USDKRW_end.png",
};
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

export default function MarketChart({ quote, indexId, fxChartImages }: { quote: QuoteLike; indexId?: string; fxChartImages?: FxChartImages }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const seriesRef = useRef<ChartSeries | null>(null);
  const volumeSeriesRef = useRef<ChartSeries | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const [range, setRange] = useState<(typeof RANGES)[number]>("3M");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const [dataMessage, setDataMessage] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [fxPageLoadToken, setFxPageLoadToken] = useState("");
  const isFxImageChart = indexId === "USDKRW";
  const fxRange = range === "1M" || range === "1Y" ? range : "3M";
  const fxImageBaseUrl = fxChartImages?.[fxRange] || DEFAULT_FX_CHART_IMAGES[fxRange];
  const fxImageUrl = fxPageLoadToken
    ? `${fxImageBaseUrl}${fxImageBaseUrl.includes("?") ? "&" : "?"}v=${fxPageLoadToken}`
    : "";

  useEffect(() => {
    if (!isFxImageChart || fxPageLoadToken) return;
    const pageLoadToken = typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin)
      ? Math.round(performance.timeOrigin)
      : Date.now();
    setFxPageLoadToken(String(pageLoadToken));
  }, [isFxImageChart, fxPageLoadToken]);

  useEffect(() => {
    if (isFxImageChart) {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      setChartReady(false);
      return;
    }
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
      const series = indexId === "USDKRW"
        ? chart.addSeries(library.LineSeries, {
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
        })
        : chart.addSeries(library.CandlestickSeries, {
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
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      volumeSeriesRef.current = volumeSeries;
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
      volumeSeriesRef.current = null;
    };
  }, [retryToken, indexId, isFxImageChart]);

  useEffect(() => {
    if (isFxImageChart) return;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!chartReady || !series || !chart) return;
    const valid = points.filter(point => Number.isFinite(point.time) && point.time > 0 && point.close > 0);
    const rows = indexId === "USDKRW"
      ? valid.map(point => ({ time: Math.floor(point.time / 1_000), value: point.close }))
      : valid
        .filter(point => point.open > 0 && point.high > 0 && point.low > 0)
        .map(point => ({ time: Math.floor(point.time / 1_000), open: point.open, high: point.high, low: point.low, close: point.close }));
    series.setData(rows);
    volumeSeriesRef.current?.setData(valid.map(point => ({
      time: Math.floor(point.time / 1_000),
      value: Math.max(0, Number(point.volume ?? 0)),
      color: point.close >= point.open ? "rgba(239,75,85,.72)" : "rgba(60,127,219,.72)",
    })));
    if (rows.length) chart.timeScale().fitContent();
  }, [points, chartReady, indexId, isFxImageChart]);

  useEffect(() => {
    if (isFxImageChart) return;
    const controller = new AbortController();
    setDataStatus("loading");
    setDataMessage("");
    const params = new URLSearchParams({ market: quote.market, symbol: quote.symbol, exchange: quote.exchange, range });
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
  }, [quote.market, quote.symbol, quote.exchange, indexId, range, retryToken, isFxImageChart]);

  if (isFxImageChart) {
    return (
      <section className="naver-light-chart naver-fx-image-chart" aria-label={`${quote.name} 차트`}>
        <div className="naver-light-chart-toolbar">
          <div>
            <b>차트</b>
            <small>네이버증권</small>
          </div>
          <div className="naver-light-chart-ranges" role="tablist" aria-label="차트 기간">
            {FX_RANGES.map(item => <button key={item} className={fxRange === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}
          </div>
        </div>
        <div className="naver-light-chart-stage naver-fx-image-stage">
          <div
            className="naver-fx-chart-image"
            role="img"
            aria-label={`${quote.name} ${fxRange} 차트`}
            style={{ backgroundImage: fxImageUrl ? `url("${fxImageUrl}")` : "none" }}
          />
        </div>
      </section>
    );
  }

  const loading = libraryStatus === "loading" || dataStatus === "loading";
  const errorMessage = libraryStatus === "error" ? libraryMessage : dataStatus === "error" ? dataMessage : "";
  const latestPoint = points.at(-1);
  const formatMetric = (value?: number) => Number.isFinite(value) ? Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : "-";

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
      <div className="chart-ohlcv" aria-live="polite">
        <span>시 <b>{formatMetric(latestPoint?.open)}</b></span>
        <span>고 <b className="up">{formatMetric(latestPoint?.high)}</b></span>
        <span>저 <b className="down">{formatMetric(latestPoint?.low)}</b></span>
        <span>종 <b>{formatMetric(latestPoint?.close)}</b></span>
        <span>거래량 <b>{formatMetric(latestPoint?.volume)}</b></span>
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
