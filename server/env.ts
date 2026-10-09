export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** Set with `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name jonmobley`. */
  ANTHROPIC_API_KEY?: string;
  /** Local testing only: point the chat at a fake Claude server. */
  ANTHROPIC_BASE_URL?: string;
  /** Where Nexus's agent booking API lives. Defaults to https://nxsportal.com/api/agent/booking. */
  NEXUS_AGENT_URL?: string;
  /** Lets Backstage change the AI booking settings in Nexus. Set by Nexus's script/agent-booking-admin-key.ts. */
  NEXUS_AGENT_ADMIN_KEY?: string;
}
