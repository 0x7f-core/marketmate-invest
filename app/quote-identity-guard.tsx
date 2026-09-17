"use client";

import { useEffect } from "react";

type Market = "KR" | "US" | "CRYPTO";
type Instrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
};

function activeMarket(): Market | null {
  const active = Array.from(document.querySelectorAll(".np-market-tabs button")).find(button => button.classList.contains("active"));
  const label = active?.textContent?.trim() ?? "";
  if (label === "국내") return "KR";
  if (label.includes("미국")) return "US";
  if (label === "가상자산") return "CRYPTO";
  return null;
}

function displaySymbol(market: Market, symbol: string) {
  return market === "US" ? symbol.replace(/\.(?:O|K|N|P|A)$/i, "") : symbol;
}

function metaMatchesMarket(meta: string, market: Market) {
  if (market === "KR") return /^\d{6}\s*·\s*(?:KOSPI|KOSDAQ|KONEX)$/i.test(meta);
  if (market === "CRYPTO") return /^KRW-[A-Z0-9._-]+\s*·\s*UPBIT$/i.test(meta);
  return !/^KRW-/i.test(meta) && !/·\s*(?:KOSPI|KOSDAQ|KONEX|KRX|NXT)\b/i.test(meta);
}

export default function QuoteIdentityGuard() {
  useEffect(() => {
    let disposed = false;
    let scheduled = false;
    const cache = new Map<string, Instrument>();
    const loading = new Set<string>();

    const sync = async () => {
      const market = activeMarket();
      const title = document.querySelector(".np-quote .stock-title h1")?.textContent?.trim() ?? "";
      const meta = document.querySelector<HTMLElement>(".np-quote .stock-title small");
      if (!market || !title || !meta) return;

      const currentMeta = meta.textContent?.trim() ?? "";
      if (metaMatchesMarket(currentMeta, market)) return;

      const key = `${market}:${title}`;
      const apply = (instrument: Instrument) => {
        if (disposed || instrument.market !== market) return;
        const liveMarket = activeMarket();
        const liveTitle = document.querySelector(".np-quote .stock-title h1")?.textContent?.trim() ?? "";
        const liveMeta = document.querySelector<HTMLElement>(".np-quote .stock-title small");
        if (liveMarket !== market || liveTitle !== title || !liveMeta) return;
        liveMeta.textContent = `${displaySymbol(instrument.market, instrument.symbol)} · ${instrument.market === "CRYPTO" ? "UPBIT" : instrument.exchange}`;
      };

      const cached = cache.get(key);
      if (cached) {
        apply(cached);
        return;
      }
      if (loading.has(key)) return;
      loading.add(key);
      try {
        const params = new URLSearchParams({ q: title, market });
        const response = await fetch(`/api/instruments/search?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { instruments?: Instrument[] };
        const candidates = (data.instruments ?? []).filter(item => item.market === market);
        const instrument = candidates.find(item => item.name === title) ?? candidates[0];
        if (!instrument) return;
        cache.set(key, instrument);
        apply(instrument);
      } catch {
        // The original React label remains if Naver search is temporarily unavailable.
      } finally {
        loading.delete(key);
      }
    };

    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        void sync();
      });
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, []);

  return null;
}
