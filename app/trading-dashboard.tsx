"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { OTPInputContext } from "input-otp";
import { Bell, Home, LineChart, LogOut, Menu, Search, Settings, Star, Trophy, UserRound, X } from "lucide-react";
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
type User = { id: string; nickname: string };
type Instrument = { market: Market; symbol: string; name: string; exchange: string; currency: "KRW" | "USD" };
type Quote = Instrument & { price: number; change: number; rate: number; exchangeRate: number; volume?: string };
type Competition = {
  id: string; name: string; inviteCode: string; status: string; initialCashKrw: number;
  startsAt: number; endsAt: number; participantId: string; cashKrw: number;
};
type LeaderboardRow = {
  rank: number; participantId: string; nickname: string; cashKrw: number; realizedPnlKrw: number;
  initialCashKrw: number; totalAssetKrw: number; unrealizedPnlKrw: number;
  fillCount: number; tradedInstrumentCount: number; recentSymbols?: string;
};
type Portfolio = {
  account: { cashKrw: number; realizedPnlKrw: number; marketValueKrw: number; totalAssetKrw: number };
  positions: Array<{
    market: Market; symbol: string; name: string; currency: string; quantityMicros: number;
    averagePriceKrwMicros: number; realizedPnlKrw: number; currentPriceKrwMicros?: number;
    marketValueKrw?: number; unrealizedPnlKrw?: number;
  }>;
  fills: Fill[];
};
type Fill = {
  id: string; side: "buy" | "sell"; quantityMicros: number; priceMicros: number; fxRateMicros: number;
  executedAt: number; market: Market; symbol: string; name: string; currency: string;
};
type ParticipantActivity = {
  participant: { id: string; nickname: string };
  positions: Portfolio["positions"];
  fills: Fill[];
};

const DEFAULTS: Record<Market, Quote> = {
  KR: { market: "KR", symbol: "005930", name: "삼성전자", exchange: "KOSPI", currency: "KRW", price: 0, change: 0, rate: 0, exchangeRate: 1 },
  US: { market: "US", symbol: "AAPL", name: "애플", exchange: "NAS", currency: "USD", price: 0, change: 0, rate: 0, exchangeRate: 1 },
  CRYPTO: { market: "CRYPTO", symbol: "KRW-BTC", name: "비트코인", exchange: "UPBIT", currency: "KRW", price: 0, change: 0, rate: 0, exchangeRate: 1 },
};
const chartPoints = [42, 38, 45, 43, 52, 49, 61, 58, 66, 63, 71, 75, 70, 78, 82, 77, 86, 91, 88, 96];
const news = [
  ["반도체 대형주 동반 강세…외국인 매수세 유입", "마켓데일리", "12분 전"],
  ["뉴욕증시, 금리 인하 기대에 기술주 중심 상승", "글로벌마켓", "28분 전"],
  ["비트코인, 거래대금 증가하며 변동성 확대", "코인포커스", "41분 전"],
];

