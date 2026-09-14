import { clearSessionCookie, deleteSession } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/safety";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  await deleteSession(request);
  return Response.json({ loggedOut: true }, { headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}
