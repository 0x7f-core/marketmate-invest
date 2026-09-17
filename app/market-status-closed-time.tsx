"use client";

import { useEffect } from "react";

function isUsDaylightSavingTime() {
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value ?? "";
  return zone.toUpperCase().includes("EDT");
}

function seoulMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
}

function ensureTime(item: HTMLElement, session: HTMLElement) {
  let time = item.querySelector<HTMLElement>(".market-status-time");
  if (!time) {
    time = document.createElement("span");
    time.className = "market-status-time";
    session.insertAdjacentElement("afterend", time);
  }
  return time;
}

function patchMarketStatusTimes() {
  const usClosedRange = isUsDaylightSavingTime() ? "08:50~17:00" : "09:50~18:00";
  const seoulMinutes = seoulMinutesNow();

  document.querySelectorAll<HTMLElement>(".market-status-item").forEach(item => {
    const name = item.querySelector<HTMLElement>(".market-status-name")?.textContent?.trim();
    const session = item.querySelector<HTMLElement>(".market-status-session");
    if (!session) return;

    const rawSessionText = session.textContent?.trim() ?? "";
    if (name === "국내" && (rawSessionText.includes("동시호가") || rawSessionText.includes("장 마감"))) {
      const simplified = rawSessionText.replace(/^(?:KRX|NXT)\s+/i, "");
      if (simplified !== rawSessionText) session.textContent = simplified;
    }

    if (name === "국내" && rawSessionText.includes("동시호가")) {
      const auctionRange = seoulMinutes >= 8 * 60 + 50 && seoulMinutes < 9 * 60
        ? "08:50~09:00"
        : seoulMinutes >= 15 * 60 + 20 && seoulMinutes < 15 * 60 + 30
          ? "15:20~15:30"
          : "";
      if (auctionRange) {
        const time = ensureTime(item, session);
        if (time.textContent !== auctionRange) time.textContent = auctionRange;
      }
      return;
    }

    if (!rawSessionText.includes("장 마감")) return;

    const time = ensureTime(item, session);
    const next = name === "국내" ? "20:00~08:00" : name === "미국" ? usClosedRange : "";
    if (next && time.textContent !== next) time.textContent = next;
  });
}

export default function MarketStatusClosedTime() {
  useEffect(() => {
    let scheduled = false;
    const schedulePatch = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patchMarketStatusTimes();
      });
    };

    schedulePatch();
    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