function formatPrice(quote: Quote) {
  if (!quote.price) return "시세 확인 중";
  return quote.currency === "USD"
    ? `$${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    : `${quote.price.toLocaleString("ko-KR")}원`;
}

function formatKrw(value: number) {
  return `₩${Math.round(value || 0).toLocaleString("ko-KR")}`;
}

function returnRate(total: number, initial: number) {
  return initial > 0 ? ((total - initial) / initial) * 100 : 0;
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
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="국내·미국주식·코인 전 종목 검색" aria-label="종목 검색" />
      {query && <button aria-label="검색어 지우기" onClick={() => setQuery("")}><X /></button>}
      {query && (
        <div className="search-results">
          {loading ? <p>종목을 찾는 중...</p> : results.length ? results.map(item => (
            <button key={`${item.market}:${item.symbol}`} onClick={() => choose(item)}>
              <span><strong>{item.name}</strong><small>{item.symbol} · {item.exchange}</small></span>
              <b>{item.market === "KR" ? "국내" : item.market === "US" ? "미국" : "코인"}</b>
            </button>
          )) : <p>일치하는 종목이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

function MiniChart({ positive }: { positive: boolean }) {
  const points = chartPoints.map((value, index) => `${index / (chartPoints.length - 1) * 100},${100 - value}`).join(" ");
  return (
    <svg viewBox="0 0 100 65" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="가격 추이">
      <polyline points={points} fill="none" stroke={positive ? "#e8344e" : "#2878d8"} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function JoinDialog({ onChanged }: { onChanged: () => void }) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [code, setCode] = useState("");
  const [name, setName] = useState("친구 투자대회");
  const [cash, setCash] = useState("100000000");
  const [days, setDays] = useState("30");
  const [status, setStatus] = useState("");
  const submit = async () => {
    setStatus("처리 중...");
    const now = Date.now();
    const payload = mode === "join" ? { inviteCode: code } : {
      name, initialCashKrw: Number(cash), startsAt: now - 1_000, endsAt: now + Number(days) * 86_400_000,
    };
    const response = await fetch(mode === "join" ? "/api/competitions/join" : "/api/competitions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
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
            <label className="field-label">진행 기간<Input value={days} onChange={event => setDays(event.target.value.replace(/\D/g, ""))} className="mt-2" inputMode="numeric" /><small>일</small></label>
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
      <TabsContent value="positions" className="activity-list">{activity?.positions.length ? activity.positions.map(position => <div key={`${position.market}:${position.symbol}`}><span><b>{position.name}</b><small>{position.market} · {position.symbol}</small></span><span><b>{formatQuantity(position.quantityMicros)}</b><small className={(position.unrealizedPnlKrw ?? 0) >= 0 ? "up" : "down"}>{formatKrw(position.unrealizedPnlKrw ?? 0)}</small></span></div>) : <p>현재 보유종목이 없습니다.</p>}</TabsContent>
      <TabsContent value="fills" className="activity-list">{activity?.fills.length ? activity.fills.map(fill => <div key={fill.id}><span><b>{fill.name}</b><small>{formatDateTime(fill.executedAt)} · {formatQuantity(fill.quantityMicros)}{fill.market === "CRYPTO" ? "개" : "주"}</small></span><span><b className={fill.side === "buy" ? "up" : "down"}>{fill.side === "buy" ? "매수" : "매도"}</b><small>{formatKrw(fillValueKrw(fill))}</small></span></div>) : <p>아직 체결내역이 없습니다.</p>}</TabsContent>
    </Tabs>}
  </DialogContent></Dialog>;
}

function OrderPanel({ quote, participantId, onFilled }: { quote: Quote; participantId: string | null; onFilled: () => void }) {
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState("");
  const estimatedKrw = quote.price * quote.exchangeRate * Number(quantity || 0);
  const changeQuantity = (value: string) => {
    if (quote.market !== "CRYPTO") return setQuantity(value.replace(/\D/g, ""));
    const normalized = value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    const [whole, decimal = ""] = normalized.split(".");
    setQuantity(normalized.includes(".") ? `${whole}.${decimal.slice(0, 6)}` : whole);
  };
  const submit = async (side: "buy" | "sell") => {
    if (!participantId) return setStatus("먼저 대회를 만들거나 참가해주세요.");
    if (!quote.price) return setStatus("실시간 시세를 확인한 뒤 주문해주세요.");
    setStatus("실시간 시세를 다시 확인하고 있습니다...");
    const response = await fetch("/api/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, clientOrderId: crypto.randomUUID(), market: quote.market, symbol: quote.symbol, name: quote.name, exchange: quote.exchange, side, orderType: "market", quantity: Number(quantity) }),
    });
    const result = await response.json() as { error?: string };
    setStatus(response.ok ? "모의주문이 현재 시세로 체결되었습니다." : result.error ?? "주문을 처리하지 못했습니다.");
    if (response.ok) onFilled();
  };
  return (
    <section className="panel order-panel"><Tabs defaultValue="buy"><TabsList variant="line" className="order-tabs"><TabsTrigger value="buy" className="buy-tab">매수</TabsTrigger><TabsTrigger value="sell" className="sell-tab">매도</TabsTrigger></TabsList>
      {(["buy", "sell"] as const).map(side => <TabsContent value={side} key={side} className="order-form">
        <div className="available"><span>선택 종목</span><strong>{quote.name}</strong></div>
        <label>주문 유형<select aria-label="주문 유형"><option>시장가</option></select></label>
        <label>수량<div className="number-input"><input value={quantity} onChange={event => changeQuantity(event.target.value)} inputMode={quote.market === "CRYPTO" ? "decimal" : "numeric"} /><span>{quote.market === "CRYPTO" ? "개" : "주"}</span></div></label>
        {quote.currency === "USD" && <div className="available"><span>적용 환율</span><strong>{quote.exchangeRate > 1 ? `${quote.exchangeRate.toLocaleString("ko-KR")}원/USD` : "시세 조회 시 적용"}</strong></div>}
        <div className="order-total"><span>예상 주문금액</span><strong>{formatKrw(estimatedKrw)}</strong></div>
        <Button onClick={() => submit(side)} className={side === "buy" ? "order-buy" : "order-sell"}>{quote.name} {side === "buy" ? "매수" : "매도"}</Button>
        {status && <p className="order-status" role="status">{status}</p>}<p className="simulation-note">실제 증권 주문은 전송되지 않습니다.</p>
      </TabsContent>)}</Tabs></section>
  );
}

function MarketStrip() {
  return <div className="market-strip">{[["KOSPI", "국내"], ["KOSDAQ", "국내"], ["S&P 500", "미국"], ["NASDAQ", "미국"], ["BTC/KRW", "코인"]].map(([name, market]) => <div className="market-ticker" key={name}><span>{name}</span><strong>{market}</strong><em>실시간 시세</em></div>)}</div>;
}

export default function TradingDashboard() {
  const [auth, setAuth] = useState<"loading" | User | null>("loading");
  const [market, setMarket] = useState<Market>("KR");
  const [selected, setSelected] = useState<Quote>(DEFAULTS.KR);
  const [quoteStatus, setQuoteStatus] = useState<"loading" | "live" | "unavailable">("loading");
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<LeaderboardRow | null>(null);
  const [leaderboardRevision, setLeaderboardRevision] = useState(0);
  const activeCompetition = competitions.find(item => item.id === competitionId) ?? competitions[0] ?? null;
  const participantId = activeCompetition?.participantId ?? null;
  const myRank = leaderboard.find(row => row.participantId === participantId);

  useEffect(() => { fetch("/api/auth/me", { cache: "no-store" }).then(async response => response.ok ? (await response.json() as { user: User }).user : null).then(setAuth).catch(() => setAuth(null)); }, []);

  const loadCompetitions = useCallback(() => {
    fetch("/api/competitions", { cache: "no-store" }).then(async response => response.ok ? await response.json() as { competitions?: Competition[] } : null).then(data => {
      const items = data?.competitions ?? [];
      setCompetitions(items);
      setCompetitionId(current => current && items.some(item => item.id === current) ? current : items[0]?.id ?? null);
    }).catch(() => undefined);
  }, []);
  useEffect(() => { if (auth && auth !== "loading") loadCompetitions(); }, [auth, loadCompetitions]);

  const loadAccount = useCallback(() => {
    if (!participantId) { setPortfolio(null); return; }
    fetch(`/api/portfolio?participantId=${encodeURIComponent(participantId)}`, { cache: "no-store" }).then(async response => response.ok ? await response.json() as Portfolio : null).then(setPortfolio).catch(() => undefined);
  }, [participantId]);
  useEffect(() => {
    loadAccount();
    const timer = setInterval(loadAccount, 15_000);
    return () => clearInterval(timer);
  }, [loadAccount]);

  useEffect(() => {
    if (!activeCompetition) { setLeaderboard([]); return; }
    let active = true;
    const load = () => fetch(`/api/leaderboard?competitionId=${encodeURIComponent(activeCompetition.id)}`, { cache: "no-store" }).then(async response => response.ok ? await response.json() as { leaderboard?: LeaderboardRow[] } : null).then(data => { if (active) setLeaderboard(data?.leaderboard ?? []); }).catch(() => undefined);
    void load();
    const timer = setInterval(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [activeCompetition, leaderboardRevision]);

  useEffect(() => {
    if (!auth || auth === "loading") return;
    let active = true;
    const load = () => {
      setQuoteStatus(current => current === "live" ? current : "loading");
      fetch(`/api/quotes?market=${selected.market}&symbols=${encodeURIComponent(selected.symbol)}&exchange=${encodeURIComponent(selected.exchange)}`, { cache: "no-store" }).then(async response => {
        const data = await response.json() as { quotes?: Array<{ price: number; change: number; changeRate: number; currency: "KRW" | "USD"; exchangeRate: number }> };
        if (!response.ok || !data.quotes?.[0]) throw new Error();
        const value = data.quotes[0];
        if (active) { setSelected(current => current.market === selected.market && current.symbol === selected.symbol ? { ...current, price: value.price, change: value.change, rate: value.changeRate, currency: value.currency, exchangeRate: value.exchangeRate } : current); setQuoteStatus("live"); }
      }).catch(() => active && setQuoteStatus("unavailable"));
    };
    void load();
    const timer = setInterval(load, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [auth, selected.market, selected.symbol, selected.exchange]);

  const chooseInstrument = (instrument: Instrument) => { setMarket(instrument.market); setSelected({ ...instrument, price: 0, change: 0, rate: 0, exchangeRate: 1 }); };
  const changeMarket = (next: Market) => { setMarket(next); setSelected(DEFAULTS[next]); };
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); setAuth(null); setCompetitions([]); };
  const handleFilled = () => { loadAccount(); setLeaderboardRevision(value => value + 1); };

  const assets = portfolio?.account.totalAssetKrw ?? myRank?.totalAssetKrw ?? 0;
  const initial = activeCompetition?.initialCashKrw ?? 0;
  const rate = returnRate(assets, initial);
  const unrealizedPnl = portfolio?.positions.reduce((sum, position) => sum + Number(position.unrealizedPnlKrw ?? 0), 0) ?? 0;

  if (auth === "loading") return <main className="auth-shell"><div className="auth-loading">마켓메이트를 여는 중...</div></main>;
  if (!auth) return <AuthScreen onAuthenticated={setAuth} />;

  return (
    <div className="site-shell">
      <header className="desktop-header"><div className="header-top"><a className="brand" href="#"><span>MM</span><b>마켓메이트</b></a><SearchBox onSelect={chooseInstrument} /><div className="header-actions"><button aria-label="알림"><Bell /></button><JoinDialog onChanged={loadCompetitions} /><span className="profile-name">{auth.nickname}</span><button aria-label="로그아웃" onClick={logout}><LogOut /></button></div></div>
        <nav className="primary-nav" aria-label="주 메뉴">{["홈", "국내증시", "미국증시", "코인", "뉴스", "모의투자대회"].map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}</nav><MarketStrip /></header>
      <header className="mobile-header"><div><button aria-label="메뉴"><Menu /></button><a className="brand" href="#"><span>MM</span><b>마켓메이트</b></a><button aria-label="로그아웃" onClick={logout}><LogOut /></button></div><SearchBox onSelect={chooseInstrument} /><MarketStrip /></header>

      <main className="dashboard">
        <aside className="left-rail"><section className="panel contest-card"><div className="panel-title"><span><Trophy />{activeCompetition?.name ?? "참가 중인 대회 없음"}</span><button aria-label="대회 설정"><Settings /></button></div>
          {competitions.length > 1 && <select className="competition-select" value={activeCompetition?.id} onChange={event => setCompetitionId(event.target.value)}>{competitions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          <strong className="my-rank">{myRank ? `${myRank.rank}위` : "-"} <small>/ {leaderboard.length}명</small></strong><div className="rank-progress"><i style={{ width: leaderboard.length && myRank ? `${Math.max(8, 100 - (myRank.rank - 1) / leaderboard.length * 100)}%` : "0%" }} /></div><div className="contest-meta"><span>{activeCompetition ? `초대 ${activeCompetition.inviteCode}` : "대회를 만들어보세요"}</span><span>수익률 <b className={rate >= 0 ? "up" : "down"}>{rate >= 0 ? "+" : ""}{rate.toFixed(2)}%</b></span></div></section>
          <section className="panel watchlist"><div className="panel-title"><span><Star />빠른 종목</span><button>전 종목 검색</button></div>{Object.values(DEFAULTS).map(item => <button className="watch-row" onClick={() => chooseInstrument(item)} key={item.symbol}><span><b>{item.name}</b><small>{item.symbol}</small></span><span><strong>{item.market}</strong><em>{item.exchange}</em></span></button>)}</section></aside>

        <div className="main-column"><div className="market-selector" role="tablist" aria-label="시장 선택">{([["KR", "국내"], ["US", "미국"], ["CRYPTO", "코인"]] as const).map(([value, label]) => <button role="tab" aria-selected={market === value} className={market === value ? "active" : ""} onClick={() => changeMarket(value)} key={value}>{label}</button>)}</div>
          <div className="mobile-contest-entry"><span><Trophy /><b>{activeCompetition?.name ?? "대회에 참가하세요"}</b><small>{myRank ? `현재 ${myRank.rank}위 · 수익률 ${rate.toFixed(2)}%` : "초대코드로 친구 대회 참가"}</small></span><JoinDialog onChanged={loadCompetitions} /></div>
          <section className="panel quote-hero"><div className="quote-heading"><div><span className="market-badge">{selected.market}</span><small>{selected.symbol} · {selected.exchange}</small><h1>{selected.name}<button aria-label="관심종목 추가"><Star /></button></h1></div><span className={quoteStatus === "live" ? "live-pill" : "live-pill pending"}><i />{quoteStatus === "live" ? "실시간" : quoteStatus === "loading" ? "확인 중" : "시세 지연"}</span></div>
            <div className="quote-price"><strong>{formatPrice(selected)}</strong>{selected.price > 0 && <span className={selected.rate >= 0 ? "up" : "down"}>{selected.rate >= 0 ? "▲" : "▼"} {Math.abs(selected.change).toLocaleString()} ({selected.rate >= 0 ? "+" : ""}{selected.rate.toFixed(2)}%)</span>}</div>
            <div className="quote-stats"><span>시장 <b>{selected.exchange}</b></span><span>통화 <b>{selected.currency}</b></span><span>종목코드 <b>{selected.symbol}</b></span><span>시세원 <b>{selected.market === "CRYPTO" ? "Upbit" : "한국투자증권"}</b></span></div><div className="main-chart"><MiniChart positive={selected.rate >= 0} /></div><div className="chart-period">{["1일", "1주", "1개월", "3개월", "1년"].map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}</div></section>

          <div className="mobile-order"><OrderPanel quote={selected} participantId={participantId} onFilled={handleFilled} /></div>

          <section className="panel holdings"><div className="section-heading"><h2>내 투자현황</h2><button onClick={loadAccount}>새로고침</button></div><div className="asset-summary"><span>총 자산<strong>{formatKrw(assets)}</strong></span><span>평가손익<strong className={unrealizedPnl >= 0 ? "up" : "down"}>{formatKrw(unrealizedPnl)}</strong></span><span>실현손익<strong className={(portfolio?.account.realizedPnlKrw ?? 0) >= 0 ? "up" : "down"}>{formatKrw(portfolio?.account.realizedPnlKrw ?? 0)}</strong></span><span>수익률<strong className={rate >= 0 ? "up" : "down"}>{rate >= 0 ? "+" : ""}{rate.toFixed(2)}%</strong></span></div>
            <Table><TableHeader><TableRow><TableHead>종목</TableHead><TableHead>보유</TableHead><TableHead>평균단가</TableHead><TableHead>평가금액</TableHead><TableHead>평가손익</TableHead></TableRow></TableHeader><TableBody>{portfolio?.positions.length ? portfolio.positions.map(position => <TableRow key={`${position.market}:${position.symbol}`}><TableCell>{position.name}<small className="position-symbol">{position.symbol}</small></TableCell><TableCell>{formatQuantity(position.quantityMicros)}</TableCell><TableCell>{formatKrw(position.averagePriceKrwMicros / 1_000_000)}</TableCell><TableCell>{position.currentPriceKrwMicros ? formatKrw(position.marketValueKrw ?? 0) : "시세 대기"}</TableCell><TableCell className={(position.unrealizedPnlKrw ?? 0) >= 0 ? "up" : "down"}>{position.currentPriceKrwMicros ? formatKrw(position.unrealizedPnlKrw ?? 0) : "-"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="empty-cell">{participantId ? "아직 보유한 종목이 없습니다." : "대회에 참가하면 투자현황이 표시됩니다."}</TableCell></TableRow>}</TableBody></Table></section>

          <section className="panel trade-history"><div className="section-heading"><h2>내 체결내역</h2><span>{portfolio?.fills.length ?? 0}건</span></div>{portfolio?.fills.length ? portfolio.fills.slice(0, 30).map(fill => <div className="trade-row" key={fill.id}><span><b>{fill.name}</b><small>{fill.market} · {fill.symbol} · {formatDateTime(fill.executedAt)}</small></span><span><b className={fill.side === "buy" ? "up" : "down"}>{fill.side === "buy" ? "매수" : "매도"} {formatQuantity(fill.quantityMicros)}{fill.market === "CRYPTO" ? "개" : "주"}</b><small>{formatKrw(fillValueKrw(fill))}</small></span></div>) : <p className="empty-ranking">아직 체결된 모의주문이 없습니다.</p>}</section>

          <section className="panel mobile-ranking"><div className="section-heading"><h2>대회 순위</h2><span>{leaderboard.length}명</span></div>{leaderboard.length ? leaderboard.slice(0, 10).map(row => <button className="compact-rank" onClick={() => setSelectedParticipant(row)} key={row.participantId}><b>{row.rank}</b><span>{row.nickname}<small>{row.recentSymbols || "거래 없음"}</small></span><strong className={returnRate(row.totalAssetKrw, row.initialCashKrw) >= 0 ? "up" : "down"}>{returnRate(row.totalAssetKrw, row.initialCashKrw).toFixed(2)}%</strong></button>) : <p className="empty-ranking">대회를 만들거나 초대코드로 참가해주세요.</p>}</section>
        </div>

        <aside className="right-rail"><OrderPanel quote={selected} participantId={participantId} onFilled={handleFilled} /><section className="panel leaderboard"><div className="section-heading"><h2>실시간 순위</h2><span>{leaderboard.length}명</span></div>{leaderboard.length ? leaderboard.slice(0, 20).map(row => { const rowRate = returnRate(row.totalAssetKrw, row.initialCashKrw); return <button onClick={() => setSelectedParticipant(row)} className={row.participantId === participantId ? "rank-row mine" : "rank-row"} key={row.participantId}><b>{row.rank}</b><span><strong>{row.nickname}</strong><small>{row.recentSymbols || "거래 없음"}</small></span><span><em className={rowRate >= 0 ? "up" : "down"}>{rowRate >= 0 ? "+" : ""}{rowRate.toFixed(2)}%</em><small>{formatKrw(row.totalAssetKrw)}</small></span></button>; }) : <p className="empty-ranking">참가 중인 대회가 없습니다.</p>}</section><section className="panel news-list"><div className="section-heading"><h2>주요 뉴스</h2><button>더보기</button></div>{news.map(item => <article key={item[0]}><a href="#">{item[0]}</a><span>{item[1]} · {item[2]}</span></article>)}</section></aside>
      </main>

      <ParticipantActivityDialog row={selectedParticipant} onClose={() => setSelectedParticipant(null)} />

      <nav className="mobile-bottom" aria-label="모바일 메뉴">{[[Home, "홈"], [Star, "관심"], [LineChart, "시세"], [Trophy, "대회"], [UserRound, "MY"]].map(([Icon, label], index) => { const Component = Icon as typeof Home; return <button className={index === 0 ? "active" : ""} key={label as string}><Component /><span>{label as string}</span></button>; })}</nav>
    </div>
  );
}
