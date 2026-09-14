import { apiError, requireUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/safety";

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
    const response = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`, { signal:AbortSignal.timeout(5_000), headers:{"user-agent":"MarketMate/1.0"} });
    if (!response.ok) throw new Error("NEWS_UNAVAILABLE");
    const xml = await response.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0,12).map(match => {
      const item = match[1];
      const read = (tag:string) => decodeXml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "");
      return { title:read("title"), link:read("link"), publishedAt:Date.parse(read("pubDate")) || Date.now(), source:read("source") || "Google 뉴스" };
    }).filter(item => item.title && item.link.startsWith("https://"));
    return Response.json({items},{headers:{"cache-control":"public, max-age=300"}});
  } catch (error) {
    if (error instanceof Error && error.message === "NEWS_UNAVAILABLE") return Response.json({items:[],error:"뉴스를 불러오지 못했습니다."},{status:503});
    return apiError(error);
  }
}
