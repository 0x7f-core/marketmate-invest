"use client";

import { useEffect } from "react";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: number;
};

const MARKET_NEWS_SELECTOR = ".np-home .np-news, .np-single > .np-news";
const MOBILE_NEWS_TAB_ATTR = "data-market-news-tab";

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

function desktopNewsButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".np-desktop-header > nav button"))
    .find(button => button.textContent?.trim() === "뉴스") ?? null;
}

function insertBeforeMy(container: HTMLElement, button: HTMLButtonElement) {
  const myButton = Array.from(container.querySelectorAll<HTMLButtonElement>(":scope > button"))
    .find(candidate => candidate.textContent?.trim() === "MY");
  if (myButton) container.insertBefore(button, myButton);
  else container.appendChild(button);
}

function makeNewsIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute("d", "M4 4h16v16H4z");
  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line1.setAttribute("d", "M8 8h8");
  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line2.setAttribute("d", "M8 12h8");
  const line3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line3.setAttribute("d", "M8 16h5");
  svg.appendChild(outline);
  svg.appendChild(line1);
  svg.appendChild(line2);
  svg.appendChild(line3);
  return svg;
}

function ensureMobileNewsTabs() {
  const desktopNews = desktopNewsButton();
  if (!desktopNews) return;
  const active = desktopNews.classList.contains("active");
  const openNews = () => desktopNewsButton()?.click();

  const headerNav = document.querySelector<HTMLElement>(".np-mobile-header > nav");
  if (headerNav) {
    let button = headerNav.querySelector<HTMLButtonElement>(`button[${MOBILE_NEWS_TAB_ATTR}="header"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute(MOBILE_NEWS_TAB_ATTR, "header");
      button.textContent = "뉴스";
      button.addEventListener("click", openNews);
      insertBeforeMy(headerNav, button);
    }
    button.classList.toggle("active", active);
  }

  const bottomNav = document.querySelector<HTMLElement>(".np-mobile-bottom");
  if (bottomNav) {
    let button = bottomNav.querySelector<HTMLButtonElement>(`button[${MOBILE_NEWS_TAB_ATTR}="bottom"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute(MOBILE_NEWS_TAB_ATTR, "bottom");
      button.setAttribute("aria-label", "뉴스");
      button.addEventListener("click", openNews);
      button.appendChild(makeNewsIcon());
      const label = document.createElement("span");
      label.textContent = "뉴스";
      button.appendChild(label);
      insertBeforeMy(bottomNav, button);
    }
    button.classList.toggle("active", active);
  }
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
      ensureMobileNewsTabs();
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
