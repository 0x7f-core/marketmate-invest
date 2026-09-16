# 마켓메이트

친구들과 국내주식·미국주식·가상자산의 실제 시세를 기준으로 겨루는 모의투자 대회 웹앱입니다. 실제 증권 주문은 전송하지 않으며, 시장 데이터는 로그인 없이 공개된 `https://stock.naver.com/api/...` 읽기 전용 API만 사용합니다.

> 네이버증권 Web API는 공식 개발자 API가 아닌 비공식 공개 웹 API입니다. 응답 형식·엔드포인트·호출 제한이 예고 없이 바뀔 수 있으므로 서버 캐시, stale cache, fail-closed 주문 검증, 오류 UI를 전제로 사용합니다.

## 구조

```text
브라우저 (PC / 모바일 네이버증권 스타일 UI)
  └─ ChatGPT Sites Worker
      ├─ 참가 인증: 고유 닉네임 + 숫자 PIN 4자리
      ├─ 대회·주문·체결·포트폴리오·순위 API
      ├─ Naver Stock public read-only adapter
      │   ├─ /api/polling/domestic/*
      │   ├─ /api/polling/worldstock/*
      │   ├─ /api/polling/coin/price
      │   ├─ /api/stockSecurity/market-status/*
      │   ├─ 차트 / 뉴스 / 검색 / 지수 / 환율
      │   ├─ 재무 / 수급 / 공시 / ETF / 시장 랭킹
      │   └─ pollingInterval 기반 서버 캐시
      └─ D1
          ├─ users / competitions / participants
          ├─ instruments / watchlist_items / quote_snapshots
          └─ orders / fills / positions / cash_ledger
```

한국투자증권(KIS) Open API와 Upbit REST API는 사용하지 않습니다. KIS App Key/App Secret/OAuth 토큰이나 Upbit API 키도 필요하지 않습니다. 종목 검색 역시 과거의 KIS/Upbit 기반 로컬 종목마스터를 사용하지 않고 네이버증권 자동완성 API를 직접 사용합니다.

## 시장 데이터

- 국내주식 현재가: `/api/polling/domestic/stock`, NXT 활성 시 `/api/polling/domestic/NXT/stock`
- 미국주식 현재가: `/api/polling/worldstock/stock`
- 가상자산 현재가: `/api/polling/coin/price`
- 국내·해외 지수: `/api/polling/domestic/index`, `/api/polling/worldstock/index`
- 원/달러 환율: 네이버증권 통합 지표 `FX_USDKRW`
- 거래소 장 상태: `/api/stockSecurity/market-status/current`
- 종목 검색: `/api/autocomplete/search/autoComplete`
- 국내 차트: `/api/securityService/chart/domestic/item/{code}`
- 미국 차트: `/api/securityService/stock/{reutersCode}/price`
- 가상자산 차트: `/api/coin/candle/UPBIT/KRW/{ticker}/days`
- 뉴스: 국내 뉴스/종목 뉴스, 해외 뉴스, 가상자산 글로벌 뉴스
- 국내 상세: 종목정보, 투자자 수급, 증권사 수급, 공시, 컨센서스, 재무 메뉴, ESG
- ETF: 국내 ETF v2 목록/상세/구성종목, 미국 ETF v2 목록/구성종목
- 시장 랭킹: 국내 업종·테마·그룹, 미국 섹터, 가상자산 랭킹

미국 ETF 목록은 `/api/stockSecurity/etfs/v2/foreign`의 `tradingValue desc` 계약을 사용하고, 구성종목은 `/api/stockSecurity/etfs/v2/foreign/{reutersCode}/composition`처럼 Reuters 코드를 사용합니다. 2026-09-16 live smoke에서 `QQQ` ticker-only 경로는 404, `QQQ.O` Reuters 경로는 200으로 확인했습니다. 국내 ETF 목록은 `/api/stockSecurity/etfs/v2/domestic`의 `listingType=tradingValueDesc` 계약을 사용합니다.

