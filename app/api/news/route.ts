import { env } from "cloudflare:workers";
import { apiError, requireUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/safety";

type NewsItem = { title:string; link:string; publishedAt:number; source:string };
const memoryCache = new Map<string, { items:NewsItem[]; expiresAt:number }>();

function cachedItems(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as NewsItem[] : [];
  } catch { return []; }
}

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").replaceAll("&amp;","&").replaceAll("&quot;",'"').replaceAll("&#39;", "'").replaceAll("&lt;","<").replaceAll("&gt;",">").trim();
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await enforceRateLimit(request,"news",30,5*60_000,user.id);
    const url = new URL(request.url);
    const market = url.searchParams.get("market") ?? "KR";
    const name = (url.searchParams.get("name") ?? "").slice(0,50);
    const query = name ? `${name} ${market === "CRYPTO" ? "암호화폐" : "주가"}` : market === "US" ? "미국 증시" : market === "CRYPTO" ? "가상자산 시장" : "국내 증시";
    const key = `${market}:${name.normalize("NFKC").toLocaleLowerCase("ko-KR") || "market"}`;
    const inMemory = memoryCache.get(key);
    if (inMemory && inMemory.expiresAt > Date.now()) return Response.json({items:inMemory.items},{headers:{"cache-control":"private, max-age=120"}});
    const stored = await env.DB!.prepare("SELECT items,updated_at AS updatedAt FROM news_cache WHERE key=?").bind(key).first<{items:string;updatedAt:number}>();
    if (stored && stored.updatedAt > Date.now()-10*60_000) {
      const items = cachedItems(stored.items);
      memoryCache.set(key,{items,expiresAt:Date.now()+5*60_000});
      return Response.json({items},{headers:{"cache-control":"private, max-age=120"}});
    }
    let response: Response;
    try {
      response = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`, { signal:AbortSignal.timeout(2_500), headers:{"user-agent":"MarketMate/1.0"} });
      if (!response.ok) throw new Error("NEWS_UNAVAILABLE");
    } catch (error) {
      if (stored) return Response.json({items:cachedItems(stored.items),stale:true},{headers:{"cache-control":"private, max-age=60"}});
      throw error;
    }
    const xml = await response.text();
    const items: NewsItem[] = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0,12).map(match => {
      const item = match[1];
      const read = (tag:string) => decodeXml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "");
      return { title:read("title"), link:read("link"), publishedAt:Date.parse(read("pubDate")) || Date.now(), source:read("source") || "Google 뉴스" };
    }).filter(item => item.title && item.link.startsWith("https://"));
    memoryCache.set(key,{items,expiresAt:Date.now()+5*60_000});
    await env.DB!.prepare(`INSERT INTO news_cache (key,items,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET items=excluded.items,updated_at=excluded.updated_at`).bind(key,JSON.stringify(items),Date.now()).run();
    return Response.json({items},{headers:{"cache-control":"private, max-age=120"}});
  } catch (error) {
    if (error instanceof Error && error.message === "NEWS_UNAVAILABLE") return Response.json({items:[],error:"뉴스를 불러오지 못했습니다."},{status:503,headers:{"retry-after":"30"}});
    return apiError(error);
  }
}
