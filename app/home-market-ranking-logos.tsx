"use client";

import { useEffect } from "react";

const FALLBACK_COLORS = ["#cf6530", "#dc9a24", "#50896a", "#4d75a8", "#8e4ca4", "#be3b7c"] as const;

function fallbackColor(seed: string) {
  let hash = 0;
  for (const char of seed.normalize("NFKC").trim().toUpperCase()) {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  }
  const index = ((hash % FALLBACK_COLORS.length) + FALLBACK_COLORS.length) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[index];
}

function rowTicker(row: HTMLElement) {
  const meta = row.querySelector<HTMLElement>(".mm-rank-stock-text small")?.textContent ?? "";
  return meta.split("·", 1)[0]?.trim().replace(/^KRW-/, "").replace(/\.(?:O|K|N|P|A)$/i, "") ?? "";
}

function rowName(row: HTMLElement) {
  return row.querySelector<HTMLElement>(".mm-rank-stock-text strong")?.textContent?.trim() ?? "";
}

function fallbackLetter(name: string, ticker: string) {
  const source = name || ticker || "?";
  const first = Array.from(source)[0] ?? "?";
  return /[A-Za-z]/.test(first) ? first.toUpperCase() : first;
}

function styleFallback(logo: HTMLElement, seed: string) {
  logo.style.backgroundColor = fallbackColor(seed);
  logo.style.color = "#fff";
  logo.style.borderColor = "transparent";
}

function makeCryptoLogo(row: HTMLElement) {
  const stockCell = row.querySelector<HTMLElement>(".mm-rank-stock");
  const text = row.querySelector<HTMLElement>(".mm-rank-stock-text");
  if (!stockCell || !text || stockCell.querySelector(".mm-rank-logo")) return;

  const ticker = rowTicker(row);
  const name = rowName(row);
  if (!ticker) return;

  const logo = document.createElement("span");
  logo.className = "mm-rank-logo mm-rank-crypto-logo";
  logo.setAttribute("aria-hidden", "true");
  styleFallback(logo, ticker || name);

  const fallback = document.createElement("b");
  fallback.textContent = fallbackLetter(name, ticker);
  logo.appendChild(fallback);

  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.src = `https://static.upbit.com/logos/${encodeURIComponent(ticker.toUpperCase())}.png`;
  image.addEventListener("error", () => {
    image.style.display = "none";
  }, { once: true });
  logo.appendChild(image);
  stockCell.insertBefore(logo, text);
}

function enhanceRankingLogos() {
  const ranking = document.querySelector<HTMLElement>(".mm-market-rankings");
  if (!ranking) return;
  const activeMarket = ranking.querySelector<HTMLButtonElement>(".mm-ranking-market-tabs button.active")?.textContent?.trim() ?? "";
  const isCrypto = activeMarket === "가상자산";

  for (const row of ranking.querySelectorAll<HTMLElement>(".mm-ranking-list li")) {
    if (isCrypto) makeCryptoLogo(row);
    const logo = row.querySelector<HTMLElement>(".mm-rank-logo");
    if (!logo) continue;
    const ticker = rowTicker(row);
    const name = rowName(row);
    styleFallback(logo, ticker || name);
  }
}

export default function HomeMarketRankingLogos() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(enhanceRankingLogos);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    schedule();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <style>{`
      .mm-rank-logo>b{position:relative;z-index:0;color:inherit}
      .mm-rank-logo.mm-rank-crypto-logo img{padding:0;background:transparent;object-fit:cover}
    `}</style>
  );
}
