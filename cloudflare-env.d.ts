declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TOSS_SECURITIES_API_KEY?: string;
    TOSS_SECURITIES_API_SECRET?: string;
    TOSS_SECURITIES_BASE_URL?: string;
    TOSS_SECURITIES_TOKEN_URL?: string;
    USD_KRW_RATE?: string;
  }
}
