"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_ORDER = ["indices", "competition", "watchlist", "rankings", "news"] as const;
type DashboardId = (typeof DEFAULT_ORDER)[number];

type AuthResponse = { user?: { id?: string } };

const DASHBOARDS: Record<DashboardId, { label: string; selector: string }> = {
  indices: { label: "지수", selector: ".np-home .np-market-focus" },
  competition: { label: "내 대회", selector: ".np-home .np-my-summary" },
  watchlist: { label: "관심종목", selector: ".np-home .np-watch-preview" },
  rankings: { label: "실시간 랭킹", selector: ".np-home .home-market-ranking-slot" },
  news: { label: "주요 뉴스", selector: ".np-home .np-news" },
};

function validOrder(value: unknown): DashboardId[] | null {
  if (!Array.isArray(value) || value.length !== DEFAULT_ORDER.length) return null;
  const items = value.filter((item): item is DashboardId => typeof item === "string" && DEFAULT_ORDER.includes(item as DashboardId));
  if (items.length !== DEFAULT_ORDER.length || new Set(items).size !== DEFAULT_ORDER.length) return null;
  return items;
}

function moveItem(order: DashboardId[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order;
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function HomeDashboardOrder() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [userId, setUserId] = useState("");
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<DashboardId | null>(null);
  const [order, setOrder] = useState<DashboardId[]>([...DEFAULT_ORDER]);

  const storageKey = useMemo(() => userId ? `marketmate:home-dashboard-order:${userId}` : "", [userId]);

  useEffect(() => {
    if (!target?.isConnected) return;
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async response => response.ok ? await response.json() as AuthResponse : null)
      .then(result => {
        if (!active) return;
        const id = result?.user?.id?.trim() ?? "";
        let nextOrder: DashboardId[] = [...DEFAULT_ORDER];
        if (id) {
          try {
            const saved = validOrder(JSON.parse(window.localStorage.getItem(`marketmate:home-dashboard-order:${id}`) ?? "null"));
            if (saved) nextOrder = saved;
          } catch {
            // Corrupt local preferences fall back to the documented default order.
          }
        }
        setUserId(id);
        setOrder(nextOrder);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setUserId("");
        setOrder([...DEFAULT_ORDER]);
        setReady(true);
      });
    return () => { active = false; };
  }, [target]);

  useEffect(() => {
    if (!ready || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // Local storage can be unavailable in private/restricted browser modes.
    }
  }, [order, ready, storageKey]);

  const applyOrder = useCallback(() => {
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    for (const [index, id] of order.entries()) {
      const element = document.querySelector<HTMLElement>(DASHBOARDS[id].selector);
      if (!element) continue;
      if (isMobile) {
        element.dataset.homeDashboardCard = id;
        element.style.order = String(10 + index);
      } else {
        delete element.dataset.homeDashboardCard;
        element.style.removeProperty("order");
      }
    }
  }, [order]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const home = document.querySelector<HTMLElement>(".np-home");
        if (!home) {
          setTarget(current => current?.isConnected ? current : null);
          return;
        }
        let slot = home.querySelector<HTMLElement>(":scope > .home-dashboard-order-slot");
        if (!slot) {
          slot = document.createElement("div");
          slot.className = "home-dashboard-order-slot";
          home.insertBefore(slot, home.firstChild);
        }
        setTarget(current => current === slot ? current : slot);
        applyOrder();
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [applyOrder]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const onChange = () => applyOrder();
    media.addEventListener("change", onChange);
    applyOrder();
    return () => media.removeEventListener("change", onChange);
  }, [applyOrder]);

  const shift = (id: DashboardId, delta: -1 | 1) => {
    setOrder(current => {
      const index = current.indexOf(id);
      return moveItem(current, index, index + delta);
    });
  };

  const moveBefore = (source: DashboardId, targetId: DashboardId) => {
    setOrder(current => {
      const from = current.indexOf(source);
      const to = current.indexOf(targetId);
      return moveItem(current, from, to);
    });
  };

  const reset = () => setOrder([...DEFAULT_ORDER]);

  return (
    <>
      {target && target.isConnected ? createPortal(
        <section className={`home-dashboard-order${editing ? " editing" : ""}`} aria-label="모바일 메인 대시보드 순서 설정">
          <div className="home-dashboard-order-head">
            <span>모바일 대시보드</span>
            <button type="button" onClick={() => setEditing(value => !value)}>{editing ? "완료" : "순서 변경"}</button>
          </div>
          {editing ? (
            <div className="home-dashboard-order-editor">
              <p>드래그하거나 화살표로 순서를 바꿀 수 있습니다.</p>
              <ol>
                {order.map((id, index) => (
                  <li
                    key={id}
                    draggable
                    onDragStart={() => setDragging(id)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={event => event.preventDefault()}
                    onDrop={event => {
                      event.preventDefault();
                      if (dragging && dragging !== id) moveBefore(dragging, id);
                      setDragging(null);
                    }}
                    className={dragging === id ? "dragging" : ""}
                  >
                    <span className="home-dashboard-drag" aria-hidden="true">☰</span>
                    <b>{index + 1}</b>
                    <strong>{DASHBOARDS[id].label}</strong>
                    <span className="home-dashboard-arrows">
                      <button type="button" aria-label={`${DASHBOARDS[id].label} 위로 이동`} disabled={index === 0} onClick={() => shift(id, -1)}>↑</button>
                      <button type="button" aria-label={`${DASHBOARDS[id].label} 아래로 이동`} disabled={index === order.length - 1} onClick={() => shift(id, 1)}>↓</button>
                    </span>
                  </li>
                ))}
              </ol>
              <button type="button" className="home-dashboard-reset" onClick={reset}>기본 순서로 초기화</button>
            </div>
          ) : null}
        </section>,
        target,
      ) : null}
      <style>{`
        .home-dashboard-order-slot{display:none!important}
        @media(max-width:760px){
          .np-home{display:flex!important;flex-direction:column;gap:0!important;align-items:stretch}
          .np-home-main,.np-home>aside{display:contents!important}
          .np-home .np-market-status{order:0}
          .np-home-main>.live-market-strip{order:1}
          .home-dashboard-order-slot{display:block!important;order:2;width:100%;background:#f0f2f3;padding-bottom:9px}
          .np-home .np-market-focus,.np-home .np-my-summary,.np-home .np-watch-preview,.np-home .home-market-ranking-slot,.np-home .np-news{width:100%;min-width:0}
          .home-dashboard-order{overflow:hidden;border-width:0;border-radius:0;background:#fff}
          .home-dashboard-order-head{min-height:48px;padding:0 16px;display:flex;align-items:center;justify-content:space-between}
          .home-dashboard-order-head>span{color:#626b73;font-size:12px;font-weight:700}
          .home-dashboard-order-head>button,.home-dashboard-reset{height:30px;padding:0 11px;border:1px solid #dfe3e6;border-radius:7px;background:#fff;color:#4f5962;font-size:11px;font-weight:700}
          .home-dashboard-order.editing .home-dashboard-order-head{border-bottom:1px solid #eef0f2}
          .home-dashboard-order-editor{padding:10px 12px 12px;background:#fafbfb}
          .home-dashboard-order-editor>p{margin:0 0 9px;color:#8b9299;font-size:11px}
          .home-dashboard-order-editor ol{display:grid;grid-template-columns:1fr;gap:7px;margin:0;padding:0;list-style:none}
          .home-dashboard-order-editor li{min-width:0;height:46px;padding:0 10px;display:flex;align-items:center;gap:6px;border:1px solid #e2e6e8;border-radius:8px;background:#fff;cursor:grab;user-select:none}
          .home-dashboard-order-editor li.dragging{opacity:.55}
          .home-dashboard-drag{color:#a0a7ad;font-size:13px;line-height:1;transform:rotate(90deg)}
          .home-dashboard-order-editor li>b{display:grid;place-items:center;flex:0 0 20px;width:20px;height:20px;border-radius:50%;background:#17191c;color:#fff;font-size:10px}
          .home-dashboard-order-editor li>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
          .home-dashboard-arrows{display:flex;margin-left:auto;gap:2px}
          .home-dashboard-arrows button{width:34px;height:30px;padding:0;border:0;border-radius:5px;background:#f1f3f4;color:#59636c;font-size:13px;font-weight:800}
          .home-dashboard-arrows button:disabled{opacity:.25;cursor:default}
          .home-dashboard-reset{width:100%;height:34px;margin-top:10px}
        }
      `}</style>
    </>
  );
}
