// Social: Jon's online presence in one place. Pulls numbers, comments and reviews from each
// platform into D1 (social_* tables, migration 0009), keeps drafts and a posting calendar,
// and gives the Social chat its tools. Platforms connect one at a time; the rest show how to.
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import * as data from "./data";
import { today } from "./stats";

type Json = Record<string, unknown>;

export const PLATFORMS = ["website", "youtube", "instagram", "facebook", "google", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
const POST_PLATFORMS: Platform[] = ["instagram", "facebook", "youtube", "google", "linkedin"];
const POST_STATUSES = ["draft", "scheduled", "posted"] as const;

/** Where each profile lives; shown on the Accounts page and used for "open" links. */
const PROFILE: Record<Platform, { name: string; url: string }> = {
  website: { name: "jonmobley.com", url: "https://jonmobley.com/" },
  youtube: { name: "@jonmobley", url: "https://www.youtube.com/@jonmobley" },
  instagram: { name: "@mobleymagic", url: "https://www.instagram.com/mobleymagic/" },
  facebook: { name: "mobleymagic", url: "https://www.facebook.com/mobleymagic" },
  google: { name: "Google Business Profile", url: "https://g.page/jon-mobley" },
  linkedin: { name: "/in/jonmobley", url: "https://www.linkedin.com/in/jonmobley" },
};

/** What still needs doing before a platform's numbers flow in. Plain words for Jon. */
const NOT_YET: Partial<Record<Platform, string>> = {
  instagram: "Needs a one-time Meta connection: Instagram set to a Business or Creator account and linked to your Facebook Page, then approve the connect screen.",
  facebook: "Connects together with Instagram (one Meta connection covers both).",
  google: "Google first needs you to re-verify the Business Profile. After that, Google approves API access (a short form) and you approve the connect screen.",
  linkedin: "LinkedIn only lets apps post for personal profiles (no stats or messages). Connects later with one approval screen.",
};

// ---------- small helpers ----------

const now = () => Date.now();
const parseList = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const parseObj = (s: unknown): Json => {
  try {
    const v = JSON.parse(String(s ?? "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
  } catch {
    return {};
  }
};
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "2026-10-20T18:30" in Jon's time zone (Eastern) → epoch ms. */
export function easternToMs(local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Find Eastern's offset at that moment (handles daylight saving).
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asEastern = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess - (asEastern - guess);
}
const msToEastern = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(ms)).replace(", ", "T");

// ---------- accounts ----------

async function getConfig(env: Env, platform: Platform): Promise<Json> {
  const row = await env.DB.prepare("SELECT config FROM social_accounts WHERE platform = ?").bind(platform).first<{ config: string }>();
  return parseObj(row?.config);
}

function isConnected(env: Env, platform: Platform): boolean {
  if (platform === "website") return true;
  if (platform === "youtube") return !!env.YOUTUBE_API_KEY;
  return false;
}

/** Accounts for the page: never includes tokens. */
export async function listAccounts(env: Env) {
  const { results } = await env.DB.prepare("SELECT platform, last_sync, last_error FROM social_accounts").all<{ platform: string; last_sync: number | null; last_error: string }>();
  const byPlatform = new Map(results.map((r) => [r.platform, r]));
  return PLATFORMS.map((p) => ({
    platform: p,
    ...PROFILE[p],
    connected: isConnected(env, p),
    how: isConnected(env, p) ? "" : NOT_YET[p] ?? "",
    last_sync: byPlatform.get(p)?.last_sync ?? null,
    last_error: byPlatform.get(p)?.last_error ?? "",
  }));
}

async function markSync(env: Env, platform: Platform, error = "") {
  await env.DB.prepare(
    `INSERT INTO social_accounts (platform, last_sync, last_error) VALUES (?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET last_sync = excluded.last_sync, last_error = excluded.last_error`,
  ).bind(platform, now(), error).run();
}

async function saveSnapshot(env: Env, platform: Platform, s: { followers?: number | null; views?: number | null; posts?: number | null; extra?: Json }) {
  await env.DB.prepare(
    `INSERT INTO social_stats (platform, day, followers, views, posts, extra) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform, day) DO UPDATE SET followers = excluded.followers, views = excluded.views, posts = excluded.posts, extra = excluded.extra`,
  ).bind(platform, today(), s.followers ?? null, s.views ?? null, s.posts ?? null, JSON.stringify(s.extra ?? {})).run();
}

interface InboxIn { id: string; platform: Platform; kind: string; author: string; text: string; url: string; context: string; at: number; replied: boolean }
async function upsertInbox(env: Env, items: InboxIn[]) {
  if (!items.length) return;
  const stmt = env.DB.prepare(
    `INSERT INTO social_inbox (id, platform, kind, author, text, url, context, at, replied) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, replied = excluded.replied`,
  );
  await env.DB.batch(items.map((i) => stmt.bind(i.id, i.platform, i.kind, i.author, i.text.slice(0, 4000), i.url, i.context.slice(0, 300), i.at, i.replied ? 1 : 0)));
}

// ---------- platform connectors ----------

async function syncWebsite(env: Env) {
  const end = today();
  const start = addDays(end, -6);
  const visitors = await env.DB.prepare("SELECT COUNT(*) AS n FROM stats_visitors WHERE day BETWEEN ? AND ?").bind(start, end).first<{ n: number }>();
  const kinds = await env.DB.prepare("SELECT kind, SUM(views) AS v FROM stats_daily WHERE day BETWEEN ? AND ? GROUP BY kind").bind(start, end).all<{ kind: string; v: number }>();
  const by = Object.fromEntries(kinds.results.map((r) => [r.kind, r.v]));
  const booking = await env.DB.prepare("SELECT SUM(views) AS v FROM stats_daily WHERE day BETWEEN ? AND ? AND kind = 'human' AND path LIKE '/booking%'").bind(start, end).first<{ v: number | null }>();
  await saveSnapshot(env, "website", {
    views: visitors?.n ?? 0,
    extra: { page_views_7d: by.human ?? 0, ai_lookups_7d: by.ai_live ?? 0, booking_views_7d: booking?.v ?? 0 },
  });
}

const YT = "https://www.googleapis.com/youtube/v3";
async function yt(env: Env, path: string, params: Record<string, string>): Promise<Json> {
  const q = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY ?? "" });
  const res = await fetch(`${YT}/${path}?${q}`);
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(`YouTube said ${res.status}: ${String((body.error as Json | undefined)?.message ?? "error").slice(0, 160)}`);
  return body;
}
const items = (b: Json) => (Array.isArray(b.items) ? (b.items as Json[]) : []);
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

