"use client";

import { createElement, useEffect, useState, type ComponentType } from "react";

type Enhancer = ComponentType;

const enhancerLoaders = [
  () => import("./activity-price-details"),
  () => import("./activity-quantity-units"),
  () => import("./crypto-source-labels"),
  () => import("./desktop-nav-label"),
  () => import("./desktop-search-favorites"),
  () => import("./home-dashboard-order"),
  () => import("./home-index-board"),
  () => import("./home-market-news"),
  () => import("./home-market-ranking-logos"),
  () => import("./home-market-rankings"),
  () => import("./market-status-closed-time"),
  () => import("./mobile-instrument-search"),
  () => import("./portfolio-average-prices"),
  () => import("./portfolio-bulk-sell"),
  () => import("./quote-identity-guard"),
  () => import("./trading-fee-guide"),
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
  const [enhancers, setEnhancers] = useState<Enhancer[] | null>(null);

  useEffect(() => {
    let active = true;
    const cancelSchedule = scheduleAfterFirstPaint(() => {
      void Promise.all(
        enhancerLoaders.map(async (load) => {
          try {
            return (await load()).default as Enhancer;
          } catch {
            return null;
          }
        }),
      ).then((loaded) => {
        if (active) {
          setEnhancers(loaded.filter((component): component is Enhancer => component !== null));
        }
      });
    });

    return () => {
      active = false;
      cancelSchedule();
    };
  }, []);

  if (!enhancers) return null;

  return <>{enhancers.map((Enhancer, index) => createElement(Enhancer, { key: `enhancer-${index}` }))}</>;
}
