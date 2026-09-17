"use client";

import { useEffect } from "react";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: number;
};

// Home and the dedicated News tab intentionally share one market-wide feed.
// Home stays compact at 10 items, while the News tab exposes the latest 30.
// The single-stock market view remains owned by TradingDashboard and keeps its own symbol news.
const MARKET_NEWS_SELECTOR = ".np-home .np-news, .marketmate-v2 > main.np-single > .np-news";
const SYNCED_SELECTOR = "[data-market-news-synced=\"true\"]";
const REFRESH_MS = 30_000;

function relativeTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "날짜 미상";
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1_440)}일 전`;
}

function normalizedLink(value: string) {
  try {
    return new URL(value, window.location.origin).href;
  } catch {
    return value;
  }
}

function marketNewsPanels() {
  return Array.from(document.querySelectorAll<HTMLElement>(MARKET_NEWS_SELECTOR));
}

function panelLimit(panel: HTMLElement) {
  return panel.closest(".np-home") ? 10 : 30;
}

function markSynced<T extends HTMLElement>(element: T) {
  element.dataset.marketNewsSynced = "true";
  return element;
}

function clearSynced(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>(`:scope > ${SYNCED_SELECTOR}`).forEach(node => node.remove());
}

function appendTitle(panel: HTMLElement, countText = "") {
  const titleWrap = markSynced(document.createElement("div"));
  titleWrap.className = "np-section-title";

  const title = document.createElement("h2");
  title.textContent = "주요 뉴스";
  const count = document.createElement("span");
  count.textContent = countText;

  titleWrap.appendChild(title);
  titleWrap.appendChild(count);
  panel.appendChild(titleWrap);
}

function renderLoading(panel: HTMLElement) {
  if (panel.querySelector(`:scope > ${SYNCED_SELECTOR}`)) return;
  appendTitle(panel);
  const loading = markSynced(document.createElement("p"));
  loading.className = "np-empty";
  loading.textContent = "최신 주요 뉴스를 불러오는 중입니다.";
  panel.appendChild(loading);
}

function renderPanel(panel: HTMLElement, items: NewsItem[]) {
  const limit = panelLimit(panel);
  const sorted = [...items]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item, index, all) => all.findIndex(other => other.title === item.title) === index)
    .slice(0, limit);

  const signature = `${limit}|${sorted.map(item => `${normalizedLink(item.link)}:${item.publishedAt}:${item.source}`).join("|")}`;
  if (panel.dataset.marketNewsSignature === signature && panel.querySelector(`:scope > ${SYNCED_SELECTOR}`)) return;

  clearSynced(panel);
  appendTitle(panel, sorted.length ? `${sorted.length}건 · 최신순` : "");

  if (!sorted.length) {
    const empty = markSynced(document.createElement("p"));
    empty.className = "np-empty";
    empty.textContent = "표시할 주요 뉴스가 없습니다.";
    panel.appendChild(empty);
    panel.dataset.marketNewsSignature = signature;
    return;
  }

  for (const item of sorted) {
    const article = markSynced(document.createElement("article"));

    const link = document.createElement("a");
    link.href = item.link;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title;

    const meta = document.createElement("span");
    meta.textContent = `${item.source} · ${relativeTime(item.publishedAt)}`;

    article.appendChild(link);
    article.appendChild(meta);
    panel.appendChild(article);
  }

  panel.dataset.marketNewsSignature = signature;
}

function renderMarketNews(items: NewsItem[]) {
  for (const panel of marketNewsPanels()) renderPanel(panel, items);
}

export default function HomeMarketNews() {
  useEffect(() => {
    let active = true;
    let items: NewsItem[] | null = null;
    let loading = false;
    let lastLoadedAt = 0;

    const load = async (force = false) => {
      if (!active || loading) return;
      if (!force && items && Date.now() - lastLoadedAt < REFRESH_MS) {
        renderMarketNews(items);
        return;
      }

      loading = true;
      try {
        // No symbol on purpose: KR MAINNEWS is the shared market-wide feed
        // for both Home and the dedicated News tab.
        const response = await fetch(`/api/news?market=KR&_=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        const data = response.ok ? await response.json() as { items?: NewsItem[] } : null;
        if (!active) return;
        items = (data?.items ?? []).sort((a, b) => b.publishedAt - a.publishedAt);
        lastLoadedAt = Date.now();
        renderMarketNews(items);
      } catch {
        // Never fall back to the hidden symbol-specific markup.
        if (items) renderMarketNews(items);
      } finally {
        loading = false;
      }
    };

    const syncVisiblePanels = () => {
      if (!active) return;
      const panels = marketNewsPanels();
      if (!panels.length) return;
      for (const panel of panels) {
        if (items) renderPanel(panel, items);
        else renderLoading(panel);
      }
      void load(false);
    };

    const observer = new MutationObserver(syncVisiblePanels);
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, REFRESH_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    syncVisiblePanels();
    void load(true);

    return () => {
      active = false;
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <style>{`
      /* TradingDashboard may still render selected-stock news internally for these views.
         Keep every React-owned child hidden and expose only the single shared market feed. */
      .np-home .np-news > :not([data-market-news-synced="true"]),
      .marketmate-v2 > main.np-single > .np-news > :not([data-market-news-synced="true"]) {
        display: none !important;
      }
    `}</style>
  );
}