네이버증권의 가상자산 endpoint와 ticker에는 거래소 식별자로 `UPBIT` 문자열이 포함됩니다. 이는 네이버 upstream의 공개 경로/식별자에만 사용하며 사용자 화면의 공급자 표시는 `NAVER`로 통일합니다. 사이트가 `api.upbit.com`을 직접 호출하거나 Upbit API 키를 사용하지는 않습니다. 내부 가상자산 종목 ID도 `KRW-{ticker}`로 통일해 `BTC_KRW_UPBIT` 같은 upstream 식별자가 관심종목·포트폴리오 키로 새지 않게 합니다.

현재가 polling 응답의 `pollingInterval`을 다음 네이버 upstream 호출까지의 최소 서버 캐시 시간으로 사용합니다. 같은 URL에 대한 동시 요청은 하나로 합치며, 403·429·timeout·빈 응답·비정상 JSON이 발생하면 허용된 짧은 기간 동안 마지막 네이버 응답만 stale cache로 사용할 수 있습니다. 다른 시세 공급자로 자동 전환하지 않습니다.

시장 개요(KOSPI·KOSDAQ·S&P 500·나스닥·BTC)도 고정 주기로 Worker를 호출하지 않습니다. fresh 응답의 `pollingInterval` 중 가장 빠른 값을 기준으로 다음 호출을 예약하며, 과도한 호출을 막기 위해 2~120초 범위로 제한합니다. 더 느린 upstream은 서버 캐시가 각자 자신의 `pollingInterval`을 계속 존중합니다.

네이버 upstream 응답은 최대 5 MiB로 제한하며 `Content-Length`가 없더라도 스트림을 읽는 도중 제한을 넘으면 즉시 중단합니다. identity 응답이 선언된 `Content-Length`보다 짧게 끝나면 전송 중단으로 처리하고, gzip/br 같은 압축 응답은 wire 길이와 디코딩 후 길이가 다를 수 있으므로 그 비교를 적용하지 않습니다. 요청 timeout은 응답 헤더 수신까지만이 아니라 본문 수신·JSON 처리까지 유지합니다.

## 모의주문 체결 안전장치

신규 주문은 주문 순간 `getTradingQuote()`로 장 상태와 거래소를 함께 확인한 뒤 최신 시세를 다시 조회합니다. 국내주식은 KRX와 NXT가 동시에 열려 있으면 KRX를 우선하고, KRX가 닫힌 뒤 NXT만 활성 상태일 때만 NXT polling 시세를 사용합니다. 네이버 polling 캐시가 아직 `pollingInterval` 내라면 동일 응답을 재사용하고, 만료됐을 때만 새 upstream 요청을 보냅니다.

- 최신 시세가 stale이면 주식/가상자산 신규 체결을 중단합니다.
- 네이버 polling 응답에서 실제 거래시각이 확인되지 않은 시세는 화면 표시에는 사용할 수 있지만 모의체결에는 사용하지 않습니다.
- 검증된 source timestamp의 허용 범위는 `max(60초, pollingInterval + 15초)`로 계산하고 최대 180초로 제한하며, 이를 넘으면 체결을 중단합니다.
- NXT 시세에 실제 체결시각이 없으면 체결을 중단합니다.
- 미국 프리마켓·애프터마켓 역시 market-status가 OPEN인 것만으로 체결하지 않습니다. Naver worldstock polling 시세에서 실제 거래시각이 확인되고 freshness window 안에 있을 때만 체결합니다. 따라서 정규장 종가와 오래된 거래시각만 남아 있으면 주문은 fail-closed 됩니다.
- 미국주식 원화 환산은 네이버증권 `FX_USDKRW`만 사용하며, 환율 응답이 stale이면 주가가 최신이어도 미국 거래용 quote를 중단합니다. 표시/거래 경로는 같은 `naver-fx.ts` 파서를 사용하고 거래 경로는 이미 검증한 fresh FX 값을 재사용합니다.
- 국내/미국주식은 네이버 market-status가 최신 상태로 확인될 때만 체결합니다.
- 지정가 대기 주문도 미검증 timestamp, stale/freshness window 초과 시세 또는 stale 장 상태로는 자동 체결하지 않습니다. market-status를 확인한 뒤에도 quote freshness를 한 번 더 검사합니다.
- 지정가 자동체결 시 국내 현재 거래소와 quote venue가 다르면 체결하지 않습니다.
- 네이버증권 장애 시 다른 공급자 가격으로 우회 체결하지 않습니다.

