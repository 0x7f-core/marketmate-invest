"use client";

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import MarketChart from "@/app/market-chart";
import { OTPInputContext } from "input-otp";
import { ChevronDown, ChevronRight, DoorOpen, Flame, Home, LineChart, LogOut, Newspaper, RefreshCw, Search, ShieldCheck, Star, Trash2, Trophy, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup } from "@/components/ui/input-otp";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Market = "KR" | "US" | "CRYPTO";
type MarketTab = "INDEX" | Market;
type MarketIndexId = "KOSPI" | "KOSDAQ" | "SPX" | "COMP" | "USDKRW";
type DomesticVenue = "KRX" | "NXT";
type User = { id: string; nickname: string; role: "member" | "admin" };
type Instrument = { market: Market; symbol: string; name: string; exchange: string; currency: "KRW" | "USD" };
type Quote = Instrument & {
  price: number; change: number; rate: number; exchangeRate: number;
  referencePrice?: number; open?: number; high?: number; low?: number; volume?: number; tradingValue?: number;
  high52Week?: number; low52Week?: number; high52WeekDate?: string | null; low52WeekDate?: string | null; tradingVenue?: DomesticVenue; availableVenues?: DomesticVenue[];
};
type Competition = {
  id: string; name: string; inviteCode: string; status: string; initialCashKrw: number;
  startsAt: number; endsAt: number; participantId: string; cashKrw: number;
};
type LeaderboardRow = {
  rank: number; participantId: string; nickname: string; cashKrw: number; realizedPnlKrw: number;
  initialCashKrw: number; totalAssetKrw: number; unrealizedPnlKrw: number;
  fillCount: number; tradedInstrumentCount: number; recentSymbols?: string;
};
type CompetitionTopPick = Instrument & {
  rank: number;
  holderCount: number;
  totalMarketValueKrw: number;
};
type Portfolio = {
  account: { cashKrw: number; reservedCashKrw: number; availableCashKrw: number; realizedPnlKrw: number; marketValueKrw: number; totalAssetKrw: number };
  positions: Array<{
    market: Market; symbol: string; name: string; exchange: string; currency: string; quantityMicros: number;
    averagePriceKrwMicros: number; realizedPnlKrw: number; currentPriceKrwMicros?: number;
    marketValueKrw?: number; unrealizedPnlKrw?: number;
  }>;
  fills: Fill[];
};
type Fill = {
  id: string; side: "buy" | "sell"; venue?: DomesticVenue | null; quantityMicros: number; priceMicros: number; fxRateMicros: number;
  executedAt: number; market: Market; symbol: string; name: string; currency: string;
  returnRate?: number | null; returnRateKind?: "current" | "realized";
};
type ParticipantActivity = {
  participant: { id: string; nickname: string };
  positions: Portfolio["positions"];
  fills: Fill[];
};
type Order = { id: string; side: "buy" | "sell"; orderType: "market" | "limit"; venue?: DomesticVenue | null; quantityMicros: number; limitPriceMicros?: number; filledQuantityMicros: number; status: string; rejectionReason?: string; createdAt: number; market: Market; symbol: string; name: string; currency: string };
type MarketSession = {
  isOpen: boolean; label: string; notice: string; source?: "NAVER"; stale?: boolean; isHoliday?: boolean; exchange?: string;
  currentSession?: string; isDaylightSavingTime?: boolean; openTimeKst?: string; closeTimeKst?: string;
};
type AdminData = {
  users: Array<{ id:string; nickname:string; role:string; isActive:number; createdAt:number; competitionCount:number; fillCount:number }>;
  competitions: Array<{ id:string; name:string; inviteCode:string; status:string; ownerNickname:string; participantCount:number; fillCount:number }>;
  participants: Array<{ id:string; competitionId:string; nickname:string; cashKrw:number; isOwner:number }>;
  audit: Array<{ id:string; action:string; targetType:string; targetId?:string; details:string; createdAt:number; actorNickname:string }>;
  health: { pendingOrders:number; rejectedOrders:number; activeSessions:number; latestQuoteAt?:number };
};
type WatchlistItem = Instrument & { id:string; priceKrwMicros?:number; changeRatePpm?:number; fxRateMicros?:number; receivedAt?:number };
type PopularStock = Instrument & {
  rank:number;
  price:number;
  change:number;
  changeRate:number;
};
type NewsItem = { title:string; link:string; source:string; publishedAt:number };
type MarketIndexQuote = { id:string; name:string; market:Market; price:number; change:number; rate:number; unit:string; source:"NAVER"; timestamp:number; pollingInterval?:number };
type MarketIndexDetail = MarketIndexQuote & {
  symbol:string; exchange:string; currency:"KRW"|"USD"; referencePrice?:number; open?:number; high?:number; low?:number;
  volume?:number; tradingValue?:number; high52Week?:number; low52Week?:number;
  high52WeekDate?:string; low52WeekDate?:string;
  cashBuy?:number; cashSell?:number; send?:number; receive?:number;
  chartImages?:Partial<Record<"1M"|"3M"|"1Y",string>>;
};
type AppView = "home" | "market" | "watchlist" | "competition" | "portfolio" | "news";
type PositionSortKey = "name" | "quantity" | "averagePrice" | "marketValue" | "unrealizedPnl" | "returnRate";

const clientNewsCache = new Map<string, { items:NewsItem[]; expiresAt:number }>();
const LOADING_MARKET_SESSION: MarketSession = {isOpen:false,label:"확인 중",notice:"네이버증권 거래시간을 확인하고 있습니다."};

const DEFAULTS: Record<Market, Quote> = {
  KR: { market: "KR", symbol: "005930", name: "삼성전자", exchange: "KOSPI", currency: "KRW", price: 0, change: 0, rate: 0, exchangeRate: 1 },
  US: { market: "US", symbol: "AAPL.O", name: "애플", exchange: "NAS", currency: "USD", price: 0, change: 0, rate: 0, exchangeRate: 1 },
  CRYPTO: { market: "CRYPTO", symbol: "KRW-BTC", name: "비트코인", exchange: "NAVER", currency: "KRW", price: 0, change: 0, rate: 0, exchangeRate: 1 },
};

const MARKET_INDEX_IDS: MarketIndexId[] = ["KOSPI", "KOSDAQ", "SPX", "COMP", "USDKRW"];
const MARKET_INDEX_META: Record<MarketIndexId, { name:string; market:Market; symbol:string; exchange:string; currency:"KRW"|"USD"; unit:string }> = {
  KOSPI: { name:"코스피", market:"KR", symbol:"KOSPI", exchange:"KRX", currency:"KRW", unit:"" },
  KOSDAQ: { name:"코스닥", market:"KR", symbol:"KOSDAQ", exchange:"KRX", currency:"KRW", unit:"" },
  SPX: { name:"S&P 500", market:"US", symbol:".INX", exchange:"INDEX", currency:"USD", unit:"" },
  COMP: { name:"나스닥 종합", market:"US", symbol:".IXIC", exchange:"INDEX", currency:"USD", unit:"" },
  USDKRW: { name:"원/달러 환율", market:"US", symbol:"USDKRW", exchange:"FX", currency:"KRW", unit:"원" },
};

function isMarketIndexId(value:string): value is MarketIndexId {
  return MARKET_INDEX_IDS.includes(value as MarketIndexId);
}

function formatMarketIndexValue(index:Pick<MarketIndexQuote,"id"|"unit">, value?:number) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "-";
  const formatted = Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: index.id === "USDKRW" ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${formatted}${index.unit}`;
}

function formatMarketIndexTradingValue(value?:number) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "-";
  return new Intl.NumberFormat("ko-KR", { notation:"compact", maximumFractionDigits:2 }).format(Number(value));
}

function formatPrice(quote: Quote) {
  if (!quote.price) return "시세 확인 중";
  return quote.currency === "USD"
    ? `$${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${quote.price.toLocaleString("ko-KR")}원`;
}

function formatKrw(value: number) {
  return `₩${Math.round(value || 0).toLocaleString("ko-KR")}`;
}

function formatQuoteMetricPrice(quote: Quote, value?: number) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "-";
  if (quote.currency === "USD") {
    return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: quote.market === "CRYPTO" && Number(value) < 100 ? 4 : 0 });
}

function formatQuoteMetricDate(value?: string | null) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}.` : value;
}

function quoteMetricDirectionClass(value?: number, referencePrice?: number) {
  if (!Number.isFinite(value) || Number(value) <= 0 || !Number.isFinite(referencePrice) || Number(referencePrice) <= 0) return undefined;
  if (Number(value) > Number(referencePrice)) return "up";
  if (Number(value) < Number(referencePrice)) return "down";
  return undefined;
}

function formatQuoteVolume(value?: number) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "-";
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function formatQuoteTradingValue(quote: Quote) {
  const value = Number(quote.tradingValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const compact = new Intl.NumberFormat(quote.currency === "USD" ? "en-US" : "ko-KR", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
  return quote.currency === "USD" ? `${compact}` : `${compact}원`;
}

function returnRate(total: number, initial: number) {
  return initial > 0 ? ((total - initial) / initial) * 100 : 0;
}

function positionReturnRate(position: Portfolio["positions"][number]) {
  const costBasisKrw = (position.quantityMicros / 1_000_000) * (position.averagePriceKrwMicros / 1_000_000);
  return costBasisKrw > 0 ? (Number(position.unrealizedPnlKrw ?? 0) / costBasisKrw) * 100 : 0;
}

function formatReturnRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatQuantity(quantityMicros: number) {
  return (quantityMicros / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function fillValueKrw(fill: Fill) {
  return (fill.quantityMicros / 1_000_000) * (fill.priceMicros / 1_000_000) * (fill.fxRateMicros / 1_000_000);
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

function displaySymbol(market: Market, symbol: string) {
  return market === "US" ? symbol.replace(/\.(?:O|K|N|P|A)$/i, "") : symbol;
}

function displayRecentSymbols(value?: string) {
  if (!value) return "거래 없음";
  return value.replace(/([A-Z0-9-]{1,12})\.(?:O|K|N|P|A)\b/gi, "$1");
}

function PinSlot({ index }: { index: number }) {
  const context = useContext(OTPInputContext);
  const slot = context?.slots[index];
  return <div data-active={slot?.isActive} className="auth-pin-slot">{slot?.char ? "•" : null}{slot?.hasFakeCaret && <i className="auth-pin-caret" />}</div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname, pin }),
      });
      const result = await response.json() as { user?: User; error?: string };
      if (!response.ok || !result.user) return setStatus(result.error ?? "로그인하지 못했습니다.");
      onAuthenticated(result.user);
    } catch {
      setStatus("연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span>MM</span><b>마켓메이트</b></div>
        <h1>{mode === "login" ? "친구들과 투자대회 시작하기" : "새 닉네임 만들기"}</h1>
        <p>ChatGPT 계정 없이 닉네임과 숫자 비밀번호로 이용합니다.</p>
        <div className="mode-switch auth-mode" role="tablist" aria-label="로그인 방식">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setStatus(""); }}>로그인</button>
          <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setStatus(""); }}>처음 이용</button>
        </div>
        <label className="auth-field">닉네임
          <Input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={12} autoComplete="username" placeholder="한글·영문·숫자 2~12자" />
        </label>
        <label className="auth-field">숫자 비밀번호 4자리
          <InputOTP maxLength={4} value={pin} onChange={value => setPin(value.replace(/\D/g, ""))} inputMode="numeric" autoComplete={mode === "login" ? "current-password" : "new-password"}>
            <InputOTPGroup className="auth-pin">
              {[0, 1, 2, 3].map(index => <PinSlot key={index} index={index} />)}
            </InputOTPGroup>
          </InputOTP>
        </label>
        {mode === "register" && <div className="auth-notice">닉네임은 대회 순위표에 표시되며 중복으로 만들 수 없습니다.</div>}
        {status && <p className="auth-error" role="alert">{status}</p>}
        <Button onClick={submit} disabled={busy || nickname.trim().length < 2 || pin.length !== 4} className="auth-submit">
          {busy ? "확인 중..." : mode === "login" ? "로그인" : "가입하고 시작"}
        </Button>
        <small>비밀번호 5회 오류 시 10분 동안 로그인이 제한됩니다.</small>
      </section>
    </main>
  );
}

