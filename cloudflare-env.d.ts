declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    KIS_APP_KEY?: string;
    KIS_APP_SECRET?: string;
    KIS_BASE_URL?: string;
  }
}
