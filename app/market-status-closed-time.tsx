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
  const usRange = isUsDaylightSavingTime() ? "17:00~08:50" : "18:00~09:50";

  document.querySelectorAll<HTMLElement>(".market-status-item").forEach(item => {
    const name = item.querySelector<HTMLElement>(".market-status-name")?.textContent?.trim();
    const session = item.querySelector<HTMLElement>(".market-status-session");
    if (!session?.textContent?.includes("장 마감")) return;

    let time = item.querySelector<HTMLElement>(".market-status-time");
    if (!time) {
      time = document.createElement("span");
      time.className = "market-status-time";
      session.insertAdjacentElement("afterend", time);
    }

    if (name === "국내") time.textContent = "08:00~20:00";
    if (name === "미국") time.textContent = usRange;
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
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
