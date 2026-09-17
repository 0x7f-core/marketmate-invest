"use client";

import { useEffect } from "react";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: number;
};

// Home and the dedicated News tab intentionally share one market-wide feed.
// The single-stock market view remains owned by TradingDashboard and keeps its own symbol news.
const MARKET_NEWS_SELECTOR = ".np-home .np-news, .marketmate-v2 > main.np-single > .np-news";
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

function renderPanel(panel: HTMLElement, items: NewsItem[]) {
  const sorted = [...items]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item, index, all) => all.findIndex(other => other.title === item.title) === index)
    .slice(0, 10);

  const expectedSignature = sorted.map(item => `${normalizedLink(item.link)}:${item.publishedAt}:${item.source}`).join("|");
  const currentSignature = Array.from(panel.querySelectorAll<HTMLAnchorElement>(":scope > article > a"))
    .map(anchor => `${anchor.href}:${anchor.parentElement?.dataset.publishedAt ?? ""}:${anchor.parentElement?.dataset.source ?? ""}`)
    .join("|");

  const title = panel.querySelector<HTMLElement>(".np-section-title h2");
  if (title) title.textContent = "주요 시장 뉴스";
  const count = panel.querySelector<HTMLElement>(".np-section-title span");
  if (count) count.textContent = sorted.length ? `${sorted.length}건 · 최신순` : "";

  if (currentSignature !== expectedSignature) {
    panel.querySelectorAll(":scope > article, :scope > p.np-empty").forEach(node => node.remove());

    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.className = "np-empty";
      empty.textContent = "표시할 주요 뉴스가 없습니다.";
      panel.appendChild(empty);
    } else {
      for (const item of sorted) {
        const article = document.createElement("article");
        article.dataset.publishedAt = String(item.publishedAt);
        article.dataset.source = item.source;

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
    }
  }

  // The panel is kept invisible until the market-wide payload has replaced
  // whatever symbol-specific markup TradingDashboard rendered initially.
  panel.dataset.marketNewsReady = "true";
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
        // Never reveal the symbol-specific placeholder as a fallback.
        // If we already have a successful market snapshot, keep using it.
        if (items) renderMarketNews(items);
      } finally {
        loading = false;
      }
    };

    const syncVisiblePanels = () => {
      if (!active || marketNewsPanels().length === 0) return;
      if (items) renderMarketNews(items);
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

    // Fetch once globally. Home and News then render from this exact same snapshot.
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
      .np-home .np-news:not([data-market-news-ready="true"]),
      .marketmate-v2 > main.np-single > .np-news:not([data-market-news-ready="true"]) {
        visibility: hidden !important;
      }
    `}</style>
  );
}
