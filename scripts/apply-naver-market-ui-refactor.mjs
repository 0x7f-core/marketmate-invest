import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }
function mustReplace(source, search, replacement, label) {
  const next = typeof search === "string" ? source.replace(search, replacement) : source.replace(search, replacement);
  if (next === source) throw new Error(`Patch failed: ${label}`);
  return next;
}

// Main dashboard: remove TradingView Embed, wire Lightweight Charts, honor pollingInterval.
{
  const path = "app/trading-dashboard.tsx";
  let source = read(path);
  source = mustReplace(
    source,
    'import { useCallback, useContext, useEffect, useState } from "react";\n',
    'import { useCallback, useContext, useEffect, useState } from "react";\nimport MarketChart from "@/app/market-chart";\n',
    "MarketChart import",
  );
  source = mustReplace(
    source,
    /\nfunction tradingViewSymbol\(quote: Quote\) \{[\s\S]*?\n\}\n\nfunction TradingViewChart\(\{ quote \}: \{ quote: Quote \}\) \{[\s\S]*?\n\}\n\nfunction relativeTime/,
    "\nfunction relativeTime",
    "remove TradingView Embed functions",
  );
  source = source.replaceAll("<TradingViewChart ", "<MarketChart ");
  if (source.includes("TradingViewChart") || source.includes("widgetembed") || source.includes("tradingViewSymbol")) throw new Error("TradingView Embed references remain");
  source = mustReplace(source, 'source:"KIS"|"UPBIT"', 'source:"NAVER"', "market index source type");
  source = source.replace(/; kisTokenExpiresAt\?:number/g, "");
  source = source.replace(
    'type MarketSession = { isOpen: boolean; label: string; notice: string };',
    'type MarketSession = { isOpen: boolean; label: string; notice: string; source?: "NAVER"; stale?: boolean; isHoliday?: boolean; currentSession?: string; isDaylightSavingTime?: boolean; openTimeKst?: string; closeTimeKst?: string };',
  );

  const oldEffect = /useEffect\(\(\)=>\{if\(!auth\|\|auth==="loading"\|\|view!=="market"\)return;let active=true;const load=\(\)=>\{setQuoteStatus\(current=>current==="live"\?current:"loading"\);fetch\(`\/api\/quotes\?market=\$\{selected\.market\}&symbols=\$\{encodeURIComponent\(selected\.symbol\)\}&exchange=\$\{encodeURIComponent\(selected\.exchange\)\}`,\{cache:"no-store"\}\)\.then\(async r=>\{const data=await r\.json\(\) as \{quotes\?:Array<\{price:number;change:number;changeRate:number;currency:"KRW"\|"USD";exchangeRate:number;open\?:number;high\?:number;low\?:number;volume\?:number\}>\};if\(!r\.ok\|\|!data\.quotes\?\.\[0\]\)throw new Error\(\);const q=data\.quotes\[0\];if\(active\)\{setSelected\(current=>current\.market===selected\.market&&current\.symbol===selected\.symbol\?\{\.\.\.current,price:q\.price,change:q\.change,rate:q\.changeRate,currency:q\.currency,exchangeRate:q\.exchangeRate,open:q\.open,high:q\.high,low:q\.low,volume:q\.volume\}:current\);setQuoteStatus\("live"\);\}\}\)\.catch\(\(\)=>active&&setQuoteStatus\("unavailable"\)\);\};void load\(\);const timer=setInterval\(load,5_000\);return\(\)=>\{active=false;clearInterval\(timer\);\};\},\[auth,selected\.market,selected\.symbol,selected\.exchange,view\]\);/;
  const newEffect = `useEffect(()=>{if(!auth||auth==="loading"||view!=="market")return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const schedule=(delay:number)=>{if(active)timer=setTimeout(load,Math.max(1_000,Math.min(120_000,delay)));};const load=()=>{setQuoteStatus(current=>current==="live"?current:"loading");fetch(\`/api/quotes?market=\${selected.market}&symbols=\${encodeURIComponent(selected.symbol)}&exchange=\${encodeURIComponent(selected.exchange)}\`,{cache:"no-store"}).then(async r=>{const data=await r.json() as {quotes?:Array<{price:number;change:number;changeRate:number;currency:"KRW"|"USD";exchangeRate:number;pollingInterval?:number;stale?:boolean;open?:number;high?:number;low?:number;volume?:number}>};if(!r.ok||!data.quotes?.[0])throw new Error();const q=data.quotes[0];if(active){setSelected(current=>current.market===selected.market&&current.symbol===selected.symbol?{...current,price:q.price,change:q.change,rate:q.changeRate,currency:q.currency,exchangeRate:q.exchangeRate,open:q.open,high:q.high,low:q.low,volume:q.volume}:current);setQuoteStatus("live");schedule(q.pollingInterval??5_000);}}).catch(()=>{if(active){setQuoteStatus("unavailable");schedule(10_000);}});};void load();return()=>{active=false;if(timer)clearTimeout(timer);};},[auth,selected.market,selected.symbol,selected.exchange,view]);`;
  source = mustReplace(source, oldEffect, newEffect, "quote polling effect");
  source = mustReplace(
    source,
    'if (instrument.market === "CRYPTO") return `https://static.upbit.com/logos/${instrument.symbol.replace("KRW-", "")}.png`;',
    'if (instrument.market === "CRYPTO") return "/favicon.svg";',
    "remove Upbit image host",
  );
  write(path, source);
}

