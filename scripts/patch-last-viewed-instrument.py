from pathlib import Path
import re

path = Path("app/trading-dashboard.tsx")
text = path.read_text()
original = text

old_state = 'const[newsItems,setNewsItems]=useState<NewsItem[]>([]);const[newsLoading,setNewsLoading]=useState(false);'
new_state = old_state + 'const[lastViewed,setLastViewed]=useState<Partial<Record<Market,Instrument>>>({});const[lastViewedMarket,setLastViewedMarket]=useState<Market>("KR");'
if old_state not in text:
    raise SystemExit("state marker not found")
text = text.replace(old_state, new_state, 1)

load_marker = '  const loadCompetitions=useCallback'
restore_effect = '  useEffect(()=>{if(!auth||auth==="loading")return;try{const raw=window.localStorage.getItem(`marketmate:last-viewed:${auth.id}`);if(!raw)return;const saved=JSON.parse(raw) as{lastMarket?:Market;instruments?:Partial<Record<Market,Instrument>>};const instruments=saved.instruments??{};setLastViewed(instruments);if(saved.lastMarket&&instruments[saved.lastMarket]?.symbol)setLastViewedMarket(saved.lastMarket);}catch{}},[auth]);\n'
if load_marker not in text:
    raise SystemExit("load marker not found")
text = text.replace(load_marker, restore_effect + load_marker, 1)

handler_pattern = re.compile(r'  const chooseInstrument=.*?\n  const logout=', re.S)
handler_replacement = '''  const persistLastViewed=(nextMarket:Market,instruments:Partial<Record<Market,Instrument>>)=>{if(!auth||auth==="loading")return;try{window.localStorage.setItem(`marketmate:last-viewed:${auth.id}`,JSON.stringify({lastMarket:nextMarket,instruments}));}catch{}};
  const quoteFromInstrument=(instrument:Instrument):Quote=>({...instrument,price:0,change:0,rate:0,exchangeRate:1});
  const rememberInstrument=(instrument:Instrument)=>{const normalized:Instrument={market:instrument.market,symbol:instrument.symbol,name:instrument.name,exchange:instrument.exchange,currency:instrument.currency};setLastViewedMarket(normalized.market);setLastViewed(current=>{const next={...current,[normalized.market]:normalized};persistLastViewed(normalized.market,next);return next;});};
  const restoreRemembered=(next:Market)=>{const remembered=lastViewed[next];if(!remembered?.symbol||!remembered.name)return false;setSelected(quoteFromInstrument(remembered));return true;};
  const openMarketView=()=>{const next=lastViewed[lastViewedMarket]?.symbol?lastViewedMarket:selected.market;if(next!==market)setMarketSession(LOADING_MARKET_SESSION);setMarket(next);restoreRemembered(next);setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const chooseInstrument=(instrument:Instrument)=>{if(instrument.market!==market)setMarketSession(LOADING_MARKET_SESSION);rememberInstrument(instrument);setMarket(instrument.market);setSelected(quoteFromInstrument(instrument));setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const changeMarket=(next:Market)=>{if(next!==market)setMarketSession(LOADING_MARKET_SESSION);setMarket(next);if(!restoreRemembered(next)&&selected.market!==next)setSelected(DEFAULTS[next]);setLastViewedMarket(next);setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const logout='''
text, count = handler_pattern.subn(handler_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"handler block replacement count={count}")

desktop_old = 'onClick={()=>setView(key)}>{label}</button>)}</nav>'
desktop_new = 'onClick={()=>key==="market"?openMarketView():setView(key)}>{label}</button>)}</nav>'
if desktop_old not in text:
    raise SystemExit("desktop nav marker not found")
text = text.replace(desktop_old, desktop_new, 1)

home_old = '<button onClick={()=>setView("market")}>시세 보기 <ChevronRight/></button>'
home_new = '<button onClick={openMarketView}>시세 보기 <ChevronRight/></button>'
if home_old not in text:
    raise SystemExit("home market button marker not found")
text = text.replace(home_old, home_new, 1)

bottom_old = 'onClick={()=>setView(key as AppView)}><I/><span>{String(label)}</span></button>'
bottom_new = 'onClick={()=>key==="market"?openMarketView():setView(key as AppView)}><I/><span>{String(label)}</span></button>'
if bottom_old not in text:
    raise SystemExit("mobile bottom marker not found")
text = text.replace(bottom_old, bottom_new, 1)

if text == original:
    raise SystemExit("no changes made")
path.write_text(text)
