"use client";

import { useEffect } from "react";

const FROM = "모의투자대회";
const TO = "대회";
const DESKTOP_ORDER = new Map<string, number>([
  ["홈", 1],
  ["관심", 2],
  ["시세", 3],
  ["대회", 4],
  ["모의투자대회", 4],
  ["뉴스", 5],
  ["MY", 6],
]);

function applyDesktopNav() {
  document.querySelectorAll<HTMLButtonElement>(".np-desktop-header nav > button").forEach((button) => {
    const originalLabel = button.textContent?.trim() ?? "";
    const order = DESKTOP_ORDER.get(originalLabel);
    if (order) button.style.order = String(order);
    if (originalLabel === FROM) button.textContent = TO;
  });
}

export default function DesktopNavLabel() {
  useEffect(() => {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        applyDesktopNav();
      });
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