국내 종목 메타데이터에는 현재 선택된 실제 quote venue(`KRX` 또는 `NXT`)를 저장합니다. 화면도 quote 응답의 venue를 따라가므로 KRX 우선 구간과 KRX 종료 후 NXT 단독 구간의 표시가 서버 체결 정책과 일치합니다. 지정가 주문이 다른 국내 세션에서 실제 체결된 경우에는 성공한 fresh quote의 venue로 **현재 종목 메타데이터**를 갱신합니다. 포트폴리오와 참가자 공개 투자현황의 보유종목은 이 현재 exchange를 사용합니다.

현재 `fills` 스키마에는 체결 당시 venue를 별도로 저장하는 컬럼이 없습니다. 따라서 과거 체결내역에 현재 mutable `instruments.exchange`를 붙여 체결 당시 거래소처럼 보이게 하지 않습니다. 추후 execution venue 컬럼을 정식 Drizzle 마이그레이션으로 추가하기 전까지 과거 fill UI/API에서는 거래소를 표시하지 않습니다.

## 평가 시세와 순위

포트폴리오 API는 보유종목의 마지막 검증 시세가 없거나 15초 이상 오래된 경우 최대 8종목을 Naver에서 병렬 갱신한 뒤 평가금액을 계산합니다. 갱신 결과가 stale이면 저장하지 않고 마지막 검증 시세를 유지합니다. 기존 snapshot은 임시 claim을 사용해 같은 종목에 대한 중복 upstream 갱신을 줄입니다.

대회 순위도 오래된 보유종목 시세를 최대 8개씩 병렬 갱신합니다. 각 종목은 독립 claim을 사용하고, Naver 오류·stale 응답이면 원래 `received_at`을 복구해 마지막 검증 가격을 유지합니다. 관심종목 갱신도 stale quote로 snapshot이나 국내 venue를 덮어쓰지 않습니다.

## 차트

기존 TradingView Embed iframe은 사용하지 않습니다. TradingView Lightweight Charts의 standalone 배포본을 필요할 때만 지연 로드해 국내주식·미국주식·가상자산을 같은 캔들차트 UI로 표시합니다. 차트 원본 데이터는 모두 네이버증권 API에서 가져옵니다.

PC와 모바일 모두 동일한 차트 컴포넌트와 기간 선택 방식을 사용하고, 주변 UI는 네이버증권 스타일에 맞춰 반응형으로 구성합니다. 차트 API가 403/429/빈 응답 등을 반환하면 외부 공급자로 fallback하지 않고 오류/재시도 UI를 표시합니다. Lightweight Charts의 attribution logo와 TradingView attribution notice/link를 유지합니다.

## 거래시간과 휴장

국내·미국 주식 주문 가능 여부는 로컬 휴장일 표나 직접 계산한 서머타임 로직 대신 네이버증권 `market-status` 응답을 우선 사용합니다.

사용 필드:

- `isHoliday`
- `currentSession`
- `marketSessionType` / `marketStatusDetailType`
- `marketState`
- `isDaylightSavingTime`
- `openTimeKst`
- `closeTimeKst`

국내는 KRX/NXT 두 상태를 함께 확인하며 **동시 개장 시 KRX를 우선**합니다. KRX가 거래 가능하지 않고 NXT만 열려 있을 때에만 NXT를 선택합니다. 미국주식은 네이버 market-status가 OPEN으로 확인한 프리마켓·정규장·애프터마켓 세션에서 주문할 수 있으며, closing 세션은 제외합니다. `marketState`가 OPEN이어도 세션 타입을 확인할 수 없으면 안전을 위해 주문을 중단합니다. 시장상태 API를 확인할 수 없거나 stale cache만 남아 있는 경우에도 주식 주문을 중단합니다. 가상자산은 24시간 시장으로 처리합니다.

