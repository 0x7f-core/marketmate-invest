export type RequestUser = { id: string; email: string; name: string };

export function requireUser(request: Request): RequestUser {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) throw new Error("AUTH_REQUIRED");
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const name =
    encodedName &&
    request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? decodeURIComponent(encodedName)
      : email.split("@")[0];
  return { id, email, name };
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  if (message === "AUTH_REQUIRED") return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "NOT_FOUND") return Response.json({ error: "요청한 정보를 찾을 수 없습니다." }, { status: 404 });
  if (message === "FORBIDDEN") return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  return Response.json({ error: "요청을 처리하지 못했습니다." }, { status: 500 });
}
