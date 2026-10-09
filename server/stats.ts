// Counts visits to the public site, the way Wix's "AI visibility" stats did:
// people (and where they came from, including AI assistants), AI assistants fetching
// pages live while answering someone, AI search/training crawlers, and search engines.
// Daily counts only: no IP addresses or cookies are stored.
import type { Env } from "./env";

export type Kind = "human" | "ai_live" | "ai_index" | "ai_train" | "search" | "bot";

// [pattern in the User-Agent, kind, display name]. First match wins.
const BOTS: [RegExp, Kind, string][] = [
  [/ChatGPT-User/i, "ai_live", "ChatGPT"],
  [/Claude-User/i, "ai_live", "Claude"],
  [/Perplexity-User/i, "ai_live", "Perplexity"],
  [/MistralAI-User/i, "ai_live", "Mistral"],
  [/DuckAssistBot/i, "ai_live", "DuckDuckGo AI"],
  [/Meta-ExternalFetcher/i, "ai_live", "Meta AI"],
  [/Google-Agent|Gemini/i, "ai_live", "Gemini"],
  [/OAI-SearchBot/i, "ai_index", "ChatGPT search"],
  [/Claude-SearchBot/i, "ai_index", "Claude search"],
  [/PerplexityBot/i, "ai_index", "Perplexity"],
  [/Amazonbot/i, "ai_index", "Amazon (Alexa)"],
  [/YouBot/i, "ai_index", "You.com"],
  [/GPTBot/i, "ai_train", "OpenAI (GPTBot)"],
  [/ClaudeBot|anthropic-ai/i, "ai_train", "Anthropic (ClaudeBot)"],
  [/meta-externalagent/i, "ai_train", "Meta"],
  [/Google-CloudVertexBot/i, "ai_train", "Google Vertex"],
  [/CCBot/i, "ai_train", "Common Crawl"],
  [/Bytespider/i, "ai_train", "ByteDance"],
  [/cohere-ai|cohere-training/i, "ai_train", "Cohere"],
  [/Applebot/i, "search", "Apple (Siri, Spotlight)"],
  [/Googlebot|Google-InspectionTool|GoogleOther/i, "search", "Google"],
  [/bingbot|BingPreview/i, "search", "Bing"],
  [/DuckDuckBot/i, "search", "DuckDuckGo"],
  [/YandexBot/i, "search", "Yandex"],
  [/Baiduspider/i, "search", "Baidu"],
  [/facebookexternalhit|Facebot/i, "bot", "Facebook link preview"],
  [/Twitterbot/i, "bot", "X link preview"],
  [/Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot|SkypeUriPreview|iMessage|Pinterest/i, "bot", "Link preview"],
  [/bot\b|crawler|spider|curl\/|wget|python-requests|httpx|axios|Go-http-client|node-fetch|HeadlessChrome|Lighthouse|PageSpeed|uptime|monitor|scan/i, "bot", "Other bots"],
];

// Where a person came from, by referring site or utm_source.
const SOURCES: [RegExp, string][] = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|^openai$|chatgpt/i, "ChatGPT"],
  [/(^|\.)perplexity\.ai$|perplexity/i, "Perplexity"],
  [/(^|\.)claude\.ai$|^claude$/i, "Claude"],
  [/gemini\.google\.com$|bard\.google\.com$|^gemini$/i, "Gemini"],
  [/copilot\.microsoft\.com$|(^|\.)copilot\.|^copilot$/i, "Copilot"],
  [/(^|\.)meta\.ai$/i, "Meta AI"],
  [/(^|\.)grok\.com$|(^|\.)x\.ai$/i, "Grok"],
  [/(^|\.)deepseek\.com$/i, "DeepSeek"],
  [/chat\.mistral\.ai$/i, "Mistral"],
  [/(^|\.)you\.com$/i, "You.com"],
  [/(^|\.)google\.[a-z.]+$|^google$/i, "Google"],
  [/(^|\.)bing\.com$|^bing$/i, "Bing"],
  [/(^|\.)duckduckgo\.com$/i, "DuckDuckGo"],
  [/(^|\.)yahoo\.com$/i, "Yahoo"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|^facebook$|^fb$/i, "Facebook"],
  [/(^|\.)instagram\.com$|^instagram$|^ig$/i, "Instagram"],
  [/(^|\.)youtube\.com$|youtu\.be$|^youtube$/i, "YouTube"],
  [/(^|\.)linkedin\.com$|lnkd\.in$|^linkedin$/i, "LinkedIn"],
  [/(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/i, "X"],
  [/(^|\.)tiktok\.com$/i, "TikTok"],
  [/nxsportal\.com$/i, "Nexus"],
  [/(^|\.)gigsalad\.com$/i, "GigSalad"],
  [/(^|\.)thebash\.com$/i, "The Bash"],
];

export const AI_SOURCES = new Set(["ChatGPT", "Perplexity", "Claude", "Gemini", "Copilot", "Meta AI", "Grok", "DeepSeek", "Mistral", "You.com"]);

export function classifyAgent(ua: string): { kind: Kind; name: string } | null {
  if (!ua) return { kind: "bot", name: "Other bots" };
  for (const [re, kind, name] of BOTS) if (re.test(ua)) return { kind, name };
  return null; // a person
}

