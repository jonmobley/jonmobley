export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** Set with `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name jonmobley`. */
  ANTHROPIC_API_KEY?: string;
  /** Local testing only: point the chat at a fake Claude server. */
  ANTHROPIC_BASE_URL?: string;
}
