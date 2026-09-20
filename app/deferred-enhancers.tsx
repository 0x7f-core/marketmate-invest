"use client";

import { createElement, useEffect, useState, type ComponentType } from "react";

type Enhancer = ComponentType;
type EnhancerLoader = {
  key: string;
  load: () => Promise<{ default: Enhancer }>;
  isRelevant: () => boolean;
};

const has = (selector: string) => () => Boolean(document.querySelector(selector));

// Enhancers used to download and mount all 16 observers after every page load.
// Keep the chunks available, but only load a feature after its DOM is present.
// This preserves SPA navigation while removing unrelated work from the first view.
const enhancerLoaders: readonly EnhancerLoader[] = [
  { key: "activity-price-details", load: () => import("./activity-price-details"), isRelevant: has(".trade-history, .activity-dialog") },
  { key: "activity-quantity-units", load: () => import("./activity-quantity-units"), isRelevant: has(".activity-dialog") },
  { key: "crypto-source-labels", load: () => import("./crypto-source-labels"), isRelevant: has(".np-market-status, .live-market-strip, .index-board, .trading-guide, .contest-overview, .np-quote") },
  { key: "desktop-nav-label", load: () => import("./desktop-nav-label"), isRelevant: has(".np-desktop-header nav") },
  { key: "desktop-search-favorites", load: () => import("./desktop-search-favorites"), isRelevant: has(".np-desktop-header .search-wrap") },
  { key: "home-dashboard-order", load: () => import("./home-dashboard-order"), isRelevant: has(".np-home") },
  { key: "home-index-board", load: () => import("./home-index-board"), isRelevant: has(".np-home .np-market-focus .index-board") },
  { key: "home-market-news", load: () => import("./home-market-news"), isRelevant: has(".np-home .np-news, .marketmate-v2 > main.np-single > .np-news") },
  { key: "home-market-ranking-logos", load: () => import("./home-market-ranking-logos"), isRelevant: has(".mm-market-rankings") },
  { key: "home-market-rankings", load: () => import("./home-market-rankings"), isRelevant: has(".np-home .np-home-main") },
  { key: "market-status-closed-time", load: () => import("./market-status-closed-time"), isRelevant: has(".np-market-status") },
  { key: "mobile-instrument-search", load: () => import("./mobile-instrument-search"), isRelevant: has(".np-mobile-header") },
  { key: "portfolio-average-prices", load: () => import("./portfolio-average-prices"), isRelevant: has(".np-panel.holdings") },
  { key: "portfolio-bulk-sell", load: () => import("./portfolio-bulk-sell"), isRelevant: has(".np-panel.holdings") },
  { key: "quote-identity-guard", load: () => import("./quote-identity-guard"), isRelevant: has(".np-quote") },
  { key: "trading-fee-guide", load: () => import("./trading-fee-guide"), isRelevant: has(".trading-guide") },
] as const;

function scheduleAfterFirstPaint(callback: () => void) {
  let timer: number | undefined;
  let idle: number | undefined;
  const frame = window.requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(callback, { timeout: 1_500 });
    } else {
      timer = window.setTimeout(callback, 0);
    }
  });

  return () => {
    window.cancelAnimationFrame(frame);
    if (idle !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idle);
    }
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

export default function DeferredEnhancers() {
  const [enhancers, setEnhancers] = useState<Array<{ key: string; component: Enhancer }>>([]);

  useEffect(() => {
    let active = true;
    const loaded = new Set<string>();
    const loading = new Set<string>();
    let scheduled = false;
    let frame = 0;

    const loadRelevant = () => {
      if (!active) return;
      for (const entry of enhancerLoaders) {
        if (loaded.has(entry.key) || loading.has(entry.key) || !entry.isRelevant()) continue;
        loading.add(entry.key);
        void entry.load()
          .then(module => {
            if (!active) return;
            loaded.add(entry.key);
            setEnhancers(current => current.some(item => item.key === entry.key)
              ? current
              : [...current, { key: entry.key, component: module.default }]);
          })
          .catch(() => undefined)
          .finally(() => loading.delete(entry.key));
      }
    };

    const scheduleLoad = () => {
      if (scheduled) return;
      scheduled = true;
      frame = window.requestAnimationFrame(() => {
        scheduled = false;
        loadRelevant();
      });
    };

    const observer = new MutationObserver(scheduleLoad);
    observer.observe(document.body, { childList: true, subtree: true });
    const cancelSchedule = scheduleAfterFirstPaint(loadRelevant);

    return () => {
      active = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      cancelSchedule();
    };
  }, []);

  if (!enhancers.length) return null;

  return <>{enhancers.map(({ key, component }) => createElement(component, { key }))}</>;
}
