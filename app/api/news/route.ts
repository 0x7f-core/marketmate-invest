import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { kisGetRoot } from "@/lib/server/market-data";
import { enforceRateLimit } from "@/lib/server/safety";

type NewsItem = { title: string; link: string; publishedAt: number; source: string };
const memoryCache = new Map<string, { items: NewsItem[]; expiresAt: number }>();

function sortNews(items: NewsItem[]) {
  return items.filter(item => item.title && Number.isFinite(item.publishedAt))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item, index, all) => all.findIndex(other => other.title === item.title) === index)
    .slice(0, 20);
}

function cachedItems(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? sortNews(parsed as NewsItem[]) : [];
  } catch { return []; }
}

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
}

function stringValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function kisTimestamp(row: Record<string, unknown>, index: number) {
  const date = stringValue(row, ["data_dt", "news_dt", "busi_dt", "date", "DATA_DT"]).replace(/\D/g, "");
  const time = stringValue(row, ["data_tm", "news_tm", "time", "DATA_TM"]).replace(/\D/g, "").padEnd(6, "0");
  if (date.length === 8) {
    const parsed = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() - index;
}

function mapKisRows(rows: Array<Record<string, unknown>>) {
  return sortNews(rows.map((row, index) => {
    const title = stringValue(row, ["hts_pbnt_titl_cntt", "titl_cntt", "news_titl", "title", "HEADLINE", "hts_pbnt_cntt"]);
    const provider = stringValue(row, ["news_ofer_entp_name", "news_ofer_entp_code", "source", "SOURCE"]);
    return {
      title,
      link: `https://search.naver.com/search.naver?query=${encodeURIComponent(title)}`,
      publishedAt: kisTimestamp(row, index),
      source: provider ? `한국투자 · ${provider}` : "한국투자증권 뉴스",
    };
  }));
}

function currentKisDateTime() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now).replaceAll("-", "");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(now).replaceAll(":", "");
  return { date, time };
}

async function fetchKisNews(market: "KR" | "US", symbol: string, exchange: string) {
  const { date, time } = currentKisDateTime();
  if (market === "KR") {
    const root = await kisGetRoot("/uapi/domestic-stock/v1/quotations/news-title", "FHKST01011800", {
      FID_NEWS_OFER_ENTP_CODE: "0", FID_COND_MRKT_CLS_CODE: "00", FID_INPUT_ISCD: symbol,
      FID_TITL_CNTT: "", FID_INPUT_DATE_1: date, FID_INPUT_HOUR_1: time,
      FID_RANK_SORT_CLS_CODE: "01", FID_INPUT_SRNO: "1",
    });
    return mapKisRows((Array.isArray(root.output) ? root.output : [root.output]) as Array<Record<string, unknown>>);
  }
  const root = await kisGetRoot("/uapi/overseas-price/v1/quotations/news-title", "HHPSTH60100C1", {
    INFO_GB: "", CLASS_CD: "", NATION_CD: "US", EXCHANGE_CD: exchange, SYMB: symbol.replace("_", "."),
    DATA_DT: date, DATA_TM: time, CTS: "",
  });
  return mapKisRows((Array.isArray(root.outblock1) ? root.outblock1 : [root.outblock1]) as Array<Record<string, unknown>>);
}

async function fetchGoogleNews(query: string) {
  const response = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`, {
    signal: AbortSignal.timeout(2_500), headers: { "user-agent": "MarketMate/1.0" },
  });
  if (!response.ok) throw new Error("NEWS_UNAVAILABLE");
  const xml = await response.text();
  return sortNews(Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 20).map(match => {
    const item = match[1];
    const read = (tag: string) => decodeXml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "");
    return { title: read("title"), link: read("link"), publishedAt: Date.parse(read("pubDate")) || Date.now(), source: read("source") || "Google 뉴스" };
  }).filter(item => item.link.startsWith("https://")));
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request, "news", 40, 5 * 60_000, user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") ?? "KR";
    const name = (url.searchParams.get("name") ?? "").slice(0, 50);
    const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().slice(0, 20);
    const exchange = (url.searchParams.get("exchange") ?? "").toUpperCase().slice(0, 10);
    if (!["KR", "US", "CRYPTO"].includes(market)) return Response.json({ error: "시장을 확인해주세요." }, { status: 400 });
    const query = name ? `${name} ${market === "CRYPTO" ? "암호화폐" : "주가"}` : market === "US" ? "미국 증시" : market === "CRYPTO" ? "가상자산 시장" : "국내 증시";
    const key = `v2:${market}:${symbol || name.normalize("NFKC").toLocaleLowerCase("ko-KR") || "market"}`;
    const inMemory = memoryCache.get(key);
    if (inMemory && inMemory.expiresAt > Date.now()) return Response.json({ items: inMemory.items }, { headers: { "cache-control": "private, max-age=60" } });
    const stored = await env.DB!.prepare("SELECT items,updated_at AS updatedAt FROM news_cache WHERE key=?").bind(key).first<{ items: string; updatedAt: number }>();
    if (stored && stored.updatedAt > Date.now() - 3 * 60_000) {
      const items = cachedItems(stored.items);
      memoryCache.set(key, { items, expiresAt: Date.now() + 90_000 });
      return Response.json({ items }, { headers: { "cache-control": "private, max-age=60" } });
    }
    let items: NewsItem[] = [];
    try {
      if ((market === "KR" || market === "US") && symbol) items = await fetchKisNews(market, symbol, exchange);
      if (!items.length) items = await fetchGoogleNews(query);
    } catch {
      try { items = await fetchGoogleNews(query); }
      catch {
        if (stored) return Response.json({ items: cachedItems(stored.items), stale: true }, { headers: { "cache-control": "private, max-age=30" } });
        throw new Error("NEWS_UNAVAILABLE");
      }
    }
    items = sortNews(items);
    memoryCache.set(key, { items, expiresAt: Date.now() + 90_000 });
    await env.DB!.prepare(`INSERT INTO news_cache (key,items,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET items=excluded.items,updated_at=excluded.updated_at`).bind(key, JSON.stringify(items), Date.now()).run();
    return Response.json({ items }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NEWS_UNAVAILABLE") return Response.json({ items: [], error: "뉴스를 불러오지 못했습니다." }, { status: 503, headers: { "retry-after": "30" } });
    return apiError(error);
  }
}
