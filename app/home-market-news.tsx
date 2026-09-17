"use client";

import { useEffect } from "react";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: number;
};

const MARKET_NEWS_SELECTOR = ".np-home .np-news, .np-single > .np-news";

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

function removeLegacyMobileNewsTabs() {
  document.querySelectorAll<HTMLElement>("[data-market-news-tab]").forEach(node => node.remove());
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
  const currentTitle = panel.querySelector(".np-section-title h2")?.textContent?.trim() ?? "";
  if (currentTitle === "주요 뉴스" && currentSignature === expectedSignature) return;

  const title = panel.querySelector<HTMLElement>(".np-section-title h2");
  if (title) title.textContent = "주요 뉴스";
  const count = panel.querySelector<HTMLElement>(".np-section-title span");
  if (count) count.textContent = sorted.length ? `${sorted.length}건 · 최신순` : "";

  panel.querySelectorAll(":scope > article, :scope > p.np-empty").forEach(node => node.remove());

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "np-empty";
    empty.textContent = "표시할 주요 뉴스가 없습니다.";
    panel.appendChild(empty);
    return;
  }

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

function renderMarketNews(items: NewsItem[]) {
  for (const panel of marketNewsPanels()) renderPanel(panel, items);
}

export default function HomeMarketNews() {
  useEffect(() => {
    let active = true;
    let items: NewsItem[] = [];
    let loading = false;
    let lastLoadedAt = 0;

    const load = async () => {
      if (!active || loading) return;
      loading = true;
      try {
        const response = await fetch("/api/news?market=KR", { cache: "no-store" });
        const data = response.ok ? await response.json() as { items?: NewsItem[] } : null;
        if (!active) return;
        items = data?.items ?? [];
        lastLoadedAt = Date.now();
        renderMarketNews(items);
      } catch {
        // Keep the last successfully loaded market news.
      } finally {
        loading = false;
      }
    };

    const tick = () => {
      if (!active) return;
      // Older releases injected a second mobile News button from this component.
      // Navigation now lives entirely in trading-dashboard.tsx, so clean up only
      // those legacy DOM nodes and never create navigation controls here.
      removeLegacyMobileNewsTabs();
      if (marketNewsPanels().length === 0) return;
      if (!items.length || Date.now() - lastLoadedAt >= 90_000) {
        void load();
        return;
      }
      renderMarketNews(items);
    };

    const timer = window.setInterval(tick, 1_500);
    tick();

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
