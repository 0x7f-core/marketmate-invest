"use client";

import { useEffect } from "react";

const FROM = "모의투자대회";
const TO = "대회";

function applyDesktopCompetitionLabel() {
  document.querySelectorAll<HTMLButtonElement>(".np-desktop-header nav button").forEach((button) => {
    if (button.textContent?.trim() === FROM) button.textContent = TO;
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
        applyDesktopCompetitionLabel();
      });
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
