"use client";

import { useEffect } from "react";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: number;
};

function relativeTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "날짜 미상";
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1_440)}일 전`;
}

function renderMarketNews(items: NewsItem[]) {
  const panel = document.querySelector<HTMLElement>(".np-home .np-news");
  if (!panel) return;

  const sorted = [...items]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item, index, all) => all.findIndex(other => other.title === item.title) === index)
    .slice(0, 10);

  const expectedSignature = sorted.map(item => `${item.link}:${item.publishedAt}`).join("|");
  const currentSignature = Array.from(panel.querySelectorAll<HTMLAnchorElement>(":scope > article > a"))
    .map(anchor => `${anchor.href}:${anchor.parentElement?.dataset.publishedAt ?? ""}`)
    .join("|");
  const currentTitle = panel.querySelector(".np-section-title h2")?.textContent?.trim() ?? "";
  if (currentTitle === "시장 종합 뉴스" && currentSignature === expectedSignature) return;

  const title = panel.querySelector<HTMLElement>(".np-section-title h2");
  if (title) title.textContent = "시장 종합 뉴스";
  const count = panel.querySelector<HTMLElement>(".np-section-title span");
  if (count) count.textContent = sorted.length ? `${sorted.length}건 · 최신순` : "";

  panel.querySelectorAll(":scope > article, :scope > p.np-empty").forEach(node => node.remove());

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "np-empty";
    empty.textContent = "표시할 시장 종합 뉴스가 없습니다.";
    panel.appendChild(empty);
    return;
  }

  for (const item of sorted) {
    const article = document.createElement("article");
    article.dataset.publishedAt = String(item.publishedAt);

    const link = document.createElement("a");
    link.href = item.link;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title;

    const meta = document.createElement("span");
    meta.textContent = `${item.source} · ${relativeTime(item.publishedAt)}`;

    article.append(link, meta);
    panel.appendChild(article);
  }
}

export default function HomeMarketNews() {
  useEffect(() => {
    let active = true;
    let items: NewsItem[] = [];
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;

    const patch = () => {
      if (!active || !document.querySelector(".np-home .np-news")) return;
      renderMarketNews(items);
    };

    const load = async () => {
      if (!active || loading || !document.querySelector(".np-home")) return;
      loading = true;
      try {
        const response = await fetch("/api/news?market=KR", { cache: "no-store" });
        const data = response.ok ? await response.json() as { items?: NewsItem[] } : null;
        if (!active) return;
        items = data?.items ?? [];
        renderMarketNews(items);
      } catch {
        // Keep the last successfully loaded market news.
      } finally {
        loading = false;
        if (active) refreshTimer = setTimeout(load, 90_000);
      }
    };

    const observer = new MutationObserver(() => {
      patch();
      if (!items.length) void load();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    patch();
    void load();
    return () => {
      active = false;
      observer.disconnect();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, []);

  return null;
}
