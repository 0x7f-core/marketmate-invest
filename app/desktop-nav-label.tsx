"use client";

import { useEffect } from "react";

const FROM = "모의투자대회";
const TO = "대회";
const DESKTOP_ORDER = ["홈", "관심", "시세", "대회", "뉴스", "MY"] as const;

function applyDesktopNav() {
  document.querySelectorAll<HTMLElement>(".np-desktop-header nav").forEach((nav) => {
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button"));

    for (const button of buttons) {
      if (button.textContent?.trim() === FROM) button.textContent = TO;
    }

    const byLabel = new Map(
      buttons.map(button => [button.textContent?.trim() ?? "", button] as const),
    );

    for (const label of DESKTOP_ORDER) {
      const button = byLabel.get(label);
      if (button && button.parentElement === nav) nav.appendChild(button);
    }
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
