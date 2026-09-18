const PREFERRED_CRYPTO_NAMES: Record<string, string> = {
  BTC: "비트코인",
  ETH: "이더리움",
  XRP: "리플",
  USDT: "테더",
  SOL: "솔라나",
  DOGE: "도지코인",
  ADA: "에이다",
  TRX: "트론",
  AVAX: "아발란체",
  LINK: "체인링크",
  DOT: "폴카닷",
  BCH: "비트코인캐시",
  LTC: "라이트코인",
  ETC: "이더리움클래식",
  XLM: "스텔라루멘",
  HBAR: "헤데라",
  SUI: "수이",
  APT: "앱토스",
  ARB: "아비트럼",
  OP: "옵티미즘",
  NEAR: "니어프로토콜",
  ATOM: "코스모스",
  AAVE: "에이브",
  UNI: "유니스왑",
  SHIB: "시바이누",
  PEPE: "페페",
  TON: "톤코인",
  POL: "폴리곤",
  MATIC: "폴리곤",
  WLD: "월드코인",
  INJ: "인젝티브",
  FIL: "파일코인",
  ALGO: "알고랜드",
  VET: "비체인",
  ICP: "인터넷컴퓨터",
  GRT: "더그래프",
  MANA: "디센트럴랜드",
  SAND: "샌드박스",
  AXS: "엑시인피니티",
  STX: "스택스",
  IMX: "이뮤터블엑스",
  SEI: "세이",
  TIA: "셀레스티아",
  ONDO: "온도",
  LSK: "리스크",
  MKR: "메이커",
  DAI: "다이",
  ENA: "에테나",
  CRV: "커브",
  LDO: "리도다오",
  RUNE: "토르체인",
  THETA: "쎄타토큰",
  EOS: "이오스",
  QTUM: "퀀텀",
  NEO: "네오",
  IOTA: "아이오타",
  KAVA: "카바",
  KSM: "쿠사마",
  EGLD: "멀티버스엑스",
  FLOW: "플로우",
  CHZ: "칠리즈",
  GALA: "갈라",
  APE: "에이프코인",
  MASK: "마스크네트워크",
  BAT: "베이직어텐션토큰",
  ZEC: "지캐시",
  DASH: "대시",
  ENS: "이더리움네임서비스",
  BLUR: "블러",
  JASMY: "재스미코인",
  BONK: "봉크",
  FLOKI: "플로키",
  PENDLE: "펜들",
  JUP: "주피터",
  RENDER: "렌더",
  RNDR: "렌더토큰",
  TAO: "비텐서",
  KAIA: "카이아",
  KLAY: "클레이튼",
  KNC: "카이버네트워크",
  ANKR: "앵커",
  CELO: "셀로",
  GMT: "스테픈",
  MINA: "미나",
  CFX: "콘플럭스",
  AR: "아르위브",
};

export function cryptoTickerFromSymbol(symbol: string) {
  return String(symbol ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/^KRW[-_]/, "")
    .replace(/_KRW_(?:UPBIT|BITHUMB)$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function canonicalCryptoDisplayName(symbol: string, fallbackName = "") {
  const ticker = cryptoTickerFromSymbol(symbol);
  if (!ticker) return fallbackName.normalize("NFKC").trim();
  return PREFERRED_CRYPTO_NAMES[ticker] ?? ticker;
}

export function normalizeCryptoNamedItem<T extends { market: string; symbol: string; name: string }>(item: T): T {
  if (item.market !== "CRYPTO") return item;
  const name = canonicalCryptoDisplayName(item.symbol, item.name);
  return name === item.name ? item : { ...item, name };
}