export function sourceOf(url: URL, referrer: string | null): string {
  const utm = url.searchParams.get("utm_source");
  const candidates = [utm, referrer ? safeHost(referrer) : null].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c === url.hostname || c.endsWith(".jonmobley.com") || c === "jonmobley.com") continue;
    for (const [re, name] of SOURCES) if (re.test(c)) return name;
    return c.replace(/^www\./, "").slice(0, 60);
  }
  return "Direct";
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizePath(pathname: string): string {
  let p = pathname.toLowerCase().replace(/\/index\.html$/, "/").replace(/\/{2,}/g, "/");
  if (!p.endsWith("/") && !/\.[a-z0-9]+$/.test(p)) p += "/";
  return p.slice(0, 120);
}

/** Today's date in Jon's time zone. */
export function today(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function daySalt(env: Env, day: string): Promise<string> {
  const key = `stats_salt_${day}`;
  const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, fresh).run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'stats_salt_%' AND key < ?").bind(key).run();
  return row?.value ?? fresh;
}

/** Records one page view. Never throws. */
export async function record(env: Env, request: Request, path: string): Promise<void> {
  try {
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";
    const day = today();
    const bot = classifyAgent(ua);
    const kind: Kind = bot?.kind ?? "human";
    const name = bot ? bot.name : sourceOf(url, request.headers.get("Referer"));
    const stmts = [
      env.DB.prepare(
        "INSERT INTO stats_daily (day, kind, name, path, views) VALUES (?, ?, ?, ?, 1) ON CONFLICT(day, kind, name, path) DO UPDATE SET views = views + 1",
      ).bind(day, kind, name, path),
    ];
    if (kind === "human") {
      // Same person + browser on the same day → same hash; nothing links days together.
      // A random salt for each day (yesterday's is deleted), so a hash can't be traced back to an address.
      const ip = request.headers.get("CF-Connecting-IP") || "";
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO stats_visitors (day, hash) VALUES (?, ?)").bind(day, await sha256(`${await daySalt(env, day)}|${ip}|${ua}`)));
    }
    await env.DB.batch(stmts);
  } catch (e) {
    console.error("stats record failed", e);
  }
}

// ---------- reading ----------

const AI_KINDS = ["ai_live", "ai_index", "ai_train"];

export async function summary(env: Env, days: number) {
  const end = today();
  const startDate = new Date(`${end}T12:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const start = startDate.toISOString().slice(0, 10);

  // Keep about 13 months.
  const cutoff = new Date(`${end}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 400);
  const old = cutoff.toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stats_daily WHERE day < ?").bind(old),
    env.DB.prepare("DELETE FROM stats_visitors WHERE day < ?").bind(old),
  ]);

  const q = <T>(sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(start, end, ...args).all<T>().then((r) => r.results);
  const [byDayKind, byDayAiSource, visitorsByDay, pages, sources, bots, first] = await Promise.all([
    q<{ day: string; kind: string; views: number }>("SELECT day, kind, SUM(views) AS views FROM stats_daily WHERE day BETWEEN ? AND ? GROUP BY day, kind"),
    q<{ day: string; name: string; views: number }>("SELECT day, name, SUM(views) AS views FROM stats_daily WHERE day BETWEEN ? AND ? AND kind = 'human' GROUP BY day, name"),
    q<{ day: string; n: number }>("SELECT day, COUNT(*) AS n FROM stats_visitors WHERE day BETWEEN ? AND ? GROUP BY day"),
    q<{ path: string; views: number }>("SELECT path, SUM(views) AS views FROM stats_daily WHERE day BETWEEN ? AND ? AND kind = 'human' GROUP BY path ORDER BY views DESC LIMIT 12"),
    q<{ name: string; views: number }>("SELECT name, SUM(views) AS views FROM stats_daily WHERE day BETWEEN ? AND ? AND kind = 'human' GROUP BY name ORDER BY views DESC LIMIT 15"),
    q<{ kind: string; name: string; views: number; pages: number }>(
      `SELECT kind, name, SUM(views) AS views, COUNT(DISTINCT path) AS pages FROM stats_daily
       WHERE day BETWEEN ? AND ? AND kind IN ('ai_live','ai_index','ai_train','search') GROUP BY kind, name ORDER BY views DESC`,
    ),
    env.DB.prepare("SELECT MIN(day) AS first FROM stats_daily").first<{ first: string | null }>(),
  ]);

  const series: { day: string; visitors: number; views: number; fromAi: number; aiLive: number; aiIndex: number; aiTrain: number }[] = [];
  for (let d = new Date(`${start}T12:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const k = (kind: string) => byDayKind.find((r) => r.day === day && r.kind === kind)?.views ?? 0;
    series.push({
      day,
      visitors: visitorsByDay.find((r) => r.day === day)?.n ?? 0,
      views: k("human"),
      fromAi: byDayAiSource.filter((r) => r.day === day && AI_SOURCES.has(r.name)).reduce((n, r) => n + r.views, 0),
      aiLive: k("ai_live"),
      aiIndex: k("ai_index"),
      aiTrain: k("ai_train"),
    });
  }
  const sum = (f: (r: (typeof series)[number]) => number) => series.reduce((n, r) => n + f(r), 0);
  return {
    start, end, days, trackingSince: first?.first ?? null,
    totals: {
      visitors: sum((r) => r.visitors),
      views: sum((r) => r.views),
      fromAi: sum((r) => r.fromAi),
      aiLive: sum((r) => r.aiLive),
      aiCrawl: sum((r) => r.aiIndex + r.aiTrain),
    },
    series,
    pages,
    sources: sources.map((s) => ({ ...s, ai: AI_SOURCES.has(s.name) })),
    bots: bots.filter((b) => AI_KINDS.includes(b.kind) || b.kind === "search"),
  };
}
