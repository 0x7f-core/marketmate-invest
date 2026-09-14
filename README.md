# 마켓메이트

친구들과 국내주식·미국주식·코인의 실제 시세를 기준으로 겨루는 모의투자 대회 웹앱입니다. 외부 API는 시세 조회에만 사용하며 실제 주문 API는 호출하지 않습니다.

## 구조

```
브라우저 (PC 전용 3열 UI / 모바일 전용 탭 UI)
  └─ ChatGPT Sites Worker
      ├─ 참가 인증: 고유 닉네임 + 숫자 PIN 4자리
      ├─ 대회·주문·체결·포트폴리오·순위 API
      ├─ 한국투자증권 Open API 시세 어댑터 (서버 전용 Secrets)
      ├─ Upbit 공개 시세 어댑터
      └─ D1
          ├─ users / competitions / participants
          ├─ instruments / watchlist_items / quote_snapshots
          └─ orders / fills / positions / cash_ledger
```

## D1 데이터 모델

- `users`: 고유 닉네임, 암호화된 PIN 검증값, 로그인 잠금 상태
- `sessions`: 30일 만료 로그인 세션
- `competitions`: 대회 기간, 시작 자금, 초대코드, 상태
- `participants`: 대회별 참가자와 가상 현금
- `instruments`: 국내·미국·코인 종목 마스터
- `orders`: 멱등키가 포함된 모의 주문 원장
- `fills`: 실제 시세로 계산된 모의 체결
- `positions`: 보유수량, 원화 환산 평균단가, 실현손익
- `cash_ledger`: 모든 가상현금 변동의 감사 원장
- `quote_snapshots`: 순위 계산용 마지막 검증 시세
- `watchlist_items`: 사용자별 관심종목

금액은 원 단위 정수, 수량과 가격은 1/1,000,000 단위 정수로 저장해 부동소수점 오차를 피합니다. 마이그레이션은 `drizzle/`에 있으며 런타임에서 테이블을 임의 생성하지 않습니다.

## API

- `POST /api/auth/register` — 닉네임과 PIN으로 가입
- `POST /api/auth/login` — 닉네임과 PIN으로 로그인
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/instruments/search?q=...&market=KR|US|CRYPTO`
- `GET /api/quotes?market=KR|US|CRYPTO&symbols=...`
- `GET|POST /api/competitions`
- `POST /api/competitions/join`
- `POST /api/orders` — 시장가 모의체결
- `GET /api/portfolio?participantId=...`
- `GET /api/leaderboard?competitionId=...`

주문 API는 현재 사용자와 참가자 소유권, 대회 기간, 보유수량/가상현금, 시세 신선도, 중복 주문키를 서버에서 검증합니다. 시세 제공자가 실패하거나 시세가 지연되면 체결하지 않습니다.

닉네임은 공백과 대소문자를 정규화한 값에 고유 제약을 적용합니다. PIN 원문은 저장하지 않고 PBKDF2-SHA256으로 검증값만 저장하며, 로그인 5회 실패 시 10분간 잠급니다. 세션 토큰도 해시만 D1에 저장합니다.

## 종목 마스터

`data/instruments.json`에는 한국투자증권 공식 국내·미국 종목 마스터와 Upbit 원화·BTC·USDT 마켓을 합친 검색 카탈로그가 들어 있습니다. 현재 17,013종목(국내 3,936, 미국 12,789, 코인 288)이며, 갱신은 아래 명령으로 수행합니다.

```bash
pnpm run catalog:update
```

## Sites 환경값

다음 값은 Sites 런타임 설정에 저장합니다. Key/Secret은 반드시 secret으로 표시하고 `NEXT_PUBLIC_` 접두사를 사용하지 않습니다.

- `KIS_APP_KEY` (secret)
- `KIS_APP_SECRET` (secret)
- `KIS_BASE_URL` — 선택값, 기본값은 `https://openapi.koreainvestment.com:9443`

Upbit 현재가는 서버에서 공개 REST API로 조회하므로 별도 키가 필요하지 않습니다.

한국투자증권 연동은 OAuth 토큰과 국내 현재가·해외 현재가상세 조회 API만 사용합니다. 미국주식은 현재가상세의 당일 환율을 원화 평가와 모의체결에 자동 적용하고 체결 당시 환율을 D1에 보존합니다. 실제 계좌 조회나 주문 API는 호출하지 않으며, 발급한 App Key와 App Secret은 브라우저 번들에 포함되지 않습니다. 접근 토큰은 App Secret에서 파생한 키로 암호화해 D1에 저장하므로 Worker 인스턴스가 달라도 24시간 동안 공유하며, 짧은 중복 시세 조회도 합쳐 API 호출량을 줄입니다.

## 개발

```bash
pnpm install
pnpm run db:generate
pnpm exec tsc --noEmit
pnpm run build
```

ChatGPT Sites가 `.openai/hosting.json`의 `DB` 바인딩을 실제 D1에 연결하고 배포 시 Drizzle 마이그레이션을 적용합니다.
