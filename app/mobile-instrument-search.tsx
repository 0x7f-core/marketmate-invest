"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, Star, X } from "lucide-react";
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
type AuthResponse = { user?: { id?: string } };

const MAX_RECENTS = 20;

function displaySymbol(item: Instrument) {
  return item.market === "US"
    ? item.symbol.replace(/\.(?:O|K|N|P|A)$/i, "")
    : item.symbol;
}

function marketLabel(item: Instrument) {
  if (item.market === "KR") return item.exchange || "국내";
  if (item.market === "US") return item.exchange || "미국";
  return item.exchange === "NAVER" || !item.exchange ? "UPBIT" : item.exchange;
}

function recentKey(userId: string) {
  return `marketmate:recent-search:${userId}`;
}

function readRecents(userId: string) {
  if (!userId) return [] as Instrument[];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentKey(userId)) || "[]") as Instrument[];
    return Array.isArray(parsed)
      ? parsed.filter(item => item && ["KR", "US", "CRYPTO"].includes(item.market) && item.symbol && item.name).slice(0, MAX_RECENTS)
      : [];
  } catch {
    return [] as Instrument[];
  }
}

function saveRecents(userId: string, items: Instrument[]) {
  if (!userId) return;
  try {
    window.localStorage.setItem(recentKey(userId), JSON.stringify(items.slice(0, MAX_RECENTS)));
  } catch {}
}

function sameInstrument(left: Pick<Instrument, "market" | "symbol">, right: Pick<Instrument, "market" | "symbol">) {
  return left.market === right.market && left.symbol === right.symbol;
}

