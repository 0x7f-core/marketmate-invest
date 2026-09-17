"use client";

import { useEffect } from "react";

function isUsDaylightSavingTime() {
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value ?? "";
  return zone.toUpperCase().includes("EDT");
}

function patchClosedMarketTimes() {
  const usClosedRange = isUsDaylightSavingTime() ? "08:50~17:00" : "09:50~18:00";

  document.querySelectorAll<HTMLElement>(".market-status-item").forEach(item => {
    const name = item.querySelector<HTMLElement>(".market-status-name")?.textContent?.trim();
    const session = item.querySelector<HTMLElement>(".market-status-session");
    if (!session) return;

    const rawSessionText = session.textContent?.trim() ?? "";
    if (name === "국내" && (rawSessionText.includes("동시호가") || rawSessionText.includes("장 마감"))) {
      const simplified = rawSessionText.replace(/^(?:KRX|NXT)\s+/i, "");
      if (simplified !== rawSessionText) session.textContent = simplified;
    }

    if (!rawSessionText.includes("장 마감")) return;

    let time = item.querySelector<HTMLElement>(".market-status-time");
    if (!time) {
      time = document.createElement("span");
      time.className = "market-status-time";
      session.insertAdjacentElement("afterend", time);
    }

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
        patchClosedMarketTimes();
      });
    };

    schedulePatch();
    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
