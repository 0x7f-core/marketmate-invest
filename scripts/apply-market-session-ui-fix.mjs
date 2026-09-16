import fs from "node:fs";

const path = "app/trading-dashboard.tsx";
let source = fs.readFileSync(path, "utf8");

const beforeChoose = 'const chooseInstrument=(instrument:Instrument)=>{setMarketSession(LOADING_MARKET_SESSION);setMarket(instrument.market);setSelected({...instrument,price:0,change:0,rate:0,exchangeRate:1});setView("market");window.scrollTo({top:0,behavior:"smooth"});};';
const afterChoose = 'const chooseInstrument=(instrument:Instrument)=>{if(instrument.market!==market)setMarketSession(LOADING_MARKET_SESSION);setMarket(instrument.market);setSelected({...instrument,price:0,change:0,rate:0,exchangeRate:1});setView("market");window.scrollTo({top:0,behavior:"smooth"});};';

const beforeChange = 'const changeMarket=(next:Market)=>{setMarketSession(LOADING_MARKET_SESSION);setMarket(next);setSelected(DEFAULTS[next]);setView("market");window.scrollTo({top:0,behavior:"smooth"});};';
const afterChange = 'const changeMarket=(next:Market)=>{if(next!==market)setMarketSession(LOADING_MARKET_SESSION);setMarket(next);setSelected(DEFAULTS[next]);setView("market");window.scrollTo({top:0,behavior:"smooth"});};';

if (!source.includes(beforeChoose)) throw new Error("chooseInstrument target not found");
if (!source.includes(beforeChange)) throw new Error("changeMarket target not found");

source = source.replace(beforeChoose, afterChoose).replace(beforeChange, afterChange);
fs.writeFileSync(path, source);
console.log("Patched market-session loading reset behavior.");