function SearchBox({ onSelect }: { onSelect: (instrument: Instrument) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const value = query.trim();
    if (!value) { setResults([]); setLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/instruments/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error("SEARCH_FAILED");
          return await response.json() as { instruments?: Instrument[] };
        })
        .then(data => setResults(data.instruments ?? []))
        .catch(() => !controller.signal.aborted && setResults([]))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const choose = (instrument: Instrument) => { onSelect(instrument); setQuery(""); setResults([]); };
  return (
    <div className="search-wrap">
      <Search aria-hidden="true" />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="네이버증권에서 국내·미국주식·코인 검색" aria-label="종목 검색" />
      {query && <button aria-label="검색어 지우기" onClick={() => setQuery("")}><X /></button>}
      {query && (
        <div className="search-results">
          {loading ? <p>종목을 찾는 중...</p> : results.length ? results.map(item => (
            <button key={`${item.market}:${item.symbol}`} onClick={() => choose(item)}>
              <span className="search-result-stock"><InstrumentLogo instrument={item} size="sm" /><span><strong>{item.name}</strong><small>{displaySymbol(item.market,item.symbol)} · {item.exchange}</small></span></span>
              <b>{item.market === "KR" ? "국내" : item.market === "US" ? "미국" : "코인"}</b>
            </button>
          )) : <p>일치하는 종목이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

function relativeTime(value:number) {
  if (!Number.isFinite(value) || value <= 0) return "날짜 미상";
  const minutes = Math.max(0, Math.floor((Date.now()-value)/60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes/60)}시간 전`;
  return `${Math.floor(minutes/1_440)}일 전`;
}

function formatWatchPrice(item:WatchlistItem) {
  if (!item.priceKrwMicros) return "시세 대기";
  const krw = item.priceKrwMicros/1_000_000;
  if (item.currency === "USD") return `$${(krw/((item.fxRateMicros ?? 1_000_000)/1_000_000)).toLocaleString("en-US",{maximumFractionDigits:2})}`;
  return `${Math.round(krw).toLocaleString("ko-KR")}원`;
}

function JoinDialog({ onChanged }: { onChanged: () => void }) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [code, setCode] = useState("");
  const [name, setName] = useState("친구 투자대회");
  const [cash, setCash] = useState("100000000");
  const [endsOn, setEndsOn] = useState(() => {
    const date = new Date(Date.now() + 30 * 86_400_000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
  });
  const [status, setStatus] = useState("");
  const submit = async () => {
    setStatus("처리 중...");
    const now = Date.now();
    const endsAt = Date.parse(`${endsOn}T23:59:59+09:00`);
    if (mode === "create" && (!Number.isFinite(endsAt) || endsAt <= now)) return setStatus("오늘 이후의 종료일을 선택해주세요.");
    const payload = mode === "join" ? { inviteCode: code } : {
      name, initialCashKrw: Number(cash), startsAt: now - 1_000, endsAt,
    };
    const response = await fetch(mode === "join" ? "/api/competitions/join" : "/api/competitions", {
      method: "POST", headers: { "content-type":"application/json" }, body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string; competition?: { inviteCode?: string } };
    if (!response.ok) return setStatus(result.error ?? "처리하지 못했습니다.");
    setStatus(mode === "join" ? "대회에 참가했습니다." : `대회를 만들었습니다. 초대코드: ${result.competition?.inviteCode}`);
    onChanged();
  };
  return (
    <Dialog>
      <DialogTrigger asChild><Button className="contest-button"><Trophy /> 대회 참가</Button></DialogTrigger>
      <DialogContent className="rounded-2xl border-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{mode === "join" ? "초대코드로 참가" : "새 대회 만들기"}</DialogTitle>
          <DialogDescription>모든 참가자가 같은 금액으로 시작합니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-2">
          <div className="mode-switch"><button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>대회 참가</button><button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>대회 개설</button></div>
          {mode === "join" ? <label className="field-label">초대코드<Input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="MATE-XXXXXX" className="mt-2 uppercase" /></label> : <>
            <label className="field-label">대회 이름<Input value={name} onChange={event => setName(event.target.value)} className="mt-2" maxLength={60} /></label>
            <label className="field-label">시작 자금<Input value={cash} onChange={event => setCash(event.target.value.replace(/\D/g, ""))} className="mt-2" inputMode="numeric" /></label>
            <label className="field-label">대회 종료일<Input type="date" value={endsOn} onChange={event => setEndsOn(event.target.value)} className="mt-2" /><small>선택한 날짜의 23:59(KST)에 종료됩니다.</small></label>
          </>}
        </div>
        <DialogFooter className="px-6 pb-6"><div className="w-full">{status && <p className="mb-3 text-center text-xs text-muted-foreground" role="status">{status}</p>}<Button onClick={submit} className="w-full bg-[#19a974] hover:bg-[#14875d]">{mode === "join" ? "참가하기" : "대회 만들기"}</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParticipantActivityDialog({ row, onClose }: { row: LeaderboardRow | null; onClose: () => void }) {
  const [activity, setActivity] = useState<ParticipantActivity | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!row) { setActivity(null); setStatus(""); return; }
    const controller = new AbortController();
    setStatus("거래내역을 불러오는 중...");
    fetch(`/api/participants/activity?participantId=${encodeURIComponent(row.participantId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as ParticipantActivity & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "거래내역을 불러오지 못했습니다.");
        setActivity(result); setStatus("");
      })
      .catch(error => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "거래내역을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [row]);
  return <Dialog open={Boolean(row)} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="activity-dialog sm:max-w-2xl">
    <DialogHeader><DialogTitle>{row?.nickname}님의 투자현황</DialogTitle><DialogDescription>같은 대회 참가자에게 공개되는 보유종목과 모의체결 내역입니다.</DialogDescription></DialogHeader>
    {status ? <p className="activity-status">{status}</p> : <Tabs defaultValue="positions"><TabsList className="activity-tabs"><TabsTrigger value="positions">보유종목 {activity?.positions.length ?? 0}</TabsTrigger><TabsTrigger value="fills">체결내역 {activity?.fills.length ?? 0}</TabsTrigger></TabsList>
      <TabsContent value="positions" className="activity-list">{activity?.positions.length ? activity.positions.map(position => <div key={`${position.market}:${position.symbol}`}><span><b>{position.name}</b><small>{position.market} · {displaySymbol(position.market,position.symbol)} · {position.exchange}</small></span><span><b>{formatQuantity(position.quantityMicros)}</b><small className={(position.unrealizedPnlKrw ?? 0) >= 0 ? "up" : "down"}>{formatKrw(position.unrealizedPnlKrw ?? 0)} · {position.currentPriceKrwMicros ? formatReturnRate(positionReturnRate(position)) : "-"}</small></span></div>) : <p>현재 보유종목이 없습니다.</p>}</TabsContent>
      <TabsContent value="fills" className="activity-list">{activity?.fills.length ? activity.fills.map(fill => <div key={fill.id}><span><b>{fill.name}</b><small>{formatDateTime(fill.executedAt)}{fill.market==="KR"&&fill.venue?` · ${fill.venue}`:""} · {formatQuantity(fill.quantityMicros)}{fill.market === "CRYPTO" ? "개" : "주"}</small></span><span><b className={fill.side === "buy" ? "up" : "down"}>{fill.side === "buy" ? "매수" : "매도"}</b><small className={fill.returnRate == null ? "" : fill.returnRate >= 0 ? "up" : "down"}>{formatKrw(fillValueKrw(fill))} · {fill.returnRateKind === "realized" ? "실현" : "현재"} {formatReturnRate(fill.returnRate)}</small></span></div>) : <p>아직 체결내역이 없습니다.</p>}</TabsContent>
    </Tabs>}
  </DialogContent></Dialog>;
}

function AdminDialog() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [status, setStatus] = useState("");
  const [pins, setPins] = useState({ currentPin: "", newPin: "" });
  const load = useCallback(() => fetch("/api/admin/overview", { cache: "no-store" }).then(async response => {
    const result = await response.json() as AdminData & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "관리 데이터를 불러오지 못했습니다.");
    setData(result);
  }).catch(error => setStatus(error instanceof Error ? error.message : "오류가 발생했습니다.")), []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const action = async (payload: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setStatus("처리 중...");
    const response = await fetch("/api/admin/actions", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
    const result = await response.json() as { error?:string };
    setStatus(response.ok ? "적용했습니다." : result.error ?? "처리하지 못했습니다.");
    if (response.ok) void load();
  };
  const changePin = async () => {
    const response = await fetch("/api/admin/pin", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(pins) });
    const result = await response.json() as { error?:string };
    setStatus(response.ok ? "관리자 PIN을 변경했습니다." : result.error ?? "변경하지 못했습니다.");
    if (response.ok) setPins({ currentPin:"", newPin:"" });
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="admin-button"><ShieldCheck /> 관리자</Button></DialogTrigger><DialogContent className="admin-dialog sm:max-w-4xl">
    <DialogHeader><DialogTitle>전체 관리자 센터</DialogTitle><DialogDescription>대회와 회원, 관리자 보안을 관리합니다.</DialogDescription></DialogHeader>
    {status && <p className="admin-status">{status}</p>}
    <div className="admin-health"><span>활성 세션<b>{data?.health.activeSessions ?? 0}</b></span><span>대기 주문<b>{data?.health.pendingOrders ?? 0}</b></span><span>거절 주문<b>{data?.health.rejectedOrders ?? 0}</b></span><span>최근 시세<b>{data?.health.latestQuoteAt ? relativeTime(data.health.latestQuoteAt) : "없음"}</b></span></div>
    <Tabs defaultValue="competitions"><TabsList className="admin-tabs"><TabsTrigger value="competitions">대회</TabsTrigger><TabsTrigger value="users">회원</TabsTrigger><TabsTrigger value="audit">감사 기록</TabsTrigger><TabsTrigger value="security">보안</TabsTrigger></TabsList>
      <TabsContent value="competitions" className="admin-list">{data?.competitions.map(item => <div key={item.id}><span><b>{item.name}</b><small>{item.ownerNickname} · {item.participantCount}명 · 체결 {item.fillCount}건 · {item.inviteCode}</small></span><span><button onClick={() => action({action:"competition_status",competitionId:item.id,status:item.status === "active" ? "ended" : "active"})}>{item.status === "active" ? "종료" : "재개"}</button><button className="danger" onClick={() => action({action:"delete_competition",competitionId:item.id}, `${item.name} 대회와 모든 모의투자 기록을 삭제할까요?`)}>삭제</button></span><div className="admin-members">{data.participants.filter(member => member.competitionId === item.id).map(member => <span key={member.id}>{member.nickname}{member.isOwner ? " (대회장)" : <button onClick={() => action({action:"remove_member",participantId:member.id}, `${member.nickname}님을 대회에서 내보낼까요?`)}>내보내기</button>}</span>)}</div></div>)}</TabsContent>
      <TabsContent value="users" className="admin-list">{data?.users.map(item => <div key={item.id}><span><b>{item.nickname}{item.role === "admin" ? " · 관리자" : ""}</b><small>대회 {item.competitionCount}개 · 체결 {item.fillCount}건</small></span><span><button disabled={item.role === "admin"} onClick={() => action({action:"user_status",userId:item.id,active:!Boolean(item.isActive)})}>{item.isActive ? "이용 정지" : "활성화"}</button><button className="danger" disabled={item.role === "admin"} onClick={() => action({action:"delete_user",userId:item.id}, `${item.nickname} 계정과 모든 대회·투자 기록을 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)}><Trash2 /> 삭제</button></span></div>)}</TabsContent>
      <TabsContent value="audit" className="admin-audit">{data?.audit.map(item => <div key={item.id}><span><b>{item.action}</b><small>{item.actorNickname} · {item.targetType}{item.targetId ? ` · ${item.targetId.slice(0,8)}` : ""}</small></span><time>{formatDateTime(item.createdAt)}</time></div>)}</TabsContent>
      <TabsContent value="security" className="admin-security"><p>초기 PIN 0011은 즉시 변경을 권장합니다.</p><Input value={pins.currentPin} onChange={event => setPins(value => ({...value,currentPin:event.target.value.replace(/\D/g, "").slice(0,4)}))} placeholder="현재 PIN" inputMode="numeric" /><Input value={pins.newPin} onChange={event => setPins(value => ({...value,newPin:event.target.value.replace(/\D/g, "").slice(0,4)}))} placeholder="새 PIN" inputMode="numeric" /><Button onClick={changePin} disabled={pins.currentPin.length !== 4 || pins.newPin.length !== 4}>PIN 변경</Button></TabsContent>
    </Tabs>
  </DialogContent></Dialog>;
}

function OrderPanel({ quote, participantId, availableCashKrw, heldQuantityMicros, session, domesticVenue, onDomesticVenueChange, onFilled }: { quote: Quote; participantId: string | null; availableCashKrw: number; heldQuantityMicros: number; session: MarketSession; domesticVenue: DomesticVenue; onDomesticVenueChange: (venue: DomesticVenue) => void; onFilled: () => void }) {
  const [quantity, setQuantity] = useState("1");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const effectivePrice = orderType === "limit" ? Number(limitPrice || 0) : quote.price;
  const estimatedKrw = effectivePrice * quote.exchangeRate * Number(quantity || 0);
  const changeQuantity = (value: string) => {
    if (quote.market !== "CRYPTO") return setQuantity(value.replace(/\D/g, ""));
    const normalized = value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    const [whole, decimal = ""] = normalized.split(".");
    setQuantity(normalized.includes(".") ? `${whole}.${decimal.slice(0, 6)}` : whole);
  };
  const loadOrders = useCallback(() => {
    if (!participantId) return setOrders([]);
    fetch(`/api/orders?participantId=${encodeURIComponent(participantId)}`, { cache:"no-store" }).then(async response => response.ok ? await response.json() as {orders:Order[]} : null).then(result => setOrders(result?.orders ?? [])).catch(()=>undefined);
  }, [participantId]);
  useEffect(() => { const timer = setTimeout(loadOrders,0); return()=>clearTimeout(timer); }, [loadOrders,quote.price]);
  useEffect(() => { const timer=setTimeout(()=>{if(quote.price)setLimitPrice(String(quote.price));},0);return()=>clearTimeout(timer);},[quote.market,quote.symbol,quote.price]);
  const sizeByPercent=(side:"buy"|"sell",percent:number)=>{if(!quote.price)return;const raw=side==="buy"?availableCashKrw*percent/(effectivePrice*quote.exchangeRate):heldQuantityMicros/1_000_000*percent;const sized=quote.market==="CRYPTO"?Math.floor(raw*1_000_000)/1_000_000:Math.floor(raw);setQuantity(String(Math.max(0,sized)));};
  const submit=async(side:"buy"|"sell")=>{if(!participantId)return setStatus("먼저 대회를 만들거나 참가해주세요.");if(!quote.price)return setStatus("실시간 시세를 확인한 뒤 주문해주세요.");setStatus("네이버증권 최신 시세를 확인하고 있습니다...");const response=await fetch("/api/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,clientOrderId:crypto.randomUUID(),market:quote.market,symbol:quote.symbol,name:quote.name,exchange:quote.exchange,venue:quote.market==="KR"?domesticVenue:undefined,side,orderType,quantity:Number(quantity),limitPrice:orderType==="limit"?Number(limitPrice):undefined})});const result=await response.json() as {error?:string;order?:{status?:string}};setStatus(response.ok?(result.order?.status==="pending"?"지정가 대기 주문을 접수했습니다.":"모의주문이 네이버증권 최신 시세로 체결되었습니다."):result.error??"주문을 처리하지 못했습니다.");if(response.ok){onFilled();loadOrders();}};
  const cancel=async(id:string)=>{const response=await fetch(`/api/orders?orderId=${encodeURIComponent(id)}`,{method:"DELETE"});setStatus(response.ok?"대기 주문을 취소했습니다.":"주문을 취소하지 못했습니다.");loadOrders();};
  return <section className="panel order-panel"><Tabs defaultValue="buy"><TabsList variant="line" className="order-tabs"><TabsTrigger value="buy" className="buy-tab">매수</TabsTrigger><TabsTrigger value="sell" className="sell-tab">매도</TabsTrigger></TabsList>{(["buy","sell"] as const).map(side=><TabsContent value={side} key={side} className="order-form"><div className="available"><span>{side==="buy"?"주문 가능 현금":"보유 수량"}</span><strong>{side==="buy"?formatKrw(availableCashKrw):`${formatQuantity(heldQuantityMicros)}${quote.market==="CRYPTO"?"개":"주"}`}</strong></div>{quote.market==="KR"&&<div className="order-venue-selector"><span>거래소</span><div><button type="button" className={domesticVenue==="KRX"?"active":""} onClick={()=>onDomesticVenueChange("KRX")}>KRX</button><button type="button" className={domesticVenue==="NXT"?"active":""} disabled={Boolean(quote.availableVenues)&&!quote.availableVenues?.includes("NXT")} onClick={()=>onDomesticVenueChange("NXT")}>NXT</button></div></div>}<div className={session.isOpen?"session open":"session closed"}><b>{session.isOpen?"●":"○"} {session.label}</b><small>{session.notice}</small></div><label>주문 유형<select aria-label="주문 유형" value={orderType} onChange={event=>setOrderType(event.target.value as "market"|"limit")}><option value="market">시장가</option><option value="limit">지정가</option></select></label>{orderType==="limit"&&<label>지정 가격<div className="number-input"><input value={limitPrice} onChange={event=>setLimitPrice(event.target.value.replace(/[^\d.]/g,""))} inputMode="decimal"/><span>{quote.currency}</span></div></label>}<label>수량<div className="number-input"><input value={quantity} onChange={event=>changeQuantity(event.target.value)} inputMode={quote.market==="CRYPTO"?"decimal":"numeric"}/><span>{quote.market==="CRYPTO"?"개":"주"}</span></div></label><div className="size-buttons">{[[.25,"25%"],[.5,"50%"],[.75,"75%"],[1,"최대"]].map(([percent,label])=><button key={String(label)} onClick={()=>sizeByPercent(side,Number(percent))}>{label}</button>)}</div>{quote.currency==="USD"&&<div className="available"><span>적용 환율</span><strong>{quote.exchangeRate>1?`${quote.exchangeRate.toLocaleString("ko-KR")}원/USD`:"시세 조회 시 적용"}</strong></div>}<div className="order-total"><span>예상 주문금액</span><strong>{formatKrw(estimatedKrw)}</strong></div><Button disabled={!session.isOpen&&quote.market!=="CRYPTO"} onClick={()=>submit(side)} className={side==="buy"?"order-buy":"order-sell"}>{session.isOpen||quote.market==="CRYPTO"?`${quote.name} ${side==="buy"?"매수":"매도"}`:"장 운영시간이 아닙니다"}</Button>{status&&<p className="order-status" role="status">{status}</p>}<p className="simulation-note">실제 증권 주문은 전송되지 않습니다.</p>{orders.some(order=>order.status==="pending")&&<div className="pending-orders"><b>대기 주문</b>{orders.filter(order=>order.status==="pending").slice(0,5).map(order=><div key={order.id}><span>{order.name}{order.venue?` · ${order.venue}`:""} · {order.side==="buy"?"매수":"매도"} {formatQuantity(order.quantityMicros)} @ {((order.limitPriceMicros??0)/1_000_000).toLocaleString()}</span><button onClick={()=>cancel(order.id)}>취소</button></div>)}</div>}</TabsContent>)}</Tabs></section>;
}

const NAVER_STOCK_LOGO_BASE="https://ssl.pstatic.net/imgstock/fn/real/logo/stock/";
const NAVER_CRYPTO_LOGO_BASE="https://ssl.pstatic.net/imgstock/fn/real/logo/crypto/";
const CRYPTO_LOGO_PRIMARY_BASE="https://static.upbit.com/logos/";
function normalizeNaverLogoCode(symbol:string){let clean=String(symbol??"").trim().replaceAll("\\","/");const tail=clean.split("/").filter(Boolean).pop()??"";clean=tail.replace(/\.svg$/i,"").replace(/^(?:Stock)+/i,"");return clean.replace(/[^A-Za-z0-9._-]/g,"");}
function normalizeCryptoLogoTicker(symbol:string){return String(symbol??"").trim().toUpperCase().replace(/^KRW[-_]/,"").replace(/_KRW_(?:upbit|bithumb)$/i,"").replace(/[^A-Z0-9]/g,"");}
function instrumentLogoCandidates(instrument:Pick<Instrument,"market"|"symbol"|"exchange">){if(instrument.market==="CRYPTO"){const ticker=normalizeCryptoLogoTicker(instrument.symbol);if(!ticker)return[];return[`${CRYPTO_LOGO_PRIMARY_BASE}${encodeURIComponent(ticker)}.png`,`${NAVER_CRYPTO_LOGO_BASE}Crypto${ticker}.svg`];}const code=normalizeNaverLogoCode(instrument.symbol);if(!code)return[];if(instrument.market==="US"){const resolver=`/api/instruments/logo?symbol=${encodeURIComponent(code)}`;return[...new Set([resolver,`${NAVER_STOCK_LOGO_BASE}Stock${code}.svg`])];}return[`${NAVER_STOCK_LOGO_BASE}Stock${code}.svg`];}
// Observed Naver search results group fallback colors into six recurring hues.
const INSTRUMENT_FALLBACK_COLORS=["#cf6530","#dc9a24","#50896a","#4d75a8","#8e4ca4","#be3b7c"] as const;
function instrumentFallbackSeed(instrument:Pick<Instrument,"market"|"symbol"|"name">){const code=normalizeNaverLogoCode(instrument.symbol).replace(/\.(?:O|K|N|P|A)$/i,"").normalize("NFKC").trim();return code||instrument.name.normalize("NFKC").trim();}
function instrumentFallbackColor(instrument:Pick<Instrument,"market"|"symbol"|"name">){const seed=instrumentFallbackSeed(instrument);let hash=0;for(let i=0;i<seed.length;i+=1)hash=(Math.imul(hash,31)+seed.charCodeAt(i))|0;const index=((hash%INSTRUMENT_FALLBACK_COLORS.length)+INSTRUMENT_FALLBACK_COLORS.length)%INSTRUMENT_FALLBACK_COLORS.length;return INSTRUMENT_FALLBACK_COLORS[index];}
function instrumentFallbackLetter(name:string,symbol:string){const clean=(name||symbol||"?").trim();const first=Array.from(clean)[0]??Array.from(symbol.trim())[0]??"?";return /[A-Za-z]/.test(first)?first.toUpperCase():first;}
function InstrumentLogo({instrument,size="md"}:{instrument:Pick<Instrument,"market"|"symbol"|"exchange"|"name">;size?:"sm"|"md"|"lg"}){const[attempt,setAttempt]=useState(0);useEffect(()=>setAttempt(0),[instrument.market,instrument.symbol]);const candidates=instrumentLogoCandidates(instrument);const src=candidates[attempt];const failed=!src;return <span className={`instrument-logo ${size}${failed?" fallback":""}`} style={failed?{backgroundColor:instrumentFallbackColor(instrument)}:undefined}>{failed?<span aria-hidden="true">{instrumentFallbackLetter(instrument.name,instrument.symbol)}</span>:<img src={src} alt={`${instrument.name} 로고`} onError={()=>setAttempt(value=>value+1)}/>}</span>;}
function dDay(endsAt:number){const days=Math.ceil((endsAt-Date.now())/86_400_000);if(days<0)return"종료";if(days===0)return"D-DAY";return`D-${days}`;}
function formatEndDate(value:number){return new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);}
function LiveMarketStrip({quotes,onPick}:{quotes:MarketIndexQuote[];onPick:(id:string,market:Market)=>void}){const expected=[{id:"KOSPI",name:"코스피",market:"KR" as Market},{id:"KOSDAQ",name:"코스닥",market:"KR" as Market},{id:"SPX",name:"S&P 500",market:"US" as Market},{id:"COMP",name:"나스닥 종합",market:"US" as Market},{id:"BTC",name:"비트코인",market:"CRYPTO" as Market}];return <div className="live-market-strip">{expected.map(meta=>{const item=quotes.find(q=>q.id===meta.id);return <button key={meta.id} onClick={()=>onPick(meta.id,meta.market)}><span>{meta.name}<small>{item?"네이버증권":"시세 확인 중"}</small></span><strong>{item?`${item.price.toLocaleString("ko-KR",{maximumFractionDigits:item.id==="BTC"?0:2})}${item.unit}`:"-"}</strong><em className={(item?.rate??0)>=0?"up":"down"}>{item?`${item.rate>=0?"+":""}${item.rate.toFixed(2)}%`:""}</em></button>})}</div>;}
function NewsPanel({items,title,loading=false}:{items:NewsItem[];title:string;loading?:boolean}){const sorted=[...items].sort((a,b)=>b.publishedAt-a.publishedAt);return <section className="np-panel np-news"><div className="np-section-title"><h2>{title}</h2><span>{sorted.length?`${Math.min(sorted.length,10)}건 · 최신순`:""}</span></div>{sorted.length?sorted.slice(0,10).map(item=><article key={`${item.link}:${item.publishedAt}`}><a href={item.link} target="_blank" rel="noreferrer">{item.title}</a><span>{item.source} · {relativeTime(item.publishedAt)}</span></article>):<p className="np-empty">{loading?"네이버증권 뉴스를 불러오는 중입니다.":"표시할 뉴스가 없습니다."}</p>}</section>;}
function formatPopularPrice(item:PopularStock){
  if(!Number.isFinite(item.price)||item.price<=0)return"-";
  return item.currency==="USD"
    ? `$${item.price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`
    : item.price.toLocaleString("ko-KR",{maximumFractionDigits:0});
}
function PopularStocksPanel({domestic,us,onSelect}:{domestic:PopularStock[];us:PopularStock[];onSelect:(item:PopularStock)=>void}){
  const[open,setOpen]=useState(false);
  const[tab,setTab]=useState<"KR"|"US">("KR");
  const[featuredIndex,setFeaturedIndex]=useState(0);
  const featuredRows=domestic.slice(0,10);
  const featured=featuredRows[featuredIndex]??featuredRows[0]??null;
  const rows=tab==="KR"?domestic:us;
  const choose=(item:PopularStock)=>{setOpen(false);onSelect(item);};

  useEffect(()=>{
    if(featuredIndex<featuredRows.length)return;
    setFeaturedIndex(0);
  },[featuredIndex,featuredRows.length]);

  useEffect(()=>{
    if(open||featuredRows.length<2)return;
    const timer=setInterval(()=>setFeaturedIndex(index=>(index+1)%featuredRows.length),3000);
    return()=>clearInterval(timer);
  },[open,featuredRows.length]);

  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.body.style.overflow="hidden";
    window.addEventListener("keydown",onKey);
    return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",onKey);};
  },[open]);

  return <><section className="np-popular-stocks">
    <div className="np-popular-compact">
      <button type="button" className="np-popular-primary" onClick={()=>featured&&onSelect(featured)} disabled={!featured} aria-label={featured?`${featured.rank}위 ${featured.name} 시세 보기`:"인기 종목 불러오는 중"}>
        <span className="np-popular-badge">인기 종목</span>
        {featured?<><b className="np-popular-rank" key={`rank:${featured.market}:${featured.symbol}`}>{featured.rank}</b><strong className="np-popular-name" key={`name:${featured.market}:${featured.symbol}`}>{featured.name}</strong><em className={`np-popular-rate ${featured.changeRate>=0?"up":"down"}`} key={`rate:${featured.market}:${featured.symbol}`}>{featured.changeRate>=0?"+":""}{featured.changeRate.toFixed(2)}%</em></>:<><b>1</b><strong>인기 종목 불러오는 중</strong><em>-</em></>}
      </button>
      <button type="button" className="np-popular-expand" onClick={()=>setOpen(true)} aria-label="인기 종목 1위부터 10위까지 보기"><ChevronDown aria-hidden="true"/></button>
    </div>
  </section>
  {open&&<div className="popular-stocks-layer" role="presentation" onMouseDown={()=>setOpen(false)}>
    <section className="popular-stocks-sheet" role="dialog" aria-modal="true" aria-labelledby="popular-stocks-title" onMouseDown={event=>event.stopPropagation()}>
      <div className="popular-stocks-sheet-head">
        <h2 id="popular-stocks-title">인기 종목</h2>
        <button type="button" className="popular-stocks-close" onClick={()=>setOpen(false)} aria-label="인기 종목 닫기"><X/></button>
      </div>
      <Tabs value={tab} onValueChange={value=>setTab(value as "KR"|"US")} className="popular-stocks-tabs">
        <TabsList className="popular-stocks-tab-list">
          <TabsTrigger value="KR">국내</TabsTrigger>
          <TabsTrigger value="US">미국</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="popular-stocks-list">
          {rows.length?rows.slice(0,10).map(item=><button type="button" key={`${item.market}:${item.symbol}`} onClick={()=>choose(item)}>
            <b className="popular-stock-rank">{item.rank}</b>
            <span className="popular-stock-logo"><InstrumentLogo instrument={item} size="md"/><i aria-hidden="true"><Flame/></i></span>
            <span className="popular-stock-name"><strong>{item.name}</strong><small>{displaySymbol(item.market,item.symbol)}</small></span>
            <span className="popular-stock-price"><strong>{formatPopularPrice(item)}</strong><em className={item.changeRate>=0?"up":"down"}>{item.change>=0?"+":""}{item.change.toLocaleString(item.currency==="USD"?"en-US":"ko-KR",{maximumFractionDigits:item.currency==="USD"?2:0})} ({Math.abs(item.changeRate).toFixed(2)}%)</em></span>
          </button>):<p className="np-empty">{tab==="KR"?"국내 인기 종목을 불러오는 중입니다.":"미국 인기 종목을 불러오는 중입니다."}</p>}
        </TabsContent>
      </Tabs>
    </section>
  </div>}</>;
}

function RankingPanel({rows,participantId,onSelect}:{rows:LeaderboardRow[];participantId:string|null;onSelect:(row:LeaderboardRow)=>void}){return <section className="np-panel np-ranking"><div className="np-section-title"><h2>실시간 대회 순위</h2><span>{rows.length}명</span></div><div className="ranking-head"><span>순위·참가자</span><span>총자산</span><span>수익률</span></div>{rows.length?rows.map(row=>{const value=returnRate(row.totalAssetKrw,row.initialCashKrw);return <button className={row.participantId===participantId?"mine":""} onClick={()=>onSelect(row)} key={row.participantId}><b>{row.rank}</b><span><strong>{row.nickname}</strong><small>{displayRecentSymbols(row.recentSymbols)}</small></span><span>{formatKrw(row.totalAssetKrw)}</span><em className={value>=0?"up":"down"}>{value>=0?"+":""}{value.toFixed(2)}%</em><ChevronRight/></button>}):<p className="np-empty">대회를 만들거나 초대코드로 참가해주세요.</p>}</section>;}
function TopPicksPanel({rows,onSelect}:{rows:CompetitionTopPick[];onSelect:(item:CompetitionTopPick)=>void}){return <section className="np-panel np-top-picks"><div className="np-section-title"><h2>대회 Top Pick</h2><span>2명 이상 보유</span></div><div className="top-picks-head"><span>순위·종목</span><span>보유자</span><span>평가금액</span></div>{rows.length?rows.map(row=><button key={`${row.market}:${row.symbol}`} onClick={()=>onSelect(row)}><b className="top-pick-rank">{row.rank}</b><span className="stock-cell"><InstrumentLogo instrument={row} size="sm"/><span><strong>{row.name}</strong><small>{displaySymbol(row.market,row.symbol)} · {row.market==="KR"?"국내":row.market==="US"?"미국":"코인"}</small></span></span><strong className="top-pick-holders">{row.holderCount}명</strong><span className="top-pick-value">{formatKrw(row.totalMarketValueKrw)}</span><ChevronRight/></button>):<p className="np-empty">현재 2명 이상이 함께 보유한 종목이 없습니다.</p>}</section>;}

type DomesticScheduleRow={label:string;start:string;end:string;tradable:boolean};
const DOMESTIC_TRADING_SCHEDULE:{venue:DomesticVenue;rows:DomesticScheduleRow[]}[]=[
  {venue:"KRX",rows:[
    {label:"장전 시간외 종가",start:"08:40",end:"08:50",tradable:true},
    {label:"장전 동시호가",start:"08:50",end:"09:00",tradable:false},
    {label:"정규장",start:"09:00",end:"15:20",tradable:true},
    {label:"장후 동시호가",start:"15:20",end:"15:30",tradable:false},
    {label:"정규장 마감",start:"15:30",end:"15:40",tradable:false},
    {label:"장후 시간외 종가",start:"15:40",end:"16:00",tradable:true},
    {label:"애프터마켓",start:"16:00",end:"20:00",tradable:true},
    {label:"장 마감",start:"20:00",end:"08:40",tradable:false},
  ]},
  {venue:"NXT",rows:[
    {label:"프리마켓",start:"08:00",end:"08:50",tradable:true},
    {label:"프리마켓 마감",start:"08:50",end:"09:00",tradable:false},
    {label:"정규장",start:"09:00",end:"15:20",tradable:true},
    {label:"정규장 마감",start:"15:20",end:"15:40",tradable:false},
    {label:"애프터마켓",start:"15:40",end:"20:00",tradable:true},
    {label:"장 마감",start:"20:00",end:"08:00",tradable:false},
  ]},
];
function scheduleMinutes(value:string){const[hour,minute]=value.split(":").map(Number);return hour*60+minute;}
function isScheduleCurrent(row:DomesticScheduleRow,minutes:number){const start=scheduleMinutes(row.start);const end=scheduleMinutes(row.end);return start<end?minutes>=start&&minutes<end:minutes>=start||minutes<end;}
function seoulClock(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"00";const hour=value("hour");const minute=value("minute");return{minutes:Number(hour)*60+Number(minute),label:`${hour}:${minute}`};}
function ScheduleRows({rows,minutes,prefix}:{rows:DomesticScheduleRow[];minutes:number|null;prefix:string}){
  const viewportRef=useRef<HTMLDivElement|null>(null);
  const currentIndex=minutes===null?-1:rows.findIndex(row=>isScheduleCurrent(row,minutes));
  useLayoutEffect(()=>{if(currentIndex<0||typeof window==="undefined"||!window.matchMedia("(max-width:760px)").matches)return;const viewport=viewportRef.current;if(!viewport)return;const current=viewport.querySelector<HTMLElement>(".domestic-schedule-row.current");if(!current)return;const viewportRect=viewport.getBoundingClientRect();const currentRect=current.getBoundingClientRect();const currentTop=currentRect.top-viewportRect.top+viewport.scrollTop;viewport.scrollTop=Math.max(0,currentTop-(viewport.clientHeight-currentRect.height)/2);},[currentIndex]);
  return <div className="schedule-rows-viewport" ref={viewportRef}>{rows.map(row=>{const current=minutes!==null&&isScheduleCurrent(row,minutes);return <div className={`domestic-schedule-row${current?" current":""}`} key={`${prefix}:${row.label}`}>
    <span className="domestic-session-name">{current&&<i className="schedule-live-dot" aria-label="현재 시간대"/>}<b>{row.label}</b></span>
    <span className="domestic-session-time">{row.start}~{row.end}</span>
    <span className={row.tradable?"schedule-order open":"schedule-order closed"}>{row.tradable?"가능":"불가"}</span>
  </div>})}</div>;
}
function DomesticTradingSchedule(){
  const[now,setNow]=useState<{minutes:number;label:string}|null>(null);
  useEffect(()=>{const update=()=>setNow(seoulClock());update();const timer=setInterval(update,30_000);return()=>clearInterval(timer);},[]);
  return <div className="domestic-schedule">
    <div className="domestic-schedule-now"><span className="schedule-live-dot"/><span>한국시간 현재</span><strong>{now?.label??"--:--"}</strong></div>
    <div className="domestic-schedule-grid">{DOMESTIC_TRADING_SCHEDULE.map(group=><section className="domestic-venue-card" key={group.venue}>
      <div className="domestic-venue-head"><strong>{group.venue}</strong><span>주문 시간표</span></div>
      <div className="domestic-schedule-head"><span>구분</span><span>시간</span><span>주문</span></div>
      <ScheduleRows rows={group.rows} minutes={now?.minutes??null} prefix={group.venue}/>
    </section>)}</div>
  </div>;
}

function usTradingScheduleRows(isDst:boolean):DomesticScheduleRow[]{
  return isDst?[
    {label:"프리마켓",start:"17:00",end:"22:30",tradable:true},
    {label:"정규장",start:"22:30",end:"05:00",tradable:true},
    {label:"애프터마켓",start:"05:00",end:"08:50",tradable:true},
    {label:"장 마감",start:"08:50",end:"17:00",tradable:false},
  ]:[
    {label:"프리마켓",start:"18:00",end:"23:30",tradable:true},
    {label:"정규장",start:"23:30",end:"06:00",tradable:true},
    {label:"애프터마켓",start:"06:00",end:"09:50",tradable:true},
    {label:"장 마감",start:"09:50",end:"18:00",tradable:false},
  ];
}
function newYorkDaylightSavingNow(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",timeZoneName:"short"}).formatToParts(new Date());const zone=parts.find(part=>part.type==="timeZoneName")?.value??"";return zone.toUpperCase().includes("EDT");}
function UsTradingSchedule(){
  const[state,setState]=useState<{minutes:number;label:string;isDst:boolean}|null>(null);
  useEffect(()=>{const update=()=>{const seoul=seoulClock();setState({...seoul,isDst:newYorkDaylightSavingNow()});};update();const timer=setInterval(update,30_000);return()=>clearInterval(timer);},[]);
  const rows=usTradingScheduleRows(state?.isDst??true);
  return <div className="domestic-schedule us-schedule">
    <div className="market-schedule-title"><strong>미국주식</strong><span>한국시간 기준 · {state?(state.isDst?"서머타임":"표준시"):"확인 중"}</span></div>
    <div className="domestic-schedule-now"><span className="schedule-live-dot"/><span>한국시간 현재</span><strong>{state?.label??"--:--"}</strong></div>
    <div className="domestic-schedule-grid"><section className="domestic-venue-card us-venue-card">
      <div className="domestic-venue-head"><strong>미국주식</strong><span>{state?.isDst?"서머타임 적용":"표준시 적용"}</span></div>
      <div className="domestic-schedule-head"><span>구분</span><span>시간</span><span>주문</span></div>
      <ScheduleRows rows={rows} minutes={state?.minutes??null} prefix="US"/>
    </section></div>
  </div>;
}

function CryptoTradingSchedule(){
  return <div className="crypto-trading-schedule">
    <div><span><b>가상자산</b><small>네이버증권 시세 기준</small></span><strong>24시간</strong><em>가능</em></div>
  </div>;
}

export default function TradingDashboard(){
  const[auth,setAuth]=useState<"loading"|User|null>("loading");const[view,setView]=useState<AppView>("home");const[market,setMarket]=useState<Market>("KR");const[marketTab,setMarketTab]=useState<MarketTab>("KR");const[selected,setSelected]=useState<Quote>(DEFAULTS.KR);const[selectedIndexId,setSelectedIndexId]=useState<MarketIndexId>("KOSPI");const[indexDetail,setIndexDetail]=useState<MarketIndexDetail|null>(null);const[indexStatus,setIndexStatus]=useState<"loading"|"live"|"unavailable">("loading");const[domesticVenue,setDomesticVenue]=useState<DomesticVenue>("KRX");const[quoteStatus,setQuoteStatus]=useState<"loading"|"live"|"unavailable">("loading");const[indices,setIndices]=useState<MarketIndexQuote[]>([]);const[competitions,setCompetitions]=useState<Competition[]>([]);const[competitionId,setCompetitionId]=useState<string|null>(null);const[leaderboard,setLeaderboard]=useState<LeaderboardRow[]>([]);const[topPicks,setTopPicks]=useState<CompetitionTopPick[]>([]);const[portfolio,setPortfolio]=useState<Portfolio|null>(null);const[selectedParticipant,setSelectedParticipant]=useState<LeaderboardRow|null>(null);const[marketSession,setMarketSession]=useState<MarketSession>(LOADING_MARKET_SESSION);const[revision,setRevision]=useState(0);const[watchlist,setWatchlist]=useState<WatchlistItem[]>([]);const[popularStocks,setPopularStocks]=useState<{domestic:PopularStock[];us:PopularStock[]}>({domestic:[],us:[]});const[newsItems,setNewsItems]=useState<NewsItem[]>([]);const[newsLoading,setNewsLoading]=useState(false);const[lastViewed,setLastViewed]=useState<Partial<Record<Market,Instrument>>>({});const[lastViewedMarket,setLastViewedMarket]=useState<Market>("KR");const[positionSortKey,setPositionSortKey]=useState<PositionSortKey>("marketValue");const[positionSortDirection,setPositionSortDirection]=useState<"asc"|"desc">("desc");
  const activeCompetition=competitions.find(item=>item.id===competitionId)??competitions[0]??null;const participantId=activeCompetition?.participantId??null;const myRank=leaderboard.find(row=>row.participantId===participantId);
  useEffect(()=>{fetch("/api/auth/me",{cache:"no-store"}).then(async r=>r.ok?(await r.json() as{user:User}).user:null).then(setAuth).catch(()=>setAuth(null));},[]);
  useEffect(()=>{if(!auth||auth==="loading")return;try{const raw=window.localStorage.getItem(`marketmate:last-viewed:${auth.id}`);if(!raw)return;const saved=JSON.parse(raw) as{lastMarket?:Market;instruments?:Partial<Record<Market,Instrument>>};const instruments=saved.instruments??{};setLastViewed(instruments);if(saved.lastMarket&&instruments[saved.lastMarket]?.symbol)setLastViewedMarket(saved.lastMarket);}catch{}},[auth]);
  const loadCompetitions=useCallback(()=>{fetch("/api/competitions",{cache:"no-store"}).then(async r=>r.ok?await r.json() as{competitions?:Competition[]}:null).then(data=>{const items=data?.competitions??[];setCompetitions(items);setCompetitionId(current=>current&&items.some(item=>item.id===current)?current:items[0]?.id??null);}).catch(()=>undefined);},[]);
  const loadWatchlist=useCallback(()=>{if(!auth||auth==="loading")return;const apply=(data:{items?:WatchlistItem[]}|null)=>{if(data?.items)setWatchlist(data.items);};fetch("/api/watchlist?mode=fast",{cache:"no-store"}).then(async r=>r.ok?await r.json() as{items?:WatchlistItem[];refreshing?:boolean}:null).then(data=>{apply(data);return fetch("/api/watchlist",{cache:"no-store"}).then(async r=>r.ok?await r.json() as{items?:WatchlistItem[]}:null).then(apply).catch(()=>undefined);}).catch(()=>{void fetch("/api/watchlist",{cache:"no-store"}).then(async r=>r.ok?await r.json() as{items?:WatchlistItem[]}:null).then(apply).catch(()=>undefined);});},[auth]);
  const loadAccount=useCallback(()=>{if(!participantId){setPortfolio(null);return;}fetch(`/api/portfolio?participantId=${encodeURIComponent(participantId)}`,{cache:"no-store"}).then(async r=>r.ok?await r.json() as Portfolio:null).then(setPortfolio).catch(()=>undefined);},[participantId]);
  useEffect(()=>{if(auth&&auth!=="loading")loadCompetitions();},[auth,loadCompetitions]);
  useEffect(()=>{const timer=setTimeout(loadWatchlist,0);return()=>clearTimeout(timer);},[loadWatchlist]);
  useEffect(()=>{if(!auth||auth==="loading"||view!=="home")return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const schedule=(delay:number)=>{if(active)timer=setTimeout(load,Math.max(10_000,Math.min(120_000,delay)));};const load=()=>fetch("/api/popular-stocks",{cache:"no-store"}).then(async r=>r.ok?await r.json() as{domestic?:PopularStock[];us?:PopularStock[];pollingInterval?:number}:null).then(data=>{if(!active)return;if(data){setPopularStocks({domestic:data.domestic??[],us:data.us??[]});}schedule(data?.pollingInterval??30_000);}).catch(()=>{if(active)schedule(30_000);});void load();return()=>{active=false;if(timer)clearTimeout(timer);};},[auth,view]);
  useEffect(()=>{if(!["home","market","portfolio"].includes(view))return;loadAccount();const timer=setInterval(loadAccount,15_000);return()=>clearInterval(timer);},[loadAccount,view]);
  useEffect(()=>{if(!["home","competition"].includes(view))return;if(!activeCompetition){setLeaderboard([]);setTopPicks([]);return;}let active=true;const load=()=>fetch(`/api/leaderboard?competitionId=${encodeURIComponent(activeCompetition.id)}`,{cache:"no-store"}).then(async r=>r.ok?await r.json() as{leaderboard?:LeaderboardRow[];topPicks?:CompetitionTopPick[]}:null).then(data=>{if(active){setLeaderboard(data?.leaderboard??[]);setTopPicks(data?.topPicks??[]);}}).catch(()=>undefined);void load();const timer=setInterval(load,15_000);return()=>{active=false;clearInterval(timer);};},[activeCompetition,revision,view]);
  useEffect(()=>{if(!auth||auth==="loading")return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const schedule=(delay:number)=>{if(active)timer=setTimeout(load,Math.max(2_000,Math.min(120_000,delay)));};const load=()=>fetch("/api/market-overview",{cache:"no-store"}).then(async r=>r.ok?await r.json() as{quotes:MarketIndexQuote[];pollingInterval?:number}:null).then(data=>{if(!active)return;if(data?.quotes)setIndices(data.quotes);schedule(data?.pollingInterval??10_000);}).catch(()=>{if(active)schedule(10_000);});void load();return()=>{active=false;if(timer)clearTimeout(timer);};},[auth]);
  useEffect(()=>{if(!auth||auth==="loading"||view!=="market"||marketTab==="INDEX")return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const schedule=(delay:number)=>{if(active)timer=setTimeout(load,Math.max(1_000,Math.min(120_000,delay)));};const load=()=>{setQuoteStatus(current=>current==="live"?current:"loading");const venueParam=selected.market==="KR"?`&venue=${domesticVenue}`:"";fetch(`/api/quotes?market=${selected.market}&symbols=${encodeURIComponent(selected.symbol)}&exchange=${encodeURIComponent(selected.exchange)}${venueParam}`,{cache:"no-store"}).then(async r=>{const data=await r.json() as{quotes?:Array<{price:number;change:number;changeRate:number;currency:"KRW"|"USD";exchangeRate:number;pollingInterval?:number;venue?:string;tradingVenue?:DomesticVenue;availableVenues?:DomesticVenue[];referencePrice?:number;open?:number;high?:number;low?:number;volume?:number;tradingValue?:number;high52Week?:number;low52Week?:number}>};if(!r.ok||!data.quotes?.[0])throw new Error();const q=data.quotes[0];if(active){if(selected.market==="KR"&&q.tradingVenue&&q.tradingVenue!==domesticVenue)setDomesticVenue(q.tradingVenue);setSelected(current=>current.market===selected.market&&current.symbol===selected.symbol?{...current,exchange:q.venue??current.exchange,price:q.price,change:q.change,rate:q.changeRate,currency:q.currency,exchangeRate:q.exchangeRate,referencePrice:q.referencePrice,open:q.open,high:q.high,low:q.low,volume:q.volume,tradingValue:q.tradingValue,high52Week:q.high52Week,low52Week:q.low52Week,tradingVenue:q.tradingVenue,availableVenues:q.availableVenues}:current);setQuoteStatus("live");schedule(q.pollingInterval??5_000);}}).catch(()=>{if(active){setQuoteStatus("unavailable");schedule(10_000);}});};void load();return()=>{active=false;if(timer)clearTimeout(timer);};},[auth,selected.market,selected.symbol,selected.exchange,domesticVenue,view,marketTab]);
  useEffect(()=>{if(!auth||auth==="loading"||view!=="market"||marketTab==="INDEX"||quoteStatus!=="live"||!selected.high52Week||!selected.low52Week)return;const controller=new AbortController();const params=new URLSearchParams({market:selected.market,symbol:selected.symbol,exchange:selected.exchange,high:String(selected.high52Week),low:String(selected.low52Week)});fetch(`/api/quote-extrema-dates?${params.toString()}`,{cache:"no-store",signal:controller.signal}).then(async r=>r.ok?await r.json() as{high52WeekDate?:string;low52WeekDate?:string}:null).then(data=>{if(controller.signal.aborted)return;setSelected(current=>current.market===selected.market&&current.symbol===selected.symbol?{...current,high52WeekDate:data?.high52WeekDate??null,low52WeekDate:data?.low52WeekDate??null}:current);}).catch(()=>{if(!controller.signal.aborted)setSelected(current=>current.market===selected.market&&current.symbol===selected.symbol?{...current,high52WeekDate:null,low52WeekDate:null}:current);});return()=>controller.abort();},[auth,view,marketTab,quoteStatus,selected.market,selected.symbol,selected.exchange,selected.high52Week,selected.low52Week]);
  useEffect(()=>{if(!auth||auth==="loading"||!["home","market","news"].includes(view)||(view==="market"&&marketTab==="INDEX"))return;const key=`${selected.market}:${selected.symbol}`;const cached=clientNewsCache.get(key);if(cached&&cached.expiresAt>Date.now()){setNewsItems(cached.items);setNewsLoading(false);return;}const controller=new AbortController();setNewsLoading(true);const params=new URLSearchParams({market:selected.market,name:selected.name,symbol:selected.symbol,exchange:selected.exchange});fetch(`/api/news?${params.toString()}`,{signal:controller.signal}).then(async r=>r.ok?await r.json() as{items:NewsItem[]}:null).then(data=>{const items=(data?.items??[]).sort((a,b)=>b.publishedAt-a.publishedAt);clientNewsCache.set(key,{items,expiresAt:Date.now()+90_000});setNewsItems(items);}).catch(()=>setNewsItems([])).finally(()=>{if(!controller.signal.aborted)setNewsLoading(false);});return()=>controller.abort();},[auth,selected.market,selected.symbol,selected.name,selected.exchange,view,marketTab]);
  useEffect(()=>{if(!auth||auth==="loading"||view!=="market"||marketTab==="INDEX")return;let active=true;const load=()=>{const venueParam=market==="KR"?`&venue=${domesticVenue}`:"";return fetch(`/api/market-status?market=${market}&live=1${venueParam}`,{cache:"no-store"}).then(async r=>r.ok?await r.json() as MarketSession:null).then(value=>{if(active&&value)setMarketSession(value);}).catch(()=>undefined);};void load();const timer=setInterval(load,15_000);return()=>{active=false;clearInterval(timer);};},[auth,market,domesticVenue,view,marketTab]);
  useEffect(()=>{if(!auth||auth==="loading"||view!=="market"||marketTab!=="INDEX")return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const schedule=(delay:number)=>{if(active)timer=setTimeout(load,Math.max(2_000,Math.min(120_000,delay)));};const load=()=>{setIndexStatus(current=>current==="live"?current:"loading");fetch(`/api/index-detail?id=${encodeURIComponent(selectedIndexId)}`,{cache:"no-store"}).then(async r=>{const data=await r.json() as{quote?:MarketIndexDetail};if(!r.ok||!data.quote)throw new Error();if(active){setIndexDetail(data.quote);setIndexStatus("live");schedule(data.quote.pollingInterval??10_000);}}).catch(()=>{if(active){setIndexStatus("unavailable");schedule(10_000);}});};void load();return()=>{active=false;if(timer)clearTimeout(timer);};},[auth,view,marketTab,selectedIndexId]);
  const persistLastViewed=(nextMarket:Market,instruments:Partial<Record<Market,Instrument>>)=>{if(!auth||auth==="loading")return;try{window.localStorage.setItem(`marketmate:last-viewed:${auth.id}`,JSON.stringify({lastMarket:nextMarket,instruments}));}catch{}};
  const quoteFromInstrument=(instrument:Instrument):Quote=>({...instrument,price:0,change:0,rate:0,exchangeRate:1});
  const rememberInstrument=(instrument:Instrument)=>{const normalized:Instrument={market:instrument.market,symbol:instrument.symbol,name:instrument.name,exchange:instrument.exchange,currency:instrument.currency};setLastViewedMarket(normalized.market);setLastViewed(current=>{const next={...current,[normalized.market]:normalized};persistLastViewed(normalized.market,next);return next;});};
  const restoreRemembered=(next:Market)=>{const remembered=lastViewed[next];if(!remembered?.symbol||!remembered.name)return false;setSelected(quoteFromInstrument(remembered));return true;};
  const openMarketView=()=>{const next=lastViewed[lastViewedMarket]?.symbol?lastViewedMarket:selected.market;if(next!==market)setMarketSession(LOADING_MARKET_SESSION);setMarket(next);setMarketTab(next);restoreRemembered(next);setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const chooseInstrument=(instrument:Instrument)=>{if(instrument.market!==market)setMarketSession(LOADING_MARKET_SESSION);rememberInstrument(instrument);setMarket(instrument.market);setMarketTab(instrument.market);setSelected(quoteFromInstrument(instrument));setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  useEffect(()=>{const onOpenInstrument=(event:Event)=>{const detail=(event as CustomEvent<Instrument>).detail;if(!detail||!["KR","US","CRYPTO"].includes(detail.market)||!detail.symbol||!detail.name||!detail.exchange||!["KRW","USD"].includes(detail.currency))return;const normalized:Instrument={market:detail.market,symbol:detail.symbol,name:detail.name,exchange:detail.exchange,currency:detail.currency};if(normalized.market!==market)setMarketSession(LOADING_MARKET_SESSION);setLastViewedMarket(normalized.market);setLastViewed(current=>{const next={...current,[normalized.market]:normalized};if(auth&&auth!=="loading"){try{window.localStorage.setItem(`marketmate:last-viewed:${auth.id}`,JSON.stringify({lastMarket:normalized.market,instruments:next}));}catch{}}return next;});setMarket(normalized.market);setMarketTab(normalized.market);setSelected({...normalized,price:0,change:0,rate:0,exchangeRate:1});setView("market");window.scrollTo({top:0,behavior:"smooth"});};window.addEventListener("marketmate:open-instrument",onOpenInstrument);return()=>window.removeEventListener("marketmate:open-instrument",onOpenInstrument);},[auth,market]);
  const changeMarket=(next:Market)=>{if(next!==market)setMarketSession(LOADING_MARKET_SESSION);setMarket(next);setMarketTab(next);if(!restoreRemembered(next)&&selected.market!==next)setSelected(DEFAULTS[next]);setLastViewedMarket(next);setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const openIndexView=(id:MarketIndexId)=>{setSelectedIndexId(id);setIndexDetail(current=>current?.id===id?current:null);setIndexStatus("loading");setMarketTab("INDEX");setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const openBitcoinView=()=>{if(market!=="CRYPTO")setMarketSession(LOADING_MARKET_SESSION);setQuoteStatus("loading");setMarket("CRYPTO");setMarketTab("CRYPTO");setSelected(DEFAULTS.CRYPTO);setView("market");window.scrollTo({top:0,behavior:"smooth"});};
  const pickMarketOverviewById=(id:string,nextMarket:Market)=>{if(id==="BTC"){openBitcoinView();return;}if(isMarketIndexId(id)){openIndexView(id);return;}changeMarket(nextMarket);};
  const pickMarketOverview=(item:MarketIndexQuote)=>pickMarketOverviewById(item.id,item.market);
  const changeDomesticVenue=(venue:DomesticVenue)=>{if(venue===domesticVenue)return;if(venue==="NXT"&&selected.availableVenues&&!selected.availableVenues.includes("NXT"))return;setMarketSession(LOADING_MARKET_SESSION);setQuoteStatus("loading");setDomesticVenue(venue);};
  const logout=async()=>{await fetch("/api/auth/logout",{method:"POST"});setAuth(null);};
  const selectedInWatchlist=watchlist.some(item=>item.market===selected.market&&item.symbol===selected.symbol);
  const toggleWatchlist=async()=>{const instrumentId=`${selected.market}:${selected.symbol}`;const response=await fetch(selectedInWatchlist?`/api/watchlist?instrumentId=${encodeURIComponent(instrumentId)}`:"/api/watchlist",{method:selectedInWatchlist?"DELETE":"POST",headers:{"content-type":"application/json"},body:selectedInWatchlist?undefined:JSON.stringify({market:selected.market,symbol:selected.symbol,name:selected.name,exchange:selected.exchange,currency:selected.currency})});if(response.ok)loadWatchlist();};
  const leaveCompetition=async()=>{if(!activeCompetition||!window.confirm(`${activeCompetition.name} 대회에서 나갈까요? 내 모의투자 기록이 삭제됩니다.`))return;const response=await fetch(`/api/competitions/leave?competitionId=${encodeURIComponent(activeCompetition.id)}`,{method:"DELETE"});const result=await response.json() as{error?:string};if(!response.ok)return window.alert(result.error??"대회에서 나가지 못했습니다.");loadCompetitions();setPortfolio(null);setLeaderboard([]);};
  const handleFilled=()=>{loadAccount();setRevision(value=>value+1);};const assets=portfolio?.account.totalAssetKrw??myRank?.totalAssetKrw??0;const initial=activeCompetition?.initialCashKrw??0;const rate=returnRate(assets,initial);const unrealizedPnl=portfolio?.positions.reduce((sum,p)=>sum+Number(p.unrealizedPnlKrw??0),0)??0;const selectedHolding=portfolio?.positions.find(p=>p.market===selected.market&&p.symbol===selected.symbol)?.quantityMicros??0;
  const sortedPositions=[...(portfolio?.positions??[])].sort((a,b)=>{const direction=positionSortDirection==="asc"?1:-1;if(positionSortKey==="name"){const result=a.name.localeCompare(b.name,"ko-KR",{numeric:true,sensitivity:"base"});return result*direction;}const read=(position:Portfolio["positions"][number])=>{if(positionSortKey==="quantity")return position.quantityMicros;if(positionSortKey==="averagePrice")return position.averagePriceKrwMicros;if(positionSortKey==="marketValue")return Number(position.marketValueKrw??0);if(positionSortKey==="unrealizedPnl")return Number(position.unrealizedPnlKrw??0);return positionReturnRate(position);};const diff=read(a)-read(b);if(diff!==0)return diff*direction;return a.name.localeCompare(b.name,"ko-KR",{numeric:true,sensitivity:"base"});});
  if(auth==="loading")return <main className="auth-shell"><div className="auth-loading">마켓메이트를 여는 중...</div></main>;if(!auth)return <AuthScreen onAuthenticated={setAuth}/>;
  const nav:(readonly[AppView,string])[]=[["home","홈"],["market","시세"],["watchlist","관심"],["competition","모의투자대회"],["news","뉴스"],["portfolio","MY"]];
  const mobileNavItems = [["home",Home,"홈"],["watchlist",Star,"관심"],["market",LineChart,"시세"],["competition",Trophy,"대회"],["news",Newspaper,"뉴스"],["portfolio",WalletCards,"MY"]] as const;
  const holdings=<section className="np-panel holdings"><div className="np-section-title"><h2>내 투자현황</h2><div className="flex items-center gap-2"><select aria-label="보유종목 정렬 기준" value={positionSortKey} onChange={event=>setPositionSortKey(event.target.value as PositionSortKey)} className="h-8 rounded-md border border-[#dfe3e6] bg-white px-2 text-xs text-[#59636c]"><option value="name">종목 이름</option><option value="quantity">보유수량</option><option value="averagePrice">평균단가</option><option value="marketValue">평가금액</option><option value="unrealizedPnl">평가손익</option><option value="returnRate">수익률</option></select><button type="button" onClick={()=>setPositionSortDirection(value=>value==="asc"?"desc":"asc")} className="h-8 rounded-md border border-[#dfe3e6] bg-white px-2 text-xs text-[#59636c]">{positionSortDirection==="asc"?"오름차순 ↑":"내림차순 ↓"}</button><button onClick={loadAccount}><RefreshCw/> 새로고침</button></div></div><div className="asset-summary"><span>총 자산<strong>{formatKrw(assets)}</strong></span><span>주문 가능 현금<strong>{formatKrw(portfolio?.account.availableCashKrw??0)}</strong></span><span>평가손익<strong className={unrealizedPnl>=0?"up":"down"}>{formatKrw(unrealizedPnl)}</strong></span><span>실현손익<strong className={(portfolio?.account.realizedPnlKrw??0)>=0?"up":"down"}>{formatKrw(portfolio?.account.realizedPnlKrw??0)}</strong></span><span>수익률<strong className={rate>=0?"up":"down"}>{rate>=0?"+":""}{rate.toFixed(2)}%</strong></span></div><div className="desktop-position-table"><Table><TableHeader><TableRow><TableHead>종목</TableHead><TableHead>보유</TableHead><TableHead>평균단가</TableHead><TableHead>평가금액</TableHead><TableHead>평가손익</TableHead><TableHead>수익률</TableHead></TableRow></TableHeader><TableBody>{sortedPositions.length?sortedPositions.map(p=>{const instrument:Instrument={market:p.market,symbol:p.symbol,name:p.name,exchange:p.exchange||(p.market==="KR"?"KRX":p.market==="US"?"NAS":"NAVER"),currency:p.currency as"KRW"|"USD"};return <TableRow key={`${p.market}:${p.symbol}`} onClick={()=>chooseInstrument(instrument)}><TableCell><span className="stock-cell"><InstrumentLogo instrument={instrument} size="sm"/><span>{p.name}<small>{displaySymbol(p.market,p.symbol)} · {instrument.exchange}</small></span></span></TableCell><TableCell>{formatQuantity(p.quantityMicros)}</TableCell><TableCell>{formatKrw(p.averagePriceKrwMicros/1_000_000)}</TableCell><TableCell>{p.currentPriceKrwMicros?formatKrw(p.marketValueKrw??0):"시세 대기"}</TableCell><TableCell className={(p.unrealizedPnlKrw??0)>=0?"up":"down"}>{p.currentPriceKrwMicros?formatKrw(p.unrealizedPnlKrw??0):"-"}</TableCell><TableCell className={positionReturnRate(p)>=0?"up":"down"}>{p.currentPriceKrwMicros?formatReturnRate(positionReturnRate(p)):"-"}</TableCell></TableRow>}):<TableRow><TableCell colSpan={6} className="empty-cell">{participantId?"아직 보유한 종목이 없습니다.":"대회에 참가하면 투자현황이 표시됩니다."}</TableCell></TableRow>}</TableBody></Table></div><div className="mobile-position-list">{sortedPositions.length?sortedPositions.map(p=>{const instrument:Instrument={market:p.market,symbol:p.symbol,name:p.name,exchange:p.exchange||(p.market==="KR"?"KRX":p.market==="US"?"NAS":"NAVER"),currency:p.currency as"KRW"|"USD"};return <button key={`mobile:${p.market}:${p.symbol}`} onClick={()=>chooseInstrument(instrument)}><span className="stock-cell"><InstrumentLogo instrument={instrument} size="sm"/><span><b>{p.name}</b><small>{displaySymbol(p.market,p.symbol)} · {instrument.exchange} · {formatQuantity(p.quantityMicros)}{p.market==="CRYPTO"?"개":"주"}</small></span></span><span><strong>{p.currentPriceKrwMicros?formatKrw(p.marketValueKrw??0):"시세 대기"}</strong><em className={(p.unrealizedPnlKrw??0)>=0?"up":"down"}>{p.currentPriceKrwMicros?`${formatKrw(p.unrealizedPnlKrw??0)} · ${formatReturnRate(positionReturnRate(p))}`:"-"}</em></span></button>}):<p className="np-empty">{participantId?"아직 보유한 종목이 없습니다.":"대회에 참가하면 투자현황이 표시됩니다."}</p>}</div></section>;
  return <div className="marketmate-v2"><header className="np-desktop-header"><div className="np-head"><button className="np-brand" onClick={()=>setView("home")}><span>MM</span><b>마켓메이트</b></button><SearchBox onSelect={chooseInstrument}/><div className="np-head-actions">{auth.role==="admin"&&<AdminDialog/>}<JoinDialog onChanged={loadCompetitions}/><span>{auth.nickname}</span><button aria-label="로그아웃" onClick={logout}><LogOut/></button></div></div><nav>{nav.map(([key,label])=><button key={key} className={view===key?"active":""} onClick={()=>key==="market"?openMarketView():setView(key)}>{label}</button>)}</nav><LiveMarketStrip quotes={indices} onPick={pickMarketOverviewById}/></header><header className="np-mobile-header"><div><button className="np-brand" onClick={()=>setView("home")}><span>MM</span><b>마켓메이트</b></button><button aria-label="로그아웃" onClick={logout}><LogOut/></button></div>{view==="market"&&<SearchBox onSelect={chooseInstrument}/>}</header>
    {view==="home"&&<main className="np-page np-home"><section className="np-home-main"><div className="np-market-status"><span><i/>국내 · 네이버증권 market-status</span><span><i/>미국 · 네이버증권 세션·서머타임</span><span><i/>가상자산 · 네이버증권 24시간 시세</span></div><PopularStocksPanel domestic={popularStocks.domestic} us={popularStocks.us} onSelect={chooseInstrument}/><LiveMarketStrip quotes={indices} onPick={pickMarketOverviewById}/><section className="np-panel np-market-focus"><div className="np-section-title"><h2>주요 지수·가상자산</h2><button onClick={openMarketView}>시세 보기 <ChevronRight/></button></div><div className="index-board">{indices.map(item=><button key={item.id} onClick={()=>pickMarketOverview(item)}><span>{item.name}<small>네이버증권 · 실시간</small></span><strong>{item.price.toLocaleString("ko-KR",{maximumFractionDigits:item.id==="BTC"?0:2})}{item.unit}</strong><em className={item.rate>=0?"up":"down"}>{item.change>=0?"+":""}{item.change.toLocaleString("ko-KR",{maximumFractionDigits:2})} ({item.rate>=0?"+":""}{item.rate.toFixed(2)}%)</em></button>)}</div></section><NewsPanel items={newsItems} title="주요 시장 뉴스" loading={newsLoading}/></section><aside><section className="np-panel np-my-summary"><div className="np-section-title"><h2>내 대회</h2><button onClick={()=>setView("competition")}>전체 <ChevronRight/></button></div><div className="contest-summary"><span>{activeCompetition?.name??"참가 중인 대회 없음"}{activeCompetition&&<b>{dDay(activeCompetition.endsAt)}</b>}</span><strong>{myRank?`${myRank.rank}위 / ${leaderboard.length}명`:"대회에 참가해보세요"}</strong><em className={rate>=0?"up":"down"}>{rate>=0?"+":""}{rate.toFixed(2)}%</em></div></section><section className="np-panel np-watch-preview"><div className="np-section-title"><h2>관심 종목</h2><button onClick={()=>setView("watchlist")}>전체 <ChevronRight/></button></div>{watchlist.slice(0,6).map(item=><button key={item.id} onClick={()=>chooseInstrument(item)}><InstrumentLogo instrument={item} size="sm"/><span><b>{item.name}</b><small>{displaySymbol(item.market,item.symbol)}</small></span><strong>{formatWatchPrice(item)}<em className={(item.changeRatePpm??0)>=0?"up":"down"}>{((item.changeRatePpm??0)/10_000).toFixed(2)}%</em></strong></button>)}{!watchlist.length&&<p className="np-empty">관심 종목을 추가해보세요.</p>}</section></aside></main>}
    {view==="market"&&<main className={`np-page np-trading${marketTab==="INDEX"?" index-mode":""}`}><section className="np-trading-main"><div className="np-market-tabs">{([["INDEX","지수"],["KR","국내"],["US","미국"],["CRYPTO","가상자산"]] as const).map(([key,label])=><button className={marketTab===key?"active":""} onClick={()=>key==="INDEX"?openIndexView(selectedIndexId):changeMarket(key)} key={key}>{label}</button>)}</div>
      {marketTab==="INDEX"?<><div className="np-index-selector">{MARKET_INDEX_IDS.map(id=><button key={id} className={selectedIndexId===id?"active":""} onClick={()=>openIndexView(id)}>{MARKET_INDEX_META[id].name}</button>)}</div>{(()=>{const overview=indices.find(item=>item.id===selectedIndexId);const current=indexDetail?.id===selectedIndexId?indexDetail:overview;const meta=MARKET_INDEX_META[selectedIndexId];const detail=indexDetail?.id===selectedIndexId?indexDetail:null;const chartQuote={market:meta.market,symbol:meta.symbol,name:meta.name,exchange:meta.exchange};return <section className="np-panel np-quote np-index-quote"><div className="np-quote-head"><span className="stock-title"><span><small>{selectedIndexId==="USDKRW"?"환율":meta.exchange} · 네이버증권</small><h1>{meta.name}</h1></span></span><span className={`live-pill${indexStatus==="unavailable"?" pending":""}`}><i/>{indexStatus==="live"?"네이버 실시간":indexStatus==="loading"?"확인 중":"시세 지연"}</span></div><div className="np-price"><div className="np-price-main"><strong>{current?formatMarketIndexValue(current,current.price):"시세 확인 중"}</strong>{current&&current.price>0&&<span className={current.rate>=0?"up":"down"}>{current.change>=0?"▲":"▼"} {Math.abs(current.change).toLocaleString("ko-KR",{maximumFractionDigits:2})} ({current.rate>=0?"+":""}{current.rate.toFixed(2)}%)</span>}</div></div>{selectedIndexId!=="USDKRW"&&<div className="np-stats"><span>기준가<b>{current?formatMarketIndexValue(current,detail?.referencePrice):"-"}</b></span><span>시가<b className={quoteMetricDirectionClass(detail?.open,detail?.referencePrice)}>{current?formatMarketIndexValue(current,detail?.open):"-"}</b></span><span>고가<b className="up">{current?formatMarketIndexValue(current,detail?.high):"-"}</b></span><span>저가<b className="down">{current?formatMarketIndexValue(current,detail?.low):"-"}</b></span><span className="np-stat-dated"><span className="np-stat-label">52주 최고<small>{detail?.high52WeekDate===undefined?"확인 중":formatQuoteMetricDate(detail.high52WeekDate)||"-"}</small></span><b className="up">{current?formatMarketIndexValue(current,detail?.high52Week):"-"}</b></span><span className="np-stat-dated"><span className="np-stat-label">52주 최저<small>{detail?.low52WeekDate===undefined?"확인 중":formatQuoteMetricDate(detail.low52WeekDate)||"-"}</small></span><b className="down">{current?formatMarketIndexValue(current,detail?.low52Week):"-"}</b></span><span>거래량<b>{formatQuoteVolume(detail?.volume)}</b></span><span>거래대금<b>{formatMarketIndexTradingValue(detail?.tradingValue)}</b></span></div>}<div className="np-chart"><MarketChart quote={chartQuote} indexId={selectedIndexId} fxChartImages={detail?.chartImages}/></div></section>;})()}</>:<><section className="np-panel np-quote"><div className="np-quote-head"><span className="stock-title"><InstrumentLogo key={`${selected.market}:${selected.symbol}`} instrument={selected} size="lg"/><span><small>{displaySymbol(selected.market,selected.symbol)} · {selected.exchange}</small><h1>{selected.name}<button className={selectedInWatchlist?"starred":""} onClick={toggleWatchlist} aria-label="관심종목"><Star fill={selectedInWatchlist?"currentColor":"none"}/></button></h1></span></span><span className="live-pill"><i/>{quoteStatus==="live"?"네이버 실시간":quoteStatus==="loading"?"확인 중":"시세 지연"}</span></div><div className={`np-price${selected.market==="KR"?" np-price-domestic":""}`}><div className="np-price-main"><strong>{formatPrice(selected)}</strong>{selected.price>0&&<span className={selected.rate>=0?"up":"down"}>{selected.change>=0?"▲":"▼"} {Math.abs(selected.change).toLocaleString()} ({selected.rate>=0?"+":""}{selected.rate.toFixed(2)}%)</span>}</div>{selected.market==="KR"&&<div className="np-domestic-venue-switch"><div><button type="button" className={domesticVenue==="KRX"?"active":""} onClick={()=>changeDomesticVenue("KRX")}>KRX</button><button type="button" className={domesticVenue==="NXT"?"active":""} disabled={Boolean(selected.availableVenues)&&!selected.availableVenues?.includes("NXT")} onClick={()=>changeDomesticVenue("NXT")}>NXT</button></div></div>}</div><div className="np-stats"><span>기준가<b>{formatQuoteMetricPrice(selected,selected.referencePrice)}</b></span><span>시가<b className={quoteMetricDirectionClass(selected.open,selected.referencePrice)}>{formatQuoteMetricPrice(selected,selected.open)}</b></span><span>고가<b className="up">{formatQuoteMetricPrice(selected,selected.high)}</b></span><span>저가<b className="down">{formatQuoteMetricPrice(selected,selected.low)}</b></span><span className="np-stat-dated"><span className="np-stat-label">52주 최고<small>{selected.high52WeekDate===undefined?"확인 중":formatQuoteMetricDate(selected.high52WeekDate)||"-"}</small></span><b className="up">{formatQuoteMetricPrice(selected,selected.high52Week)}</b></span><span className="np-stat-dated"><span className="np-stat-label">52주 최저<small>{selected.low52WeekDate===undefined?"확인 중":formatQuoteMetricDate(selected.low52WeekDate)||"-"}</small></span><b className="down">{formatQuoteMetricPrice(selected,selected.low52Week)}</b></span><span>거래량<b>{formatQuoteVolume(selected.volume)}</b></span><span>거래대금<b>{formatQuoteTradingValue(selected)}</b></span></div><div className="np-chart"><MarketChart quote={selected}/></div></section><div className="np-mobile-order"><OrderPanel quote={selected} participantId={participantId} availableCashKrw={portfolio?.account.availableCashKrw??0} heldQuantityMicros={selectedHolding} session={marketSession} domesticVenue={domesticVenue} onDomesticVenueChange={changeDomesticVenue} onFilled={handleFilled}/></div><NewsPanel items={newsItems} title={`${selected.name} 관련 뉴스`} loading={newsLoading}/></>}</section>{marketTab!=="INDEX"&&<aside><OrderPanel quote={selected} participantId={participantId} availableCashKrw={portfolio?.account.availableCashKrw??0} heldQuantityMicros={selectedHolding} session={marketSession} domesticVenue={domesticVenue} onDomesticVenueChange={changeDomesticVenue} onFilled={handleFilled}/></aside>}</main>}
    {view==="watchlist"&&<main className="np-page np-single"><section className="np-panel np-watch-page"><div className="np-section-title"><h1>관심 종목</h1><span>{watchlist.length}개</span></div><div className="watch-table-head"><span>종목</span><span>현재가</span><span>등락률</span><span>시장</span></div>{watchlist.length?watchlist.map(item=><button key={item.id} onClick={()=>chooseInstrument(item)}><span className="stock-cell"><InstrumentLogo instrument={item}/><span><b>{item.name}</b><small>{displaySymbol(item.market,item.symbol)} · {item.exchange}</small></span></span><strong>{formatWatchPrice(item)}</strong><em className={(item.changeRatePpm??0)>=0?"up":"down"}>{((item.changeRatePpm??0)/10_000).toFixed(2)}%</em><span>{item.market==="KR"?"국내":item.market==="US"?"미국":"코인"}</span><ChevronRight/></button>):<p className="np-empty large">시세 화면에서 별을 눌러 관심 종목을 추가하세요.</p>}</section></main>}
    {view==="competition"&&<main className="np-page np-competition"><section className="competition-main"><section className="np-panel contest-overview"><div><span>참가 중인 대회</span><h1>{activeCompetition?.name??"아직 참가한 대회가 없습니다"}</h1>{activeCompetition&&<p>종료일 {formatEndDate(activeCompetition.endsAt)} · <b>{dDay(activeCompetition.endsAt)}</b></p>}</div><div className="contest-actions">{activeCompetition&&<button className="leave-button" onClick={leaveCompetition}><DoorOpen/>대회 나가기</button>}<JoinDialog onChanged={loadCompetitions}/></div>{competitions.length>1&&<select value={activeCompetition?.id} onChange={event=>setCompetitionId(event.target.value)}>{competitions.map(item=><option value={item.id} key={item.id}>{item.name} · {dDay(item.endsAt)}</option>)}</select>}</section><RankingPanel rows={leaderboard} participantId={participantId} onSelect={setSelectedParticipant}/><TopPicksPanel rows={topPicks} onSelect={chooseInstrument}/></section><aside><section className="np-panel competition-guide"><div className="np-section-title"><h2>참가 방법</h2></div><ol><li><b>닉네임으로 로그인</b><span>처음 이용에서 닉네임과 숫자 PIN을 만듭니다.</span></li><li><b>초대코드 입력</b><span>대회 참가 버튼에서 친구에게 받은 코드를 입력합니다.</span></li><li><b>종목 검색 후 모의주문</b><span>시세 탭에서 시장가 또는 지정가로 주문합니다.</span></li><li><b>순위 확인</b><span>총자산 기준 순위와 참가자 거래내역을 확인합니다.</span></li></ol></section><section className="np-panel trading-guide"><div className="np-section-title"><h2>거래시간·유의사항</h2></div><DomesticTradingSchedule/><UsTradingSchedule/><CryptoTradingSchedule/><ul><li>초록색 불이 켜진 행이 현재 한국시간에 해당하는 거래 구간입니다.</li><li>미국주식 시간표는 미국 서머타임/표준시를 자동 판별해 한국시간으로 표시합니다.</li><li>모든 주문은 모의체결이며 실제 계좌로 전송되지 않습니다.</li><li>주식 주문 가능 여부는 거래시간표와 네이버증권 휴장 상태를 함께 확인합니다.</li><li>환율과 시세 지연에 따라 체결금액이 달라질 수 있습니다.</li><li>지정가는 조건 충족 시에만 체결되며 미체결 주문으로 남을 수 있습니다.</li><li>대회 종료 후에는 신규 주문이 제한됩니다.</li><li>대회에서 나가면 해당 대회의 투자 기록이 삭제됩니다.</li></ul></section></aside></main>}
    {view==="portfolio"&&<main className="np-page np-single np-portfolio-page">{holdings}<section className="np-panel trade-history"><div className="np-section-title"><h2>내 체결내역</h2><span>{portfolio?.fills.length??0}건</span></div>{portfolio?.fills.length?portfolio.fills.slice(0,50).map(fill=><div className="trade-row" key={fill.id}><span><b>{fill.name}</b><small>{fill.market} · {displaySymbol(fill.market,fill.symbol)}{fill.market==="KR"&&fill.venue?` · ${fill.venue}`:""} · {formatDateTime(fill.executedAt)}</small></span><span><b className={fill.side==="buy"?"up":"down"}>{fill.side==="buy"?"매수":"매도"} {formatQuantity(fill.quantityMicros)}{fill.market==="CRYPTO"?"개":"주"}</b><small className={fill.returnRate == null ? "" : fill.returnRate >= 0 ? "up" : "down"}>{formatKrw(fillValueKrw(fill))} · {fill.returnRateKind === "realized" ? "실현" : "현재"} {formatReturnRate(fill.returnRate)}</small></span></div>):<p className="np-empty large">아직 체결된 모의주문이 없습니다.</p>}</section></main>}
    {view==="news"&&<main className="np-page np-single"><NewsPanel items={newsItems} title={`${selected.name} 및 주요 시장 뉴스`} loading={newsLoading}/></main>}
    <ParticipantActivityDialog row={selectedParticipant} onClose={()=>setSelectedParticipant(null)}/>{auth.role==="admin"&&<div className="np-mobile-admin"><AdminDialog/></div>}<nav className="np-mobile-bottom">{mobileNavItems.map(([key,Icon,label])=>{const I=Icon as typeof Home;return <button key={key} className={view===key?"active":""} onClick={()=>key==="market"?openMarketView():setView(key as AppView)}><I/><span>{label}</span></button>})}</nav></div>;
}
