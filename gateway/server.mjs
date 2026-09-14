import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8788);
const TOSS_BASE_URL = "https://openapi.tossinvest.com";
const CLIENT_ID = process.env.TOSS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.TOSS_CLIENT_SECRET || "";
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || "";

const allowedRoutes = new Map([
  ["/v1/prices", "/api/v1/prices"],
  ["/v1/orderbook", "/api/v1/orderbook"],
  ["/v1/trades", "/api/v1/trades"],
  ["/v1/price-limits", "/api/v1/price-limits"],
  ["/v1/candles", "/api/v1/candles"],
]);

let tokenCache = { value: "", expiresAt: 0 };

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function secretsEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") && secretsEqual(header.slice(7), GATEWAY_SECRET);
}

async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.value;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const response = await fetch(`${TOSS_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error("Toss token request failed");
    error.status = response.status || 502;
    error.details = data;
    throw error;
  }

  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 300) * 1000,
  };
  return tokenCache.value;
}

function validateQuery(pathname, params) {
  const symbolPattern = /^[A-Za-z0-9.\-]+$/;
  if (pathname === "/v1/prices") {
    const symbols = (params.get("symbols") || "").split(",").filter(Boolean);
    return symbols.length >= 1 && symbols.length <= 200 && symbols.every((s) => symbolPattern.test(s));
  }
  const symbol = params.get("symbol") || "";
  return symbolPattern.test(symbol);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://gateway.local");

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    return json(res, 200, { ok: true, service: "marketmate-toss-gateway" });
  }
  if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });
  if (!isAuthorized(req)) return json(res, 401, { error: "unauthorized" });

  const upstreamPath = allowedRoutes.get(requestUrl.pathname);
  if (!upstreamPath) return json(res, 404, { error: "route_not_allowed" });
  if (!validateQuery(requestUrl.pathname, requestUrl.searchParams)) {
    return json(res, 400, { error: "invalid_query" });
  }

  try {
    const token = await getAccessToken();
    const upstreamUrl = new URL(upstreamPath, TOSS_BASE_URL);
    upstreamUrl.search = requestUrl.search;
    const upstream = await fetch(upstreamUrl, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const payload = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(payload);
  } catch (error) {
    json(res, error.status || 502, {
      error: "upstream_error",
      message: error.message,
      details: error.details || undefined,
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

if (!CLIENT_ID || !CLIENT_SECRET || GATEWAY_SECRET.length < 32) {
  console.error("TOSS_CLIENT_ID, TOSS_CLIENT_SECRET and a 32+ character GATEWAY_SECRET are required.");
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`marketmate-toss-gateway listening on ${PORT}`);
});