// Orders: make all provider wording/error handling Naver-only.
{
  const path = "app/api/orders/route.ts";
  let source = read(path);
  source = mustReplace(
    source,
    'import { getCheckedMarketSession } from "@/lib/server/market-hours";\n',
    'import { getCheckedMarketSession } from "@/lib/server/market-hours";\nimport { isNaverStockUnavailable } from "@/lib/server/naver-stock";\n',
    "Naver order error import",
  );
  source = source.replace("한국투자증권 환율을 확인할 수 없어 미국주식 주문을 중단했습니다.", "네이버증권 환율을 확인할 수 없어 미국주식 주문을 중단했습니다.");
  source = mustReplace(
    source,
    'if (error instanceof Error && ["KIS_NOT_CONFIGURED", "KIS_AUTH_FAILED", "KIS_AUTH_BUSY", "KIS_QUOTE_FAILED", "UPBIT_QUOTE_FAILED"].includes(error.message)) {\n      return Response.json({ error: "실시간 시세 제공자에 연결할 수 없어 주문을 중단했습니다." }, { status: 503 });\n    }',
    'if (isNaverStockUnavailable(error) || (error instanceof Error && ["NAVER_FX_UNAVAILABLE", "NAVER_EMPTY_QUOTE", "NAVER_INVALID_QUOTE"].includes(error.message))) {\n      return Response.json({ error: "네이버증권 실시간 시세를 확인할 수 없어 주문을 중단했습니다." }, { status: 503, headers: { "retry-after": "30" } });\n    }',
    "order provider error handling",
  );
  write(path, source);
}

// Quote route: expose upstream failures as controlled 503 responses.
{
  const path = "app/api/quotes/route.ts";
  let source = read(path);
  source = mustReplace(
    source,
    'import { enforceRateLimit } from "@/lib/server/safety";\n',
    'import { enforceRateLimit } from "@/lib/server/safety";\nimport { isNaverStockUnavailable } from "@/lib/server/naver-stock";\n',
    "quote Naver error import",
  );
  source = mustReplace(
    source,
    '  } catch (error) { return apiError(error); }\n}',
    '  } catch (error) {\n    if (isNaverStockUnavailable(error) || (error instanceof Error && ["NAVER_FX_UNAVAILABLE", "NAVER_EMPTY_QUOTE", "NAVER_INVALID_QUOTE"].includes(error.message))) {\n      return Response.json({ error: "네이버증권 실시간 시세를 불러오지 못했습니다.", source: "NAVER" }, { status: 503, headers: { "retry-after": "30" } });\n    }\n    return apiError(error);\n  }\n}',
    "quote error response",
  );
  write(path, source);
}

// CSS: remove iframe-specific styling and add native chart surface.
{
  const path = "app/globals.css";
  let source = read(path);
  source = source.replace(/\.tradingview-frame\s*\{[^}]*\}/g, "");
  if (!source.includes(".naver-light-chart")) source += `

/* Unified Naver-style market chart (TradingView Lightweight Charts) */
.naver-light-chart{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;min-width:0}
.naver-light-chart-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px 10px;border-bottom:1px solid #f1f3f5}
.naver-light-chart-toolbar>div:first-child{display:flex;align-items:baseline;gap:8px}
.naver-light-chart-toolbar b{font-size:15px;color:#191f28}
.naver-light-chart-toolbar small{font-size:11px;color:#8b95a1}
.naver-light-chart-ranges{display:flex;gap:2px;padding:2px;background:#f4f6f8;border-radius:8px}
.naver-light-chart-ranges button{border:0;background:transparent;color:#6b7684;font-size:12px;font-weight:600;padding:6px 9px;border-radius:6px;cursor:pointer}
.naver-light-chart-ranges button.active{background:#fff;color:#03c75a;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.naver-light-chart-stage{position:relative;height:410px;min-height:300px;background:#fff}
.naver-light-chart-canvas{width:100%;height:100%}
.naver-light-chart-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:rgba(255,255,255,.88);color:#8b95a1;font-size:13px;z-index:2}
.naver-light-chart-state.error b{color:#4e5968;font-size:14px}
.naver-light-chart-state.error span{max-width:80%;text-align:center}
.naver-light-chart-state.error button{border:1px solid #d1d6db;background:#fff;color:#4e5968;border-radius:8px;padding:7px 11px;cursor:pointer}
@media (max-width: 767px){.naver-light-chart{border-left:0;border-right:0;border-radius:0}.naver-light-chart-toolbar{padding:12px 14px 8px}.naver-light-chart-stage{height:330px;min-height:270px}.naver-light-chart-ranges button{padding:6px 8px;font-size:11px}}
`;
  write(path, source);
}

console.log("Naver market UI refactor applied.");