async function syncYouTube(env: Env) {
  const cfg = await getConfig(env, "youtube");
  const handle = typeof cfg.handle === "string" && cfg.handle ? cfg.handle : "jonmobley";
  const ch = items(await yt(env, "channels", { part: "statistics,contentDetails", forHandle: handle }))[0];
  if (!ch) throw new Error(`No YouTube channel @${handle}.`);
  const channelId = String(ch.id);
  const stats = (ch.statistics ?? {}) as Json;
  const uploads = String(((ch.contentDetails as Json)?.relatedPlaylists as Json)?.uploads ?? "");

  const describe = (v: Json) => {
    const sn = (v.snippet ?? {}) as Json;
    const st = (v.statistics ?? {}) as Json;
    return { id: String(v.id), title: String(sn.title ?? ""), published: String(sn.publishedAt ?? ""), views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount), url: `https://youtu.be/${v.id}` };
  };
  const videos = async (ids: string[]) => (ids.length ? items(await yt(env, "videos", { part: "snippet,statistics", id: ids.join(",") })).map(describe) : []);

  const recentIds = uploads ? items(await yt(env, "playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "10" })).map((i) => String((i.contentDetails as Json)?.videoId)) : [];
  const topIds = items(await yt(env, "search", { part: "id", channelId, order: "viewCount", type: "video", maxResults: "5" })).map((i) => String((i.id as Json)?.videoId));
  const [recent, top] = await Promise.all([videos(recentIds), videos(topIds)]);

  await saveSnapshot(env, "youtube", {
    followers: num(stats.subscriberCount),
    views: num(stats.viewCount),
    posts: num(stats.videoCount),
    extra: { recent, top },
  });

  // Comments across the channel, newest first. "Replied" = Jon has answered in the thread.
  const titles = new Map([...recent, ...top].map((v) => [v.id, v.title]));
  const threads = items(await yt(env, "commentThreads", { part: "snippet,replies", allThreadsRelatedToChannelId: channelId, order: "time", maxResults: "50", textFormat: "plainText" }));
  const inbox: InboxIn[] = [];
  for (const t of threads) {
    const top = (((t.snippet as Json)?.topLevelComment as Json)?.snippet ?? {}) as Json;
    const author = String(((top.authorChannelId as Json) ?? {}).value ?? "");
    if (author === channelId) continue; // Jon's own comment
    const videoId = String(top.videoId ?? (t.snippet as Json)?.videoId ?? "");
    const replies = (((t.replies as Json)?.comments as Json[]) ?? []);
    const replied = replies.some((r) => String((((r.snippet as Json)?.authorChannelId as Json) ?? {}).value ?? "") === channelId);
    inbox.push({
      id: `youtube:${t.id}`,
      platform: "youtube",
      kind: "comment",
      author: String(top.authorDisplayName ?? ""),
      text: String(top.textDisplay ?? top.textOriginal ?? ""),
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${t.id}` : PROFILE.youtube.url,
      context: titles.get(videoId) ?? "",
      at: Date.parse(String(top.publishedAt ?? "")) || now(),
      replied,
    });
  }
  // Titles for comments on older videos we haven't listed.
  const missing = [...new Set(inbox.filter((i) => !i.context).map((i) => new URL(i.url).searchParams.get("v") || ""))].filter(Boolean).slice(0, 50);
  if (missing.length) {
    const more = await videos(missing);
    const t2 = new Map(more.map((v) => [v.id, v.title]));
    for (const i of inbox) if (!i.context) i.context = t2.get(new URL(i.url).searchParams.get("v") || "") ?? "";
  }
  await upsertInbox(env, inbox);
}

const SYNCERS: Partial<Record<Platform, (env: Env) => Promise<void>>> = { website: syncWebsite, youtube: syncYouTube };

/** Pulls fresh numbers and comments from every connected platform. Never throws. */
export async function syncAll(env: Env): Promise<{ platform: string; ok: boolean; error?: string }[]> {
  const out = [];
  for (const [platform, run] of Object.entries(SYNCERS) as [Platform, (env: Env) => Promise<void>][]) {
    if (!isConnected(env, platform)) continue;
    try {
      await run(env);
      await markSync(env, platform);
      out.push({ platform, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("social sync failed", platform, err);
      await markSync(env, platform, msg).catch(() => {});
      out.push({ platform, ok: false, error: msg });
    }
  }
  return out;
}

const SYNC_EVERY_MS = 3 * 60 * 60 * 1000;
/** True when the last sync is older than 3 hours (pages call this on open). */
export async function isStale(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT MIN(last_sync) AS t, COUNT(*) AS n FROM social_accounts WHERE platform IN ('website', 'youtube')").first<{ t: number | null; n: number }>();
  return !row?.t || row.n < 2 || now() - row.t > SYNC_EVERY_MS;
}

// ---------- stats ----------

export interface Snapshot { platform: string; day: string; followers: number | null; views: number | null; posts: number | null; extra: Json }

export async function statsSeries(env: Env, days: number): Promise<Record<string, Snapshot[]>> {
  const from = addDays(today(), -days);
  const { results } = await env.DB.prepare("SELECT * FROM social_stats WHERE day >= ? ORDER BY day").bind(from).all<Snapshot & { extra: string }>();
  const out: Record<string, Snapshot[]> = {};
  for (const r of results) (out[r.platform] ??= []).push({ ...r, extra: parseObj(r.extra) });
  return out;
}

/** Latest numbers per platform, with the change since about `days` ago (when we have it). */
export async function latest(env: Env, days = 30) {
  const series = await statsSeries(env, days);
  return Object.fromEntries(Object.entries(series).map(([p, rows]) => {
    const last = rows[rows.length - 1];
    const first = rows[0];
    const diff = (k: "followers" | "views" | "posts") => (rows.length > 1 && last[k] !== null && first[k] !== null ? (last[k] as number) - (first[k] as number) : null);
    return [p, { ...last, since: rows.length > 1 ? first.day : null, change: { followers: diff("followers"), views: diff("views"), posts: diff("posts") } }];
  }));
}

// ---------- posts ----------

export interface Post { id: string; text: string; platforms: string[]; media: string[]; status: string; scheduled_at: number | null; posted_at: number | null; post_url: string; notes: string; created_at: number; updated_at: number }
const toPost = (r: Json): Post => ({ ...(r as unknown as Post), platforms: parseList(r.platforms), media: parseList(r.media) });

export async function listPosts(env: Env): Promise<Post[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM social_posts ORDER BY CASE status WHEN 'posted' THEN 1 ELSE 0 END, COALESCE(scheduled_at, posted_at, updated_at) DESC LIMIT 300",
  ).all<Json>();
  return results.map(toPost);
}
export async function getPost(env: Env, id: string): Promise<Post | null> {
  const r = await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(id).first<Json>();
  return r ? toPost(r) : null;
}
export async function deletePost(env: Env, id: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM social_posts WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Create (no id) or update a post. Only fields present change. */
export async function savePost(env: Env, input: Json, id?: string): Promise<Post> {
  const old = id ? await getPost(env, id) : null;
  if (id && !old) throw new data.InputError("No post with that id.");
  const p: Post = old ?? { id: data.newId(), text: "", platforms: [], media: [], status: "draft", scheduled_at: null, posted_at: null, post_url: "", notes: "", created_at: now(), updated_at: now() };

  if (typeof input.text === "string") p.text = input.text.slice(0, 5000);
  if (typeof input.notes === "string") p.notes = input.notes.slice(0, 2000);
  if (typeof input.post_url === "string") p.post_url = /^https?:\/\//.test(input.post_url) || !input.post_url ? input.post_url.slice(0, 500) : p.post_url;
  if (Array.isArray(input.platforms)) p.platforms = [...new Set(input.platforms.filter((x): x is string => POST_PLATFORMS.includes(x as Platform)))];
  if (Array.isArray(input.media)) p.media = input.media.filter((k): k is string => typeof k === "string" && /^media\/[a-f0-9-]+\.[a-z0-9]+$/.test(k)).slice(0, 10);
  if ("scheduled_at" in input) {
    const v = input.scheduled_at;
    if (v === null || v === "") p.scheduled_at = null;
    else if (typeof v === "number") p.scheduled_at = v;
    else if (typeof v === "string") {
      const ms = easternToMs(v);
      if (ms === null) throw new data.InputError("Use a date and time like 2026-10-20T18:30.");
      p.scheduled_at = ms;
    }
  }
  if (typeof input.status === "string") {
    if (!POST_STATUSES.includes(input.status as (typeof POST_STATUSES)[number])) throw new data.InputError("Status must be draft, scheduled or posted.");
    p.status = input.status;
  }
  if (p.status === "scheduled" && !p.scheduled_at) throw new data.InputError("Pick a date and time to schedule it.");
  if (p.status === "posted" && !p.posted_at) p.posted_at = now();
  if (p.status !== "posted") p.posted_at = null;
  p.updated_at = now();

  await env.DB.prepare(
    `INSERT INTO social_posts (id, text, platforms, media, status, scheduled_at, posted_at, post_url, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, platforms = excluded.platforms, media = excluded.media, status = excluded.status,
       scheduled_at = excluded.scheduled_at, posted_at = excluded.posted_at, post_url = excluded.post_url, notes = excluded.notes, updated_at = excluded.updated_at`,
  ).bind(p.id, p.text, JSON.stringify(p.platforms), JSON.stringify(p.media), p.status, p.scheduled_at, p.posted_at, p.post_url, p.notes, p.created_at, p.updated_at).run();
  return p;
}

// ---------- inbox ----------

export interface InboxItem { id: string; platform: string; kind: string; author: string; text: string; url: string; context: string; at: number; status: string; replied: number; suggested_reply: string }

const NEEDS_DAYS = 30;
export async function listInbox(env: Env, opts: { status?: string; limit?: number } = {}): Promise<InboxItem[]> {
  const limit = Math.min(300, opts.limit ?? 150);
  const sql = opts.status === "needs"
    ? "SELECT * FROM social_inbox WHERE status = 'new' AND replied = 0 AND at > ? ORDER BY at DESC LIMIT ?"
    : "SELECT * FROM social_inbox WHERE at > ? ORDER BY at DESC LIMIT ?";
  // "Waiting on you" only counts the last 30 days; older comments stay under Everything.
  const since = opts.status === "needs" ? now() - NEEDS_DAYS * 864e5 : 0;
  return (await env.DB.prepare(sql).bind(since, limit).all<InboxItem>()).results;
}

export async function updateInbox(env: Env, id: string, input: Json): Promise<InboxItem | null> {
  const row = await env.DB.prepare("SELECT * FROM social_inbox WHERE id = ?").bind(id).first<InboxItem>();
  if (!row) return null;
  const status = input.status === "new" || input.status === "done" ? input.status : row.status;
  const reply = typeof input.suggested_reply === "string" ? input.suggested_reply.slice(0, 2000) : row.suggested_reply;
  await env.DB.prepare("UPDATE social_inbox SET status = ?, suggested_reply = ? WHERE id = ?").bind(status, reply, id).run();
  return { ...row, status, suggested_reply: reply };
}

// ---------- overview (Today page) ----------

export async function overview(env: Env) {
  const [accounts, numbers, needs, posts, actions] = await Promise.all([listAccounts(env), latest(env, 30), listInbox(env, { status: "needs", limit: 20 }), listPosts(env), listActions(env)]);
  const upcoming = posts.filter((p) => p.status === "scheduled").sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));
  const due = upcoming.filter((p) => (p.scheduled_at ?? 0) <= now());
  const lastPosted = Math.max(0, ...posts.filter((p) => p.posted_at).map((p) => p.posted_at as number));
  return {
    accounts,
    numbers,
    actions,
    last_proposed: Number(await setting(env, "social_last_proposed")) || null,
    needs,
    due,
    upcoming: upcoming.filter((p) => !due.includes(p)).slice(0, 5),
    drafts: posts.filter((p) => p.status === "draft").length,
    last_posted: lastPosted || null,
  };
}

// ---------- the Social chat ----------

// ---------- everything specific to this business ----------
// To make a copy of Social for another business (e.g. Ellie Mae's Bakery), swap this block,
// PROFILE above and KNOWN_FIXES below; the rest is generic.
const BUSINESS = `Who Jon is: a working magician, comedian and emcee from Indianapolis who performs corporate events, private parties, weddings and galas, and emcees fundraisers. Credits you may use (never invent others): Penn & Teller: Fool Us (season 9, a bullet catch; season 11, "Literal Magic", whose clip has over a million views on YouTube), The CW, Chicago Magic Lounge, local TV (Fox59 Indy Now, WISH-TV). Google: 5.0 stars from about 139 reviews. Tagline: "Laugh and Be Amazed." Instagram bio: "Magic, comedy, and stories to inspire." Booking page: https://jonmobley.com/booking

His accounts: jonmobley.com, YouTube @jonmobley, Instagram @mobleymagic, Facebook page mobleymagic, Google Business Profile, LinkedIn /in/jonmobley.

The goal of all of this: more event planners booking Jon. Fans are nice; bookings pay. Favour posts that show him performing for real audiences (corporate crowds, galas, weddings), reactions, testimonials, behind-the-scenes and upcoming shows, with a clear next step (the booking link) where it fits.

Voice: short, confident and playful. Lean on proof from others (TV credits, audience reactions, reviews) more than self-praise. No hashtag walls: at most 3-5 relevant hashtags on Instagram, 0-2 elsewhere. No emoji spam.`;

export const SOCIAL_SYSTEM = `You are Social, the assistant for Jon Mobley's online presence, inside his private Backstage on jonmobley.com. Only Jon can reach you; he is signed in.

${BUSINESS}

Platform habits:
- Instagram: Reels do best. Lead with a hook in the first line; caption under ~150 words; booking link lives in the bio, so say "link in bio".
- Facebook: conversational; links are fine; tag venues and organisations when Jon gives names.
- YouTube: Shorts for clips; titles that make people curious, descriptions with the booking link.
- Google Business Profile: short update with a photo and a "Book" call to action; mention the city and the kind of event (helps local search).
- LinkedIn: speak to event planners, HR and association leaders; a short story with a takeaway, no hashtags spam.

What you can do with the tools:
- See the latest numbers, comments, reviews and messages that have come in, and Jon's drafts and posting calendar.
- Write drafts and schedule them (times are Eastern). Jon reviews every post. Posting itself: platforms that aren't connected yet can't be posted to automatically. Jon posts those himself (the app has Copy and Open buttons) and marks them posted. Never say something was posted unless its status is "posted".
- Suggest replies to comments and reviews (save them with update_inbox) so Jon can copy them. Mark items done when Jon says they're handled.
- Jon's Today page is a one-click approval queue. queue_action adds a reply, post or task to it.
- Look at his trick names and upcoming shows for post ideas.

Rules:
- Never reveal how a trick works, in a post or a reply. Methods are secret, always.
- Never make up quotes, reviews, client names, numbers or credits. If you need a fact, ask Jon.
- Ask before deleting anything.
- Keep replies short and conversational. When you write a draft, save it with save_post and say so in a sentence; don't paste the whole post back unless Jon asks.
- When Jon asks "how are we doing", use social_overview and get_stats, and say what changed and what to do next in plain words.`;

const s = (description: string) => ({ type: "string", description });
export const SOCIAL_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "social_overview",
    description: "Everything at a glance: which accounts are connected, latest numbers with change over 30 days, comments/reviews waiting on Jon, posts due or coming up, number of drafts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_stats",
    description: "Daily history for one platform (followers, views, posts, plus extras like YouTube's recent and top videos).",
    input_schema: { type: "object", properties: { platform: { type: "string", enum: [...PLATFORMS] }, days: { type: "number", description: "How far back, default 30" } }, required: ["platform"] },
  },
  {
    name: "refresh_social",
    description: "Pull fresh numbers and comments from every connected platform now.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_inbox",
    description: "Comments, messages and reviews. needs_reply=true shows only the ones waiting on Jon.",
    input_schema: { type: "object", properties: { needs_reply: { type: "boolean" } } },
  },
  {
    name: "update_inbox",
    description: "Save a suggested reply on an inbox item, and/or mark it done (handled) or new again.",
    input_schema: { type: "object", properties: { id: { type: "string" }, suggested_reply: s("Reply text for Jon to copy"), status: { type: "string", enum: ["new", "done"] } }, required: ["id"] },
  },
  {
    name: "list_posts",
    description: "Jon's drafts, scheduled and posted posts.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: [...POST_STATUSES] } } },
  },
  {
    name: "save_post",
    description: "Create a post (omit id) or update one (give id). Only fields you include change. To schedule, set status 'scheduled' and scheduled_at.",
    input_schema: {
      type: "object",
      properties: {
        id: s("Existing post id to update"),
        text: s("The post text / caption"),
        platforms: { type: "array", items: { type: "string", enum: POST_PLATFORMS }, description: "Where it goes" },
        media: { type: "array", items: { type: "string" }, description: "Full replacement list of media keys (media/…) from photos Jon sent" },
        status: { type: "string", enum: [...POST_STATUSES] },
        scheduled_at: s("When to post, Eastern time: YYYY-MM-DDTHH:MM, or empty to clear"),
        notes: s("Private notes for Jon (e.g. which clip to use)"),
      },
    },
  },
  {
    name: "delete_post",
    description: "Delete a post. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "queue_action",
    description: "Put something in Jon's one-click approval queue on the Today page: a reply (with inbox_id and body), a post (body, platforms, when), or a task (title, link, body). Use when Jon asks you to line things up for later.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["reply", "post", "task"] }, title: s("Short command, e.g. 'Reply to Sam on YouTube'"), why: s("One line: why"),
        body: s("Reply text, caption, or text to paste"), inbox_id: s("For replies"), platforms: { type: "array", items: { type: "string", enum: POST_PLATFORMS } },
        when: s("Posts: Eastern YYYY-MM-DDTHH:MM"), link: s("Where Jon does it"),
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "list_tricks_brief",
    description: "Jon's show-ready tricks: name, category and what the audience sees (no methods). For post ideas.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "upcoming_shows",
    description: "Jon's dated set lists from today on: name, event, venue, date. For 'see you Saturday' or recap posts.",
    input_schema: { type: "object", properties: {} },
  },
];

const describePost = (p: Post) => ({
  id: p.id, status: p.status, platforms: p.platforms, text: p.text, media: p.media, notes: p.notes,
  scheduled_at: p.scheduled_at ? msToEastern(p.scheduled_at) : null,
  posted_at: p.posted_at ? msToEastern(p.posted_at) : null,
});
const describeInbox = (i: InboxItem) => ({
  id: i.id, platform: i.platform, kind: i.kind, author: i.author, text: i.text, on: i.context, when: msToEastern(i.at),
  status: i.status, jon_replied: !!i.replied, suggested_reply: i.suggested_reply || undefined,
});

export async function runSocialTool(env: Env, _origin: string, name: string, input: Json): Promise<{ result: string; step?: string; changed?: string }> {
  switch (name) {
    case "social_overview": {
      const o = await overview(env);
      return {
        result: JSON.stringify({
          ...o,
          accounts: o.accounts.map(({ platform, connected, how, last_sync, last_error }) => ({ platform, connected, how: how || undefined, last_sync: last_sync ? msToEastern(last_sync) : null, last_error: last_error || undefined })),
          numbers: Object.fromEntries(Object.entries(o.numbers).map(([k, v]) => [k, { ...v, extra: undefined }])),
          needs: o.needs.map(describeInbox),
          due: o.due.map(describePost),
          upcoming: o.upcoming.map(describePost),
          last_posted: o.last_posted ? msToEastern(o.last_posted) : null,
        }),
      };
    }
    case "get_stats": {
      const platform = String(input.platform) as Platform;
      const days = Math.min(400, Math.max(1, Number(input.days) || 30));
      const rows = (await statsSeries(env, days))[platform] ?? [];
      // Only the newest day's extras (videos lists) to keep it short.
      return { result: JSON.stringify(rows.map((r, i) => (i === rows.length - 1 ? r : { ...r, extra: undefined }))) };
    }
    case "refresh_social": {
      const res = await syncAll(env);
      return { result: JSON.stringify(res), step: "Refreshed numbers and comments", changed: "social" };
    }
    case "list_inbox": {
      const list = await listInbox(env, { status: input.needs_reply === true ? "needs" : undefined, limit: 60 });
      return { result: JSON.stringify(list.map(describeInbox)) };
    }
    case "update_inbox": {
      const it = await updateInbox(env, String(input.id), input);
      if (!it) return { result: "No inbox item with that id." };
      const step = input.status === "done" ? `Marked ${it.author || "a comment"} as handled` : typeof input.suggested_reply === "string" ? `Suggested a reply to ${it.author || "a comment"}` : "Updated an inbox item";
      return { result: JSON.stringify(describeInbox(it)), step, changed: "social" };
    }
    case "list_posts": {
      const all = await listPosts(env);
      const st = typeof input.status === "string" ? input.status : "";
      return { result: JSON.stringify(all.filter((p) => !st || p.status === st).slice(0, 60).map(describePost)) };
    }
    case "save_post": {
      const id = typeof input.id === "string" && input.id ? input.id : undefined;
      const fields: Json = { ...input };
      delete fields.id;
      const p = await savePost(env, fields, id);
      const what = p.status === "scheduled" && p.scheduled_at ? `Scheduled a post for ${msToEastern(p.scheduled_at).replace("T", " ")}` : `${id ? "Updated" : "Saved"} a ${p.status === "posted" ? "posted" : "draft"} post`;
      return { result: JSON.stringify(describePost(p)), step: what, changed: "social" };
    }
    case "delete_post": {
      if (!(await deletePost(env, String(input.id)))) return { result: "No post with that id." };
      return { result: "Deleted.", step: "Deleted a post", changed: "social" };
    }
    case "queue_action": {
      const a = await queueAction(env, input);
      if (!a) return { result: "Not added: it's a duplicate, or the inbox id is wrong." };
      return { result: JSON.stringify({ id: a.id }), step: `Added to your queue: ${a.title}`, changed: "social" };
    }
    case "list_tricks_brief": {
      const tricks = (await data.listTricks(env)).filter((t) => t.status === "ready");
      return { result: JSON.stringify(tricks.map((t) => ({ name: t.name, category: t.category, effect: t.effect, audiences: t.audiences }))) };
    }
    case "upcoming_shows": {
      const t = today();
      const sets = (await data.listSetlists(env)).filter((x) => x.date && x.date >= t).sort((a, b) => a.date.localeCompare(b.date));
      return { result: JSON.stringify(sets.map((x) => ({ name: x.name, event: x.event, venue: x.venue, date: x.date }))) };
    }
    default:
      return { result: `Unknown tool ${name}.` };
  }
}

// ---------- the approval queue ----------
// The assistant proposes small actions (a reply it wrote, a post it drafted and timed, a profile
// fix). Jon approves or skips each in one click on the Today page. Approving never posts on its
// own for platforms that aren't connected: the page copies the text and opens the right place.

export interface Action { id: string; kind: string; title: string; why: string; body: string; platform: string; link: string; inbox_id: string | null; when_at: number | null; extra: Json; status: string; created_at: number; decided_at: number | null }
const ACTION_KINDS = ["reply", "post", "task"] as const;
const MAX_OPEN = 8;

async function setting(env: Env, key: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}
async function putSetting(env: Env, key: string, value: string) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export async function listActions(env: Env, status = "proposed"): Promise<Action[]> {
  const { results } = await env.DB.prepare("SELECT * FROM social_actions WHERE status = ? ORDER BY created_at DESC LIMIT 50").bind(status).all<Json>();
  const order = { reply: 0, post: 1, task: 2 } as Record<string, number>;
  return results.map((r) => ({ ...(r as unknown as Action), extra: parseObj(r.extra) })).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

/** Adds one proposal to the queue (validated). Returns null when it's a duplicate or invalid. */
export async function queueAction(env: Env, a: Json): Promise<Action | null> {
  const kind = String(a.kind);
  if (!ACTION_KINDS.includes(kind as (typeof ACTION_KINDS)[number])) return null;
  const title = String(a.title ?? "").trim().slice(0, 200);
  if (!title) return null;
  let inboxId: string | null = null;
  let link = typeof a.link === "string" && /^https?:\/\//.test(a.link) ? a.link.slice(0, 500) : "";
  let platform = PLATFORMS.includes(a.platform as Platform) ? String(a.platform) : "";
  if (kind === "reply") {
    const it = await env.DB.prepare("SELECT * FROM social_inbox WHERE id = ?").bind(String(a.inbox_id ?? "")).first<InboxItem>();
    if (!it) return null;
    const dupe = await env.DB.prepare("SELECT id FROM social_actions WHERE inbox_id = ? AND status = 'proposed'").bind(it.id).first();
    if (dupe) return null;
    inboxId = it.id;
    link = it.url;
    platform = it.platform;
  } else {
    const dupe = await env.DB.prepare("SELECT id FROM social_actions WHERE title = ? AND (status = 'proposed' OR decided_at > ?)").bind(title, now() - 45 * 864e5).first();
    if (dupe) return null; // already open, or Jon decided on it in the last 45 days
  }
  let whenAt: number | null = null;
  if (kind === "post" && typeof a.when === "string" && a.when) whenAt = easternToMs(a.when);
  const platforms = Array.isArray(a.platforms) ? a.platforms.filter((x): x is string => POST_PLATFORMS.includes(x as Platform)) : platform ? [platform] : [];
  const row: Action = {
    id: data.newId(), kind, title, why: String(a.why ?? "").slice(0, 400), body: String(a.body ?? "").slice(0, 5000), platform, link,
    inbox_id: inboxId, when_at: whenAt, extra: { platforms }, status: "proposed", created_at: now(), decided_at: null,
  };
  await env.DB.prepare(
    "INSERT INTO social_actions (id, kind, title, why, body, platform, link, inbox_id, when_at, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(row.id, row.kind, row.title, row.why, row.body, row.platform, row.link, row.inbox_id, row.when_at, JSON.stringify(row.extra), row.created_at).run();
  return row;
}

/** Approve or skip. Approving a post schedules it; a reply marks the comment handled; a task lands in Backstage Tasks. */
export async function decideAction(env: Env, id: string, decision: string, edits: Json = {}): Promise<{ ok: true; post_id?: string; task_id?: string } | null> {
  const a = (await listActions(env)).find((x) => x.id === id);
  if (!a) return null;
  const body = typeof edits.body === "string" ? edits.body.slice(0, 5000) : a.body;
  const out: { ok: true; post_id?: string; task_id?: string } = { ok: true };
  if (decision === "approve") {
    if (a.kind === "reply" && a.inbox_id) {
      await env.DB.prepare("UPDATE social_inbox SET status = 'done', suggested_reply = ? WHERE id = ?").bind(body, a.inbox_id).run();
    } else if (a.kind === "post") {
      const platforms = parseList(JSON.stringify((a.extra as Json).platforms ?? []));
      const when = typeof edits.when_at === "number" ? edits.when_at : a.when_at;
      const p = await savePost(env, { text: body, platforms, status: when ? "scheduled" : "draft", scheduled_at: when ?? null, notes: a.why });
      out.post_id = p.id;
    } else if (a.kind === "task") {
      const t = await data.saveTask(env, { title: a.title, notes: [a.why, body, a.link].filter(Boolean).join("\n\n") });
      out.task_id = t.id;
    }
  } else if (decision !== "skip") {
    throw new data.InputError("Decision must be approve or skip.");
  }
  await env.DB.prepare("UPDATE social_actions SET status = ?, body = ?, decided_at = ? WHERE id = ?").bind(decision === "approve" ? "done" : "skipped", body, now(), id).run();
  return out;
}

// Profile fixes from the 2026-10-14 audit, for the assistant to propose one or two at a time.
const KNOWN_FIXES = `- Google Business Profile: Google asks Jon to re-verify (until then edits don't show, no stats, can't reply to reviews). Link: https://www.google.com/search?q=jon+mobley+magician → "Get verified". Top priority.
- Google Business Profile name is "Jon Mobley | Indianapolis Magician and Event Emcee" (keyword stuffing, against Google's rules). Should be "Jon Mobley". Do after re-verifying.
- Google Business Profile "Areas served" only lists Noblesville; add Indianapolis, Carmel, Fishers, Westfield, Zionsville, Greenwood, central Indiana.
- Instagram bio link points to YouTube; change to https://jonmobley.com/booking. Instagram's last post was 2026-03-14.
- YouTube channel description is just "Magician"; write a real one with "Book Jon: jonmobley.com/booking". Pin a comment with the booking link on the 1.1M-view Fool Us video (https://youtu.be/I_7CWHIjhqc or the S11E18 CW clip).
- Facebook page hours say "Always open"; set "By appointment". Latest Facebook post ~11 months old.
- LinkedIn headline "Creative storyteller…" doesn't say magician/emcee; suggest "Magician, comedian and emcee for corporate events | Penn & Teller: Fool Us".
- Ask recent clients for Google reviews that mention the event type (corporate party, gala, wedding).`;

const PROPOSER = `${"You plan Jon Mobley's online presence. Look at the snapshot and propose the few actions that matter most this week, for Jon to approve or skip in one click. He spends about a minute a day on this, so fewer, better items beat many."}

Kinds:
- reply: a ready-to-send reply to one inbox item (give inbox_id). Warm, short, in Jon's voice; thank people; for booking questions point to https://jonmobley.com/booking. Skip spam or items that need no reply.
- post: a ready-to-post caption for one or more platforms, with a suggested time (Eastern, YYYY-MM-DDTHH:MM, in the next 7 days; weekday evenings 6-8pm or lunchtime work well). Base it on real things: his credits, upcoming shows, his videos. Say in "why" what photo or clip to use. Never invent facts, quotes or clients.
- task: a one-off fix Jon does himself (a profile setting, asking for reviews), with a link to where he does it. Body = the exact text to paste, when there is one.

Comments on the viral Fool Us video are often people guessing the method: never confirm, deny or hint; either skip them or reply with light, gracious humour that gives nothing away. Prefer replies that build goodwill or answer real questions (especially anything about booking). Rules: at most {LIMIT} new items. Replies first (oldest waiting), then at most 2 posts, then at most 1-2 tasks. Never repeat something already open or recently decided. Never reveal how a trick works. Titles are short commands ("Reply to Sam on YouTube", "Post the Fool Us clip on Instagram", "Fix your Instagram bio link").`;

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose",
  description: "Add actions to Jon's approval queue.",
  input_schema: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...ACTION_KINDS] },
            title: { type: "string" },
            why: { type: "string", description: "One short line: why this matters now" },
            body: { type: "string", description: "Reply text, post caption, or text to paste" },
            inbox_id: { type: "string" },
            platforms: { type: "array", items: { type: "string", enum: POST_PLATFORMS } },
            platform: { type: "string", enum: [...PLATFORMS] },
            when: { type: "string", description: "Posts: Eastern time YYYY-MM-DDTHH:MM" },
            link: { type: "string" },
          },
          required: ["kind", "title", "why"],
        },
      },
    },
    required: ["actions"],
  },
};

const PROPOSE_EVERY_MS = 12 * 60 * 60 * 1000;
export async function proposeIsDue(env: Env): Promise<boolean> {
  return now() - (Number(await setting(env, "social_last_proposed")) || 0) > PROPOSE_EVERY_MS;
}

/** Asks Claude for new proposals and queues them. Returns how many were added. */
export async function proposeActions(env: Env): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("Suggestions need the Anthropic API key.");
  await putSetting(env, "social_last_proposed", String(now()));
  const open = await listActions(env);
  const room = MAX_OPEN - open.length;
  if (room <= 0) return 0;
  const [o, posts, decided, shows] = await Promise.all([
    overview(env),
    listPosts(env),
    env.DB.prepare("SELECT kind, title, status FROM social_actions WHERE decided_at > ? ORDER BY decided_at DESC LIMIT 40").bind(now() - 60 * 864e5).all<Json>(),
    runSocialTool(env, "", "upcoming_shows", {}),
  ]);
  const yt = o.numbers.youtube?.extra as Json | undefined;
  const snapshot = {
    today: msToEastern(now()),
    accounts: o.accounts.map((a) => ({ platform: a.platform, connected: a.connected })),
    numbers: Object.fromEntries(Object.entries(o.numbers).map(([k, v]) => [k, { followers: v.followers, views: v.views, posts: v.posts, change: v.change, since: v.since }])),
    youtube_videos: { top: yt?.top, recent: yt?.recent },
    inbox_waiting: o.needs.filter((i) => !open.some((a) => a.inbox_id === i.id)).map(describeInbox),
    posts: posts.slice(0, 20).map(describePost),
    upcoming_shows: JSON.parse(shows.result),
    already_open: open.map((a) => ({ kind: a.kind, title: a.title })),
    recently_decided: decided.results,
    known_profile_fixes: KNOWN_FIXES,
  };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  const msg = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: `${SOCIAL_SYSTEM}\n\n${PROPOSER.replace("{LIMIT}", String(Math.min(room, 6)))}`,
    tools: [PROPOSE_TOOL],
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: `Snapshot:\n${JSON.stringify(snapshot)}\n\nCall propose once with your picks (an empty list is fine if nothing is worth Jon's time).` }],
  });
  const use = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const proposed = ((use?.input as Json | undefined)?.actions as Json[] | undefined) ?? [];
  let added = 0;
  for (const a of proposed.slice(0, room)) if (await queueAction(env, a)) added++;
  return added;
}

/** Background refresh when the page opens: new numbers and comments, then new proposals. */
export async function refreshInBackground(env: Env) {
  await syncAll(env);
  if (await proposeIsDue(env)) await proposeActions(env).catch((e) => console.error("propose failed", e));
}
