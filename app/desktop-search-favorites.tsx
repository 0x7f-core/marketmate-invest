"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { createPortal } from "react-dom";

type Market = "KR" | "US" | "CRYPTO";
type Instrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
  currency: "KRW" | "USD";
};
type WatchlistItem = Instrument & { id?: string };
type Target = {
  row: HTMLButtonElement;
  host: HTMLElement;
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
};

function displaySymbol(market: Market, symbol: string) {
  return market === "US" ? symbol.replace(/\.(?:O|K|N|P|A)$/i, "") : symbol;
}

function marketFromLabel(label: string): Market | null {
  const value = label.trim();
  if (value === "국내") return "KR";
  if (value === "미국") return "US";
  if (value === "코인") return "CRYPTO";
  return null;
}

function targetKey(target: Target) {
  return `${target.market}:${target.symbol}:${target.name}:${target.exchange}`;
}

function sameTargets(left: Target[], right: Target[]) {
  return left.length === right.length && left.every((item, index) =>
    item.row === right[index]?.row && item.host === right[index]?.host && targetKey(item) === targetKey(right[index]),
  );
}

function parseTarget(row: HTMLButtonElement): Target | null {
  const host = row.querySelector<HTMLElement>(":scope > b");
  const name = row.querySelector<HTMLElement>(".search-result-stock strong")?.textContent?.trim() ?? "";
  const detail = row.querySelector<HTMLElement>(".search-result-stock small")?.textContent?.trim() ?? "";
  if (!host || !name || !detail) return null;

  const storedMarket = row.dataset.mmSearchMarket as Market | undefined;
  const market = storedMarket && ["KR", "US", "CRYPTO"].includes(storedMarket)
    ? storedMarket
    : marketFromLabel(host.textContent ?? "");
  if (!market) return null;

  const parts = detail.split(" · ").map(value => value.trim()).filter(Boolean);
  const symbol = row.dataset.mmSearchSymbol || parts[0] || "";
  const exchange = row.dataset.mmSearchExchange || parts.slice(1).join(" · ");
  if (!symbol) return null;

  row.dataset.mmSearchMarket = market;
  row.dataset.mmSearchSymbol = symbol;
  row.dataset.mmSearchExchange = exchange;
  host.dataset.mmFavoriteHost = "1";
  host.classList.add("desktop-search-favorite-host");
  if (host.childNodes.length && !host.querySelector("[data-mm-favorite-button]")) host.textContent = "";

  return { row, host, market, symbol, name, exchange };
}

export default function DesktopSearchFavorites() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadWatchlist = useCallback(async () => {
    try {
      const response = await fetch("/api/watchlist", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { items?: WatchlistItem[] };
      setWatchlist(payload.items ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    let frame = 0;
    const locate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".np-desktop-header .search-results > button"));
        const next = rows.map(parseTarget).filter((item): item is Target => Boolean(item));
        setTargets(current => sameTargets(current, next) ? current : next);
      });
    };
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onFocus = (event: Event) => {
      const element = event.target as Element | null;
      if (element?.matches(".np-desktop-header .search-wrap input")) void loadWatchlist();
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("pointerdown", onFocus);
    locate();
    void loadWatchlist();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("pointerdown", onFocus);
    };
  }, [loadWatchlist]);

  const favorites = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    for (const item of watchlist) map.set(`${item.market}:${displaySymbol(item.market, item.symbol)}`, item);
    return map;
  }, [watchlist]);

  const resolveInstrument = useCallback(async (target: Target) => {
    const query = target.symbol || target.name;
    const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("SEARCH_FAILED");
    const payload = await response.json() as { instruments?: Instrument[] };
    const items = payload.instruments ?? [];
    return items.find(item =>
      item.market === target.market &&
      displaySymbol(item.market, item.symbol) === target.symbol &&
      (!target.exchange || !item.exchange || item.exchange === target.exchange),
    ) ?? items.find(item => item.market === target.market && displaySymbol(item.market, item.symbol) === target.symbol)
      ?? items.find(item => item.market === target.market && item.name === target.name)
      ?? null;
  }, []);

  const toggleFavorite = useCallback(async (event: React.SyntheticEvent, target: Target) => {
    event.preventDefault();
    event.stopPropagation();
    const key = `${target.market}:${target.symbol}`;
    if (busy === key) return;
    setBusy(key);
    try {
      const existing = favorites.get(key);
      let response: Response;
      if (existing) {
        response = await fetch(`/api/watchlist?instrumentId=${encodeURIComponent(`${existing.market}:${existing.symbol}`)}`, { method: "DELETE" });
      } else {
        const instrument = await resolveInstrument(target);
        if (!instrument) return;
        response = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            market: instrument.market,
            symbol: instrument.symbol,
            name: instrument.name,
            exchange: instrument.market === "CRYPTO" && instrument.exchange === "NAVER" ? "UPBIT" : instrument.exchange,
            currency: instrument.currency,
          }),
        });
      }
      if (response.ok) {
        await loadWatchlist();
        window.dispatchEvent(new CustomEvent("marketmate:watchlist-changed"));
      }
    } catch {
      // Keep the search usable even if the watchlist request temporarily fails.
    } finally {
      setBusy(null);
    }
  }, [busy, favorites, loadWatchlist, resolveInstrument]);

  return (
    <>
      <style>{`
        .np-desktop-header .search-results .desktop-search-favorite-host{
          display:flex!important;align-items:center!important;justify-content:center!important;align-self:center;
          width:42px;min-width:42px;height:42px;margin:-7px -5px -7px 8px;font-size:0!important
        }
        .np-desktop-header .search-results .desktop-search-favorite{
          display:grid!important;place-items:center;width:38px;height:38px;border-radius:50%;color:#aeb4ba;
          cursor:pointer;outline:0;transition:background-color .12s ease,color .12s ease
        }
        .np-desktop-header .search-results .desktop-search-favorite:hover{background:#f1f4f3;color:#7d858d}
        .np-desktop-header .search-results .desktop-search-favorite.active{color:#03c75a}
        .np-desktop-header .search-results .desktop-search-favorite:focus-visible{box-shadow:0 0 0 2px #19a97455}
        .np-desktop-header .search-results .desktop-search-favorite[aria-disabled="true"]{opacity:.55;cursor:wait}
      `}</style>
      {targets.map(target => {
        const key = `${target.market}:${target.symbol}`;
        const favorite = favorites.has(key);
        const pending = busy === key;
        return createPortal(
          <span
            data-mm-favorite-button="1"
            role="button"
            tabIndex={0}
            aria-disabled={pending ? "true" : undefined}
            aria-label={favorite ? `${target.name} 관심종목 해제` : `${target.name} 관심종목 추가`}
            title={favorite ? "관심종목 해제" : "관심종목 추가"}
            className={`desktop-search-favorite${favorite ? " active" : ""}`}
            onClick={event => void toggleFavorite(event, target)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void toggleFavorite(event, target);
              }
            }}
          >
            <Star size={21} strokeWidth={1.8} fill={favorite ? "currentColor" : "none"} />
          </span>,
          target.host,
          `desktop-search-favorite:${key}:${target.name}`,
        );
      })}
    </>
  );
}
