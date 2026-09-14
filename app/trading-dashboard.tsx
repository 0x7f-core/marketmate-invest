"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Home, LineChart, Menu, Search, Settings, Star, Trophy, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Market = "KR" | "US" | "CRYPTO";
type Quote = {
  market: Market; symbol: string; name: string; price: number; change: number;
  rate: number; currency: "KRW" | "USD"; volume: string; exchangeRate?: number;
};

const quotes: Quote[] = [
  { market: "KR", symbol: "005930", name: "삼성전자", price: 82500, change: 1400, rate: 1.73, currency: "KRW", volume: "1,284만" },
  { market: "KR", symbol: "000660", name: "SK하이닉스", price: 287000, change: 7500, rate: 2.68, currency: "KRW", volume: "389만" },
  { market: "KR", symbol: "035420", name: "NAVER", price: 238500, change: -3500, rate: -1.45, currency: "KRW", volume: "92만" },
  { market: "US", symbol: "NVDA", name: "엔비디아", price: 178.42, change: 3.18, rate: 1.81, currency: "USD", volume: "1.7억" },
  { market: "US", symbol: "AAPL", name: "애플", price: 246.16, change: -1.44, rate: -0.58, currency: "USD", volume: "4,821만" },
  { market: "CRYPTO", symbol: "KRW-BTC", name: "비트코인", price: 165420000, change: 2865000, rate: 1.76, currency: "KRW", volume: "1,924억" },
];

const chartPoints = [42, 38, 45, 43, 52, 49, 61, 58, 66, 63, 71, 75, 70, 78, 82, 77, 86, 91, 88, 96];
const ranking = [
  ["1", "수익왕민수", "₩112,840,500", "+12.84%", "SK하이닉스"],
  ["2", "JINWOOK", "₩108,276,300", "+8.28%", "삼성전자"],
  ["3", "테슬라곰", "₩105,910,000", "+5.91%", "엔비디아"],
  ["4", "코인대장", "₩101,470,200", "+1.47%", "비트코인"],
  ["5", "현금이최고", "₩99,820,000", "-0.18%", "NAVER"],
];

const positions = [
  ["삼성전자", "25주", "80,120", "82,500", "+59,500", "+2.97%"],
  ["SK하이닉스", "8주", "278,500", "287,000", "+68,000", "+3.05%"],
  ["엔비디아", "4주", "$172.31", "$178.42", "+₩32,210", "+3.55%"],
];

const news = [
  ["반도체 대형주 동반 강세…외국인 매수세 유입", "마켓데일리", "12분 전"],
  ["뉴욕증시, 금리 인하 기대에 기술주 중심 상승", "글로벌마켓", "28분 전"],
  ["비트코인 1억6천만원대 회복…거래대금 증가", "코인포커스", "41분 전"],
];

function formatPrice(q: Quote) {
  return q.currency === "USD"
    ? `$${q.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
    : `${q.price.toLocaleString("ko-KR")}원`;
}

function MiniChart({ positive = true }: { positive?: boolean }) {
  const points = chartPoints.map((v, i) => `${(i / (chartPoints.length - 1)) * 100},${100 - v}`).join(" ");
  return (
    <svg viewBox="0 0 100 65" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="일중 가격 추이">
      <defs>
        <linearGradient id={positive ? "up-fill" : "down-fill"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={positive ? "#e8344e" : "#2878d8"} stopOpacity=".2" />
          <stop offset="1" stopColor={positive ? "#e8344e" : "#2878d8"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,65 ${points} 100,65`} fill={`url(#${positive ? "up-fill" : "down-fill"})`} />
      <polyline points={points} fill="none" stroke={positive ? "#e8344e" : "#2878d8"} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MarketStrip() {
  const items = [
    ["KOSPI", "2,684.32", "+0.82%"], ["KOSDAQ", "872.14", "+0.46%"],
    ["S&P 500", "6,147.42", "+0.54%"], ["NASDAQ", "20,102.18", "+0.91%"],
    ["BTC/KRW", "165,420,000", "+1.76%"],
  ];
  return (
    <div className="market-strip">
      {items.map(([name, value, rate]) => (
        <div className="market-ticker" key={name}>
          <span>{name}</span><strong>{value}</strong><em>{rate}</em>
        </div>
      ))}
    </div>
  );
}