export default function MobileInstrumentSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [recents, setRecents] = useState<Instrument[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [headerTarget, setHeaderTarget] = useState<Element | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const resolveUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return "";
      const payload = await response.json() as AuthResponse;
      const id = String(payload.user?.id || "");
      if (id) {
        setUserId(id);
        setRecents(readRecents(id));
      }
      return id;
    } catch {
      return "";
    }
  }, []);

  const loadWatchlist = useCallback(async () => {
    try {
      const response = await fetch("/api/watchlist", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { items?: WatchlistItem[] };
      setWatchlist(payload.items ?? []);
    } catch {}
  }, []);

  const closeSearch = useCallback(() => {
    if (window.history.state?.marketmateMobileSearch) window.history.back();
    else setOpen(false);
  }, []);

  useEffect(() => {
    const locate = () => {
      const target = document.querySelector(".np-mobile-header>div:first-child");
      if (target) setHeaderTarget(target);
    };
    const timer = window.setTimeout(locate, 0);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const onPopState = () => {
      if (open) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (open && event.key === "Escape") closeSearch();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSearch, open]);

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (!value) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/instruments/search?q=${encodeURIComponent(value)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async response => {
          if (!response.ok) throw new Error("SEARCH_FAILED");
          return await response.json() as { instruments?: Instrument[] };
        })
        .then(payload => setResults((payload.instruments ?? []).slice(0, 30)))
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const openSearch = async () => {
    if (open) return;
    window.history.pushState({ ...(window.history.state ?? {}), marketmateMobileSearch: true }, "");
    setOpen(true);
    setQuery("");
    setResults([]);
    setLoading(false);
    const id = userId || await resolveUser();
    if (id) setRecents(readRecents(id));
    void loadWatchlist();
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      setLoading(false);
    }
  };

  const choose = (instrument: Instrument) => {
    const normalized: Instrument = {
      market: instrument.market,
      symbol: instrument.symbol,
      name: instrument.name,
      exchange: instrument.market === "CRYPTO" && instrument.exchange === "NAVER" ? "UPBIT" : instrument.exchange,
      currency: instrument.currency,
    };
    const next = [normalized, ...recents.filter(item => !sameInstrument(item, normalized))].slice(0, MAX_RECENTS);
    setRecents(next);
    saveRecents(userId, next);
    window.dispatchEvent(new CustomEvent("marketmate:open-instrument", { detail: normalized }));
    closeSearch();
  };

  const clearRecents = () => {
    setRecents([]);
    if (userId) {
      try { window.localStorage.removeItem(recentKey(userId)); } catch {}
    }
  };

  const isFavorite = (item: Instrument) => watchlist.some(entry => sameInstrument(entry, item));

  const toggleFavorite = async (event: React.SyntheticEvent, item: Instrument) => {
    event.stopPropagation();
    const favorite = isFavorite(item);
    try {
      const response = await fetch(
        favorite ? `/api/watchlist?instrumentId=${encodeURIComponent(`${item.market}:${item.symbol}`)}` : "/api/watchlist",
        {
          method: favorite ? "DELETE" : "POST",
          headers: favorite ? undefined : { "content-type": "application/json" },
          body: favorite ? undefined : JSON.stringify({
            market: item.market,
            symbol: item.symbol,
            name: item.name,
            exchange: item.market === "CRYPTO" && item.exchange === "NAVER" ? "UPBIT" : item.exchange,
            currency: item.currency,
          }),
        },
      );
      if (response.ok) void loadWatchlist();
    } catch {}
  };

  const rows = query.trim() ? results : recents;

  const launchButton = (
    <button type="button" className="np-mobile-search-launch" onClick={openSearch} aria-label="종목 검색">
      <Search aria-hidden="true" />
      <span>종목 검색</span>
    </button>
  );

  return (
    <>
      <style>{`
        .np-mobile-search-launch,.mobile-instrument-search{display:none}
        @media(max-width:767px){
          .marketmate-v2 .np-mobile-header>.search-wrap{display:none!important}
          .marketmate-v2 .np-mobile-header>div:first-child{position:relative!important}
          .np-mobile-search-launch{
            display:flex;position:absolute;right:48px;top:8px;height:36px;align-items:center;gap:5px;
            border:0;border-radius:18px;background:#f3f4f6;color:#6b7280;padding:0 12px;font-size:12px;font-weight:700;
            white-space:nowrap;z-index:4
          }
          .np-mobile-search-launch svg{width:17px;height:17px;color:#111827}
          .mobile-instrument-search{
            display:block;position:fixed;inset:0;z-index:10000;background:#fff;color:#191f28;overflow-y:auto;
            overscroll-behavior:contain;padding:0 0 max(18px,env(safe-area-inset-bottom))
          }
          .mobile-search-top{
            position:sticky;top:0;z-index:3;display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;
            gap:4px;padding:12px 14px 12px 4px;background:#fff;border-bottom:1px solid #f5f6f7
          }
          .mobile-search-back{display:grid;place-items:center;width:48px;height:48px;border:0;background:transparent;color:#17191c}
          .mobile-search-back svg{width:27px;height:27px}
          .mobile-search-input{
            height:48px;border-radius:10px;background:#f4f5f7;display:flex;align-items:center;padding:0 14px;min-width:0
          }
          .mobile-search-input>svg{width:20px;height:20px;color:#8b95a1;flex:none;margin-right:8px}
          .mobile-search-input input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#191f28;font-size:16px}
          .mobile-search-input input::placeholder{color:#a5abb2}
          .mobile-search-input button{display:grid;place-items:center;width:28px;height:28px;border:0;background:transparent;color:#9ca3af;padding:0}
          .mobile-search-input button svg{width:17px;height:17px}
          .mobile-search-content{padding:24px 18px 40px}
          .mobile-search-section-title{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}
          .mobile-search-section-title h2{margin:0;font-size:15px;color:#8b95a1;font-weight:700}
          .mobile-search-section-title button{border:0;background:transparent;color:#a0a8b2;font-size:12px;padding:5px}
          .mobile-search-list{border-top:0}
          .mobile-search-row{
            width:100%;min-height:72px;border:0;border-bottom:1px solid #f0f1f2;background:#fff;padding:12px 2px;
            display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:center;text-align:left
          }
          .mobile-search-row-main{min-width:0;display:flex;flex-direction:column;gap:5px}
          .mobile-search-row-main strong{font-size:18px;line-height:1.25;font-weight:500;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .mobile-search-row-main small{font-size:13px;line-height:1.35;color:#8b8f94;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .mobile-search-star{display:grid;place-items:center;width:42px;height:42px;border:0;background:transparent;color:#aeb4ba;padding:0}
          .mobile-search-star svg{width:25px;height:25px;stroke-width:1.8}
          .mobile-search-star.active{color:#03c75a}
          .mobile-search-state{padding:60px 10px;text-align:center;color:#9aa1a8;font-size:14px}
          .mobile-search-hint{padding:14px 4px 0;color:#b0b6bc;font-size:12px;line-height:1.5}
        }
      `}</style>
      {headerTarget ? createPortal(launchButton, headerTarget) : null}
      {open && (
        <section className="mobile-instrument-search" role="dialog" aria-modal="true" aria-label="종목 검색">
          <div className="mobile-search-top">
            <button type="button" className="mobile-search-back" onClick={closeSearch} aria-label="뒤로가기"><ArrowLeft /></button>
            <div className="mobile-search-input">
              <Search aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={event => updateQuery(event.target.value)}
                placeholder="종목, 지수, 코인을 검색해 보세요!"
                aria-label="종목 검색어"
                enterKeyHint="search"
              />
              {query && <button type="button" onClick={() => updateQuery("")} aria-label="검색어 지우기"><X /></button>}
            </div>
          </div>
          <div className="mobile-search-content">
            <div className="mobile-search-section-title">
              <h2>{query.trim() ? "검색 결과" : "최근 조회"}</h2>
              {!query.trim() && recents.length > 0 && <button type="button" onClick={clearRecents}>전체 삭제</button>}
            </div>
            {loading ? (
              <p className="mobile-search-state">종목을 찾는 중입니다.</p>
            ) : rows.length ? (
              <div className="mobile-search-list">
                {rows.map(item => {
                  const favorite = isFavorite(item);
                  return (
                    <button type="button" className="mobile-search-row" key={`${item.market}:${item.symbol}`} onClick={() => choose(item)}>
                      <span className="mobile-search-row-main">
                        <strong>{item.name}</strong>
                        <small>{displaySymbol(item)} · {marketLabel(item)}</small>
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={favorite ? `${item.name} 관심종목 해제` : `${item.name} 관심종목 추가`}
                        className={`mobile-search-star${favorite ? " active" : ""}`}
                        onClick={event => void toggleFavorite(event, item)}
                        onKeyDown={event => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void toggleFavorite(event, item);
                          }
                        }}
                      >
                        <Star fill={favorite ? "currentColor" : "none"} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : query.trim() ? (
              <p className="mobile-search-state">일치하는 종목이 없습니다.</p>
            ) : (
              <>
                <p className="mobile-search-state">최근 조회한 종목이 없습니다.</p>
                <p className="mobile-search-hint">국내주식, 미국주식, ETF와 가상자산을 한 번에 검색할 수 있습니다.</p>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
