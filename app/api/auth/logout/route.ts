import { clearSessionCookie, deleteSession } from "@/lib/server/auth";

export async function POST(request: Request) {
  await deleteSession(request);
  return Response.json({ loggedOut: true }, { headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}
