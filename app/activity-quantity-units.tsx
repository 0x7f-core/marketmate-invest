"use client";

import { useEffect } from "react";

function patchActivityQuantityUnits() {
  document.querySelectorAll<HTMLElement>(".activity-dialog .activity-list > div").forEach(row => {
    const columns = row.querySelectorAll<HTMLElement>(":scope > span");
    if (columns.length < 2) return;

    const marketText = columns[0].querySelector("small")?.textContent?.trim() ?? "";
    const quantity = columns[1].querySelector<HTMLElement>("b");
    if (!quantity) return;

    const raw = quantity.textContent?.trim() ?? "";
    if (!/^-?[\d,.]+$/.test(raw)) return;

    quantity.textContent = `${raw}${marketText.startsWith("CRYPTO ·") ? "개" : "주"}`;
  });
}

export default function ActivityQuantityUnits() {
  useEffect(() => {
    let scheduled = false;
    const schedulePatch = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patchActivityQuantityUnits();
      });
    };

    schedulePatch();
    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