시장/종목을 전환하면 새 `market-status`가 도착하기 전까지 UI도 즉시 `확인 중`·주문 불가 상태로 초기화해 이전 시장의 OPEN 상태를 잠깐 재사용하지 않습니다.

## 네이버 시장 상세 API

사이트 내부의 `GET /api/market-insights`는 임의 네이버 URL을 프록시하지 않습니다. 서버에 등록한 읽기 전용 `kind` allowlist만 사용할 수 있습니다.

지원 kind:

- `domestic-detail`, `domestic-price`
- `domestic-investor`, `domestic-broker`
- `domestic-disclosure`, `domestic-consensus`, `domestic-finance-menu`, `domestic-esg`
- `domestic-etf-list`, `domestic-etf-detail`, `domestic-etf-components`, `domestic-ranking`
- `foreign-basic`, `foreign-overview`, `foreign-consensus`, `foreign-finance`
- `foreign-etf-list`, `foreign-etf-components`, `foreign-sector-ranking`
- `crypto-ranking`, `indicators`

`size`는 1~100 정수로 제한하고 cursor, 정렬, 카테고리, 재무 section/period, exchange 식별자를 서버에서 검증합니다. 응답은 `source: "NAVER"`, `stale`, `fetchedAt`을 포함하며 Naver 장애 시 다른 공급자로 전환하지 않습니다.

## API

- `GET /api/instruments/search?q=...&market=KR|US|CRYPTO`
- `GET /api/quotes?market=KR|US|CRYPTO&symbols=...`
- `GET /api/chart?market=...&symbol=...&range=1W|1M|3M|1Y`
- `GET /api/market-status?market=KR|US|CRYPTO`
- `GET /api/market-overview`
- `GET /api/market-insights?kind=...`
- `GET /api/news`
- `GET|POST /api/competitions`
- `POST /api/competitions/join`
- `POST /api/orders`
- `GET /api/portfolio?participantId=...`
- `GET /api/participants/activity?participantId=...`
- `GET /api/leaderboard?competitionId=...`

주문 API는 사용자·참가자 소유권, 대회 기간, 네이버증권 시장 상태, 보유수량/가상현금, 시세 신선도, 중복 주문키를 서버에서 검증합니다.

## Sites 환경값

시장 데이터용 secret은 없습니다. ChatGPT Sites의 `.openai/hosting.json`에서 `DB` D1 바인딩만 사용합니다.

## 개발

```bash
pnpm install
pnpm run db:generate
pnpm run validate:migration
pnpm run validate:legacy-config
pnpm run typecheck
pnpm run lint
pnpm run build
```

`validate:migration`은 실행 코드에서 KIS OpenAPI host, 직접 `api.upbit.com` 호출, TradingView Embed iframe이 다시 유입되지 않았는지와 KRX→NXT 우선순위, 미국 애프터마켓 허용, 거래·평가 라우트의 `getTradingQuote()` 강제, active venue 저장/표시, 공통 FX 파서, 시세·환율 freshness guard, 포트폴리오·순위의 fresh 평가 시세 갱신, 시장개요 pollingInterval, 네이버 응답 크기·timeout·중단 응답 guard, crypto canonical symbol, ETF v2 계약, 과거 fills의 mutable exchange 비노출 같은 핵심 전환 조건을 빠르게 점검합니다.

`validate:legacy-config`는 `.env.example`, Cloudflare Env 타입, 직접 패키지 목록, lockfile에 KIS/Upbit 설정·호스트·관련 직접 의존성 또는 기존 TradingView Embed/widget 패키지가 다시 들어오지 않았는지 별도로 확인합니다. 네이버 upstream 가상자산 식별자에 필요한 `UPBIT` 문자열 자체는 금지하지 않습니다.

GitHub Actions의 `Validate Naver migration`은 frozen lockfile 설치 뒤 두 검사를 모두 실행하고 typecheck, lint, build까지 통과해야 성공합니다.

ChatGPT Sites가 `.openai/hosting.json`의 `DB` 바인딩을 실제 D1에 연결하고 배포 시 Drizzle 마이그레이션을 적용합니다.
