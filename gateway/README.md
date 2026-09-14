# MarketMate Toss quote gateway

토스증권 허용 IP 제한을 만족시키기 위한 시세 전용 게이트웨이입니다. 실제 주문, 계좌 및 보유자산 API는 코드에서 제공하지 않습니다.

## 무료 배포 권장 구성

- Oracle Cloud Always Free Compute 인스턴스
- Reserved Public IPv4
- Ubuntu 24.04
- Docker Compose
- Caddy 자동 HTTPS

Oracle 가입과 VM 생성은 계정 소유자가 직접 진행해야 합니다. 지역별 Always Free 인스턴스 재고가 없을 수 있으며 무료 한도를 벗어나는 리소스를 선택하면 과금될 수 있습니다.

## 1. Oracle Cloud 준비

1. Always Free 대상 Compute 인스턴스를 생성합니다.
2. 인스턴스의 public IPv4를 Reserved IP로 전환합니다.
3. 인바운드 TCP 22, 80, 443만 허용합니다. 가능하면 22번은 본인 IP로 제한합니다.
4. Reserved IPv4를 토스증권 WTS의 `Open API > 허용 IP 관리`에 등록합니다.

## 2. DNS 준비

소유 도메인의 `gateway` A 레코드를 Reserved IPv4로 연결합니다. 도메인이 없다면 테스트용으로 `IP주소를-하이픈으로-변환.sslip.io` 형식을 사용할 수 있습니다. 예: `203.0.113.10` → `203-0-113-10.sslip.io`.

## 3. 서버 설치

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
git clone https://github.com/0x7f-core/marketmate-invest.git
cd marketmate-invest/gateway
cp .env.example .env
chmod 600 .env
```

`.env`에 Client ID, Client Secret, 32자 이상의 무작위 게이트웨이 키, 도메인을 입력합니다. 이 파일을 GitHub에 커밋하지 마세요.

```bash
docker compose up -d --build
docker compose ps
curl https://YOUR_GATEWAY_DOMAIN/health
```

## 4. 시세 테스트

```bash
curl -H "Authorization: Bearer YOUR_GATEWAY_SECRET" \
  "https://YOUR_GATEWAY_DOMAIN/v1/prices?symbols=005930,AAPL"
```

## 허용된 경로

- `GET /v1/prices?symbols=005930,AAPL`
- `GET /v1/orderbook?symbol=005930`
- `GET /v1/trades?symbol=005930&count=20`
- `GET /v1/price-limits?symbol=005930`
- `GET /v1/candles?symbol=005930&interval=1d`

`POST`, `PUT`, `PATCH`, `DELETE` 및 나머지 모든 경로는 차단됩니다. `/health`만 인증 없이 사용할 수 있습니다.

## 운영

```bash
docker compose logs --tail=100 gateway
docker compose pull
docker compose up -d --build
```

토스 Client Secret은 VM의 `.env`에만 저장하고 ChatGPT Sites나 브라우저로 전달하지 않습니다. Sites에는 게이트웨이 주소와 `GATEWAY_SECRET`만 Secret으로 등록합니다.
