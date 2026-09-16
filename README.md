# 마켓메이트

친구들과 국내주식·미국주식·가상자산의 실제 시세를 기준으로 겨루는 모의투자 대회 웹앱입니다. 실제 증권 주문은 전송하지 않으며, 시장 데이터는 로그인 없이 공개된 `https://stock.naver.com/api/...` 읽기 전용 API만 사용합니다.

> 네이버증권 Web API는 공식 개발자 API가 아닌 비공식 공개 웹 API입니다. 응답 형식·엔드포인트·호출 제한이 예고 없이 바뀔 수 있으므로, 서버 캐시·stale 캐시·오류 UI를 전제로 사용합니다.

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
      │   ├─ 차트 / 뉴스 / 검색 / 지수 / 환율 API
      │   └─ pollingInterval 기반 서버 캐시
      └─ D1
          ├─ users / competitions / participants
          ├─ instruments / watchlist_items / quote_snapshots
          └─ orders / fills / positions / cash_ledger
```

한국투자증권(KIS) Open API와 Upbit REST API는 사용하지 않습니다. App Key, App Secret, OAuth 토큰, Upbit API 키도 필요하지 않습니다.

## 시장 데이터

- 국내주식 현재가: `/api/polling/domestic/stock`
- 미국주식 현재가: `/api/polling/worldstock/stock`
- 가상자산 현재가: `/api/polling/coin/price`
- 국내·해외 지수: `/api/polling/domestic/index`, `/api/polling/worldstock/index`
- 원/달러 환율: 네이버증권 통합 지표의 `FX_USDKRW`
- 거래소 장 상태: `/api/stockSecurity/market-status/current`
- 종목 검색: `/api/autocomplete/search/autoComplete`
- 국내 차트: `/api/securityService/chart/domestic/item/{code}`
- 미국 차트: `/api/securityService/stock/{reutersCode}/price`
- 가상자산 차트: `/api/coin/candle/UPBIT/KRW/{ticker}/days`
- 뉴스: 국내 뉴스 검색/종목 뉴스, 해외 뉴스, 가상자산 글로벌 뉴스

현재가 polling 응답의 `pollingInterval`을 다음 네이버 API 호출까지의 최소 서버 캐시 시간으로 사용합니다. 같은 종목에 대한 동시 요청은 하나로 합치고, 403·429·timeout·빈 응답·비정상 JSON이 발생하면 짧은 기간 동안 마지막 네이버 응답만 stale cache로 사용할 수 있습니다. 다른 시세 공급자로 자동 전환하지 않습니다.

모의투자 주문은 주문 순간 `getLiveQuote()`를 다시 호출하며, 네이버 polling 캐시가 유효하면 같은 응답을 재사용하고 만료된 경우에만 새 polling 요청을 보냅니다. 시세가 60초 이상 오래된 경우 체결을 중단합니다.

## 차트

기존 TradingView Embed iframe은 사용하지 않습니다. `lightweight-charts`를 사용해 국내주식·미국주식·가상자산을 같은 캔들차트 UI로 표시하며, 차트 원본 데이터는 모두 네이버증권 API에서 가져옵니다.

## 거래시간과 휴장

국내·미국 주식 주문 가능 여부는 로컬 휴장일 표나 직접 계산한 서머타임 로직 대신 네이버증권 `market-status` 응답을 우선 사용합니다.

사용 필드:

- `isHoliday`
- `currentSession`
- `marketState`
- `isDaylightSavingTime`
- `openTimeKst`
- `closeTimeKst`

시장상태 API 자체를 확인할 수 없는 경우에는 안전을 위해 주식 주문을 중단합니다. 가상자산은 24시간 시장으로 처리합니다.

## D1 데이터 모델

- `users`: 고유 닉네임, 암호화된 PIN 검증값, 로그인 잠금 상태
- `sessions`: 30일 만료 로그인 세션
- `competitions`: 대회 기간, 시작 자금, 초대코드, 상태
- `participants`: 대회별 참가자와 가상 현금
- `instruments`: 실제 거래된 종목 메타데이터
- `orders`: 멱등키가 포함된 모의 주문 원장
- `fills`: 네이버증권 시세로 계산된 모의 체결
- `positions`: 보유수량, 원화 환산 평균단가, 실현손익
- `cash_ledger`: 모든 가상현금 변동의 감사 원장
- `quote_snapshots`: 순위 계산용 마지막 검증 시세
- `watchlist_items`: 사용자별 관심종목

금액은 원 단위 정수, 수량과 가격은 1/1,000,000 단위 정수로 저장해 부동소수점 오차를 피합니다.

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/instruments/search?q=...&market=KR|US|CRYPTO`
- `GET /api/quotes?market=KR|US|CRYPTO&symbols=...`
- `GET /api/chart?market=...&symbol=...&range=1W|1M|3M|1Y`
- `GET /api/market-status?market=KR|US|CRYPTO`
- `GET /api/market-overview`
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
pnpm exec tsc --noEmit
pnpm run build
```

ChatGPT Sites가 `.openai/hosting.json`의 `DB` 바인딩을 실제 D1에 연결하고 배포 시 Drizzle 마이그레이션을 적용합니다.