function JoinDialog({ onJoined }: { onJoined: (participantId: string) => void }) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [code, setCode] = useState("");
  const [name, setName] = useState("9월 친구 투자대회");
  const [cash, setCash] = useState("100000000");
  const [status, setStatus] = useState("");
  const submit = async () => {
    setStatus("처리 중...");
    const payload = mode === "join"
      ? { inviteCode: code }
      : { name, initialCashKrw: Number(cash), startsAt: Date.now() - 1000, endsAt: Date.now() + 30 * 86400000 };
    const response = await fetch(mode === "join" ? "/api/competitions/join" : "/api/competitions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string; participantId?: string; competition?: { participantId?: string } };
    if (!response.ok) return setStatus(result.error ?? "처리하지 못했습니다.");
    const participantId = result.participantId ?? result.competition?.participantId;
    if (participantId) onJoined(participantId);
    setStatus(mode === "join" ? "대회에 참가했습니다." : "대회를 만들었습니다.");
  };
  return (
    <Dialog>
      <DialogTrigger asChild><Button className="contest-button"><Trophy /> 대회 참가</Button></DialogTrigger>
      <DialogContent className="rounded-2xl border-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{mode === "join" ? "초대코드로 참가" : "새 대회 만들기"}</DialogTitle>
          <DialogDescription>친구들과 같은 시작금으로 실제 시세 모의투자를 시작합니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-2">
          <div className="mode-switch">
            <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>대회 참가</button>
            <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>대회 개설</button>
          </div>
          {mode === "join" ? (
            <label className="field-label">초대코드<Input value={code} onChange={e => setCode(e.target.value)} placeholder="예: MATE-2026" className="mt-2 uppercase" /></label>
          ) : (
            <>
              <label className="field-label">대회 이름<Input value={name} onChange={e => setName(e.target.value)} className="mt-2" /></label>
              <label className="field-label">시작 자금<Input value={cash} onChange={e => setCash(e.target.value.replace(/\D/g, ""))} className="mt-2" /></label>
            </>
          )}
        </div>
        <DialogFooter className="px-6 pb-6">
          <div className="w-full">{status && <p className="mb-3 text-center text-xs text-muted-foreground" role="status">{status}</p>}<Button onClick={submit} className="w-full bg-[#19a974] hover:bg-[#14875d]">{mode === "join" ? "참가하기" : "대회 만들기"}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SearchBox() {
  const [query, setQuery] = useState("");
  const found = useMemo(() => query ? quotes.filter(q => `${q.name}${q.symbol}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4) : [], [query]);
  return (
    <div className="search-wrap">
      <Search aria-hidden="true" />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="종목명·코드 검색" aria-label="종목 검색" />
      {query && <button aria-label="검색어 지우기" onClick={() => setQuery("")}><X /></button>}
      {found.length > 0 && (
        <div className="search-results">
          {found.map(q => <button key={q.symbol}><span><strong>{q.name}</strong><small>{q.symbol} · {q.market}</small></span><b>{formatPrice(q)}</b></button>)}
        </div>
      )}
    </div>
  );
}

function OrderPanel({ quote, participantId }: { quote: Quote; participantId: string | null }) {
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState("");
  const estimatedKrw = quote.price * (quote.exchangeRate ?? 1) * Number(quantity || 0);
  const submitOrder = async (side: "buy" | "sell") => {
    if (!participantId) return setStatus("먼저 대회에 참가해주세요.");
    setStatus("실시간 시세를 확인하고 있습니다...");
    const response = await fetch("/api/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, clientOrderId: crypto.randomUUID(), market: quote.market, symbol: quote.symbol, name: quote.name, exchange: quote.market === "CRYPTO" ? "UPBIT" : "KIS", side, orderType: "market", quantity: Number(quantity) }),
    });
    const result = await response.json() as { error?: string };
    setStatus(response.ok ? "모의주문이 현재 시세로 체결되었습니다." : (result.error ?? "주문을 처리하지 못했습니다."));
  };
  return (
    <section className="panel order-panel">
      <Tabs defaultValue="buy">
        <TabsList variant="line" className="order-tabs">
          <TabsTrigger value="buy" className="buy-tab">매수</TabsTrigger>
          <TabsTrigger value="sell" className="sell-tab">매도</TabsTrigger>
        </TabsList>
        {["buy", "sell"].map(side => (
          <TabsContent value={side} key={side} className="order-form">
            <div className="available"><span>주문 가능</span><strong>₩46,728,300</strong></div>
            <label>주문 유형<select aria-label="주문 유형"><option>시장가</option><option>지정가</option></select></label>
            <label>수량<div className="number-input"><input value={quantity} onChange={e => setQuantity(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /><span>주</span></div></label>
            {quote.currency === "USD" && <div className="available"><span>적용 환율</span><strong>{quote.exchangeRate ? `${quote.exchangeRate.toLocaleString("ko-KR")}원/USD` : "KIS 조회 시 적용"}</strong></div>}
            <div className="order-total"><span>예상 주문금액</span><strong>₩{Math.round(estimatedKrw).toLocaleString("ko-KR")}</strong></div>
            <Button onClick={() => submitOrder(side as "buy" | "sell")} className={side === "buy" ? "order-buy" : "order-sell"}>
              {quote.name} {side === "buy" ? "매수" : "매도"}
            </Button>
            {status && <p className="order-status" role="status">{status}</p>}
            <p className="simulation-note">실제 증권 주문은 전송되지 않습니다.</p>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

export default function TradingDashboard({ userName }: { userName: string }) {
  const [market, setMarket] = useState<Market>("KR");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const baseQuote = quotes.find(q => q.market === market) ?? quotes[0];
  const quoteKey = `${market}:${baseQuote.symbol}`;
  const [quoteResult, setQuoteResult] = useState<{ key: string; status: "live" | "unavailable"; quote?: Quote } | null>(null);
  const currentResult = quoteResult?.key === quoteKey ? quoteResult : null;
  const quoteStatus = currentResult?.status ?? "loading";
  const quote = currentResult?.quote ?? baseQuote;
  useEffect(() => {
    let active = true;
    fetch(`/api/quotes?market=${market}&symbols=${encodeURIComponent(baseQuote.symbol)}`, { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as { quotes?: Array<{ price: number; change: number; changeRate: number; currency: "KRW" | "USD"; exchangeRate: number }> };
        if (!active || !response.ok || !result.quotes?.[0]) throw new Error("QUOTE_UNAVAILABLE");
        const value = result.quotes[0];
        setQuoteResult({ key: quoteKey, status: "live", quote: { ...baseQuote, price: value.price, change: value.change, rate: value.changeRate, currency: value.currency, exchangeRate: value.exchangeRate } });
      })
      .catch(() => active && setQuoteResult({ key: quoteKey, status: "unavailable" }));
    return () => { active = false; };
  }, [baseQuote, market, quoteKey]);
  useEffect(() => {
    fetch("/api/competitions").then(r => r.ok ? r.json() : null).then((data: { competitions?: Array<{ participantId: string }> } | null) => {
      if (data?.competitions?.[0]?.participantId) setParticipantId(data.competitions[0].participantId);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "select_market", title: "시장 선택", description: "화면의 국내, 미국, 코인 시장 탭을 선택합니다.",
      inputSchema: { type: "object", properties: { market: { type: "string", enum: ["KR", "US", "CRYPTO"] } }, required: ["market"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = (input as { market?: Market }).market;
        if (!value || !["KR", "US", "CRYPTO"].includes(value)) throw new Error("지원하지 않는 시장입니다.");
        setMarket(value); return { selectedMarket: value };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({
      name: "search_instruments", title: "종목 검색", description: "현재 화면에서 지원하는 종목을 이름 또는 코드로 검색합니다.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input: unknown) {
        const query = String((input as { query?: string }).query ?? "").toLowerCase();
        return { results: quotes.filter(q => `${q.name}${q.symbol}`.toLowerCase().includes(query)).map(q => ({ market: q.market, symbol: q.symbol, name: q.name })) };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);
  return (
    <div className="site-shell">
      <header className="desktop-header">
        <div className="header-top">
          <a className="brand" href="#"><span>MM</span><b>마켓메이트</b></a>
          <SearchBox />
          <div className="header-actions"><button aria-label="알림"><Bell /></button><JoinDialog onJoined={setParticipantId} /><button className="profile">{userName.slice(0, 1)}</button></div>
        </div>
        <nav className="primary-nav" aria-label="주 메뉴">
          {["홈", "국내증시", "미국증시", "코인", "뉴스", "모의투자대회"].map((item, i) => <button className={i === 0 ? "active" : ""} key={item}>{item}</button>)}
        </nav>
        <MarketStrip />
      </header>

      <header className="mobile-header">
        <div><button aria-label="메뉴"><Menu /></button><a className="brand" href="#"><span>MM</span><b>마켓메이트</b></a><button aria-label="알림"><Bell /></button></div>
        <SearchBox />
        <MarketStrip />
      </header>

      <main className="dashboard">
        <aside className="left-rail">
          <section className="panel contest-card">
            <div className="panel-title"><span><Trophy />9월 친구 투자대회</span><button><Settings /></button></div>
            <strong className="my-rank">2위 <small>/ 8명</small></strong>
            <div className="rank-progress"><i /></div>
            <div className="contest-meta"><span>D-17</span><span>수익률 <b>+8.28%</b></span></div>
          </section>
          <section className="panel watchlist">
            <div className="panel-title"><span><Star />관심종목</span><button>편집</button></div>
            {quotes.slice(0, 5).map(q => <button className="watch-row" key={q.symbol}><span><b>{q.name}</b><small>{q.symbol}</small></span><span><strong>{formatPrice(q)}</strong><em className={q.rate >= 0 ? "up" : "down"}>{q.rate >= 0 ? "+" : ""}{q.rate}%</em></span></button>)}
          </section>
        </aside>

        <div className="main-column">
          <div className="market-selector" role="tablist" aria-label="시장 선택">
            {([["KR", "국내"], ["US", "미국"], ["CRYPTO", "코인"]] as const).map(([value, label]) => <button role="tab" aria-selected={market === value} className={market === value ? "active" : ""} onClick={() => setMarket(value)} key={value}>{label}</button>)}
          </div>
          <div className="mobile-contest-entry">
            <span><Trophy /><b>9월 친구 투자대회</b><small>현재 2위 · 수익률 +8.28%</small></span>
            <JoinDialog onJoined={setParticipantId} />
          </div>
          <section className="panel quote-hero">
            <div className="quote-heading"><div><span className="market-badge">{quote.market}</span><small>{quote.symbol} · {quote.market === "CRYPTO" ? "Upbit" : "한국투자증권"}</small><h1>{quote.name}<button aria-label="관심종목 추가"><Star /></button></h1></div><span className={quoteStatus === "live" ? "live-pill" : "live-pill pending"}><i /> {quoteStatus === "live" ? "현재가" : quoteStatus === "loading" ? "확인 중" : "샘플 시세"}</span></div>
            <div className="quote-price">
              <strong>{formatPrice(quote)}</strong>
              <span className={quote.rate >= 0 ? "up" : "down"}>{quote.rate >= 0 ? "▲" : "▼"} {Math.abs(quote.change).toLocaleString()} ({quote.rate >= 0 ? "+" : ""}{quote.rate}%)</span>
            </div>
            <div className="quote-stats">
              <span>시가 <b>81,600</b></span><span>고가 <b className="up">83,100</b></span><span>저가 <b className="down">80,900</b></span><span>거래량 <b>{quote.volume}</b></span>
            </div>
            <div className="main-chart"><MiniChart positive={quote.rate >= 0} /><span className="chart-label top">83,100</span><span className="chart-label bottom">80,900</span></div>
            <div className="chart-period">{["1일", "1주", "1개월", "3개월", "1년"].map((x, i) => <button className={i === 0 ? "active" : ""} key={x}>{x}</button>)}</div>
          </section>

          <section className="panel holdings">
            <div className="section-heading"><h2>내 투자현황</h2><button>전체보기</button></div>
            <div className="asset-summary"><span>총 자산<strong>₩108,276,300</strong></span><span>평가손익<strong className="up">+₩2,742,100</strong></span><span>수익률<strong className="up">+8.28%</strong></span></div>
            <Table>
              <TableHeader><TableRow><TableHead>종목</TableHead><TableHead>보유</TableHead><TableHead>평균단가</TableHead><TableHead>현재가</TableHead><TableHead>평가손익</TableHead><TableHead>수익률</TableHead></TableRow></TableHeader>
              <TableBody>{positions.map(row => <TableRow key={row[0]}>{row.map((v, i) => <TableCell className={i >= 4 ? "up" : ""} key={i}>{v}</TableCell>)}</TableRow>)}</TableBody>
            </Table>
          </section>

          <section className="panel mobile-ranking">
            <div className="section-heading"><h2>대회 순위</h2><button>전체보기</button></div>
            {ranking.slice(0, 4).map(r => <div className="compact-rank" key={r[0]}><b>{r[0]}</b><span>{r[1]}<small>{r[4]}</small></span><strong>{r[3]}</strong></div>)}
          </section>
        </div>

        <aside className="right-rail">
          <OrderPanel quote={quote} participantId={participantId} />
          <section className="panel leaderboard">
            <div className="section-heading"><h2>실시간 순위</h2><button>거래내역</button></div>
            {ranking.map(r => <div className={r[1] === "JINWOOK" ? "rank-row mine" : "rank-row"} key={r[0]}><b>{r[0]}</b><span><strong>{r[1]}</strong><small>{r[4]}</small></span><span><em className={r[3].startsWith("+") ? "up" : "down"}>{r[3]}</em><small>{r[2]}</small></span></div>)}
          </section>
          <section className="panel news-list">
            <div className="section-heading"><h2>주요 뉴스</h2><button>더보기</button></div>
            {news.map(n => <article key={n[0]}><a href="#">{n[0]}</a><span>{n[1]} · {n[2]}</span></article>)}
          </section>
        </aside>
      </main>

      <nav className="mobile-bottom" aria-label="모바일 메뉴">
        {[[Home,"홈"],[Star,"관심"],[LineChart,"시세"],[Trophy,"대회"],[UserRound,"MY"]].map(([Icon,label], i) => {
          const C = Icon as typeof Home; return <button className={i === 0 ? "active" : ""} key={label as string}><C/><span>{label as string}</span></button>;
        })}
      </nav>
    </div>
  );
}
