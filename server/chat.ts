// The Backstage chat: Claude with tools over Jon's tricks, set lists and playlists.
// Streams newline-delimited JSON events to the browser:
//   {t:"text", d}  reply text as it's written     {t:"step", d}  a change Claude made
//   {t:"changed", what}  which library lists to reload   {t:"error", d}   {t:"done"}
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import * as data from "./data";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 12;

type Msg = Anthropic.Beta.BetaMessageParam;
type Json = Record<string, unknown>;

export interface ViewMessage { role: "user" | "assistant"; text: string; images?: string[]; steps?: string[]; at: number }
export interface ChatFile { history: Msg[]; view: ViewMessage[] }

const SYSTEM = `You are Backstage, the private assistant inside jonmobley.com for Jon Mobley — a working magician, comedian and emcee from Indianapolis (Penn & Teller: Fool Us, The CW, Chicago Magic Lounge). Only Jon can reach you; he is signed in.

You manage his library with the tools:
- Tricks: his inventory of effects and props. Fields: name, category (e.g. close-up, parlor, stage, mentalism, kids), status (ready = show-ready, learning, wishlist = wants to buy, retired), effect (what the audience sees), method (how it works — private), props (what to pack), reset (prep/reset), duration_min, location (which case or shelf), source (maker/dealer), cost (USD), audiences, tags, links, images, notes.
- Set lists: an ordered running order for a show (event, venue, date). Items point at a trick (trick_id) or are a free-text bit (title), each with optional duration_min and notes. Total length = sum of durations, falling back to each trick's duration.
- Playlists: music and sound cues, optionally tied to a set list. Tracks have title, artist, url, cue (when to play), duration_sec, and optional trick_id.

How to work:
- Look things up before changing them; never invent ids. Use the id returned by a tool.
- Act on clear requests without asking. When Jon sends a photo of a prop, a receipt or a page from a catalog, read it and fill in what you can; attach the photo to the trick if he wants it saved.
- Ask before deleting anything, and before replacing a whole set list or playlist he didn't ask to rebuild.
- When building a set, think like a working pro: strong opener, build, a closer that lands; mind resets, angles and the audience. Keep to the requested length.
- Keep replies short and conversational. Say what you changed in a sentence; don't repeat whole records back. Use simple Markdown (bold, lists) only when it helps.
- Methods are Jon's private notes: discuss them freely with him, but never write them anywhere public.`;

const strProp = (description: string) => ({ type: "string", description });
const TRICK_FIELDS = {
  name: strProp("Trick name"),
  category: strProp("Category, e.g. close-up, parlor, stage, mentalism, kids"),
  status: { type: "string", enum: [...data.STATUSES], description: "ready, learning, wishlist or retired" },
  effect: strProp("What the audience sees"),
  method: strProp("How it works (private)"),
  props: strProp("What to pack"),
  reset: strProp("Prep and reset notes"),
  duration_min: { type: ["number", "null"], description: "Running time in minutes" },
  location: strProp("Where it's stored (case, shelf)"),
  source: strProp("Maker, dealer or where it came from"),
  cost: { type: ["number", "null"], description: "Cost in USD" },
  audiences: { type: "array", items: { type: "string" }, description: "e.g. corporate, family, kids, adults" },
  tags: { type: "array", items: { type: "string" } },
  links: {
    type: "array",
    items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } }, required: ["url"] },
    description: "Full replacement list of links (tutorial videos, dealer pages, scripts)",
  },
  images: { type: "array", items: { type: "string" }, description: "Full replacement list of media keys (media/…)" },
  notes: strProp("Anything else"),
};

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_tricks",
    description: "List tricks in the inventory, optionally filtered. Returns a compact summary of each (no methods). Call with no filters to see everything.",
    input_schema: {
      type: "object",
      properties: {
        query: strProp("Words to match in name, category, effect, props, tags, location or notes"),
        status: { type: "string", enum: [...data.STATUSES] },
      },
    },
  },
  {
    name: "get_trick",
    description: "Get every field of one trick, including method and links.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "save_trick",
    description: "Create a trick (omit id) or update one (give id). Only the fields you include change. To add a photo, pass add_images with media keys from the chat.",
    input_schema: {
      type: "object",
      properties: { id: strProp("Existing trick id to update"), ...TRICK_FIELDS, add_images: { type: "array", items: { type: "string" } } },
    },
  },
  {
    name: "delete_trick",
    description: "Permanently delete a trick. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_setlists",
    description: "List set lists with their running order (trick names resolved) and total length.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_setlist",
    description: "Create a set list (omit id) or update one (give id). Only the fields you include change; items, when given, replaces the whole running order.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        event: { type: "string" },
        venue: { type: "string" },
        date: strProp("YYYY-MM-DD, or empty"),
        notes: { type: "string" },
        items: {
          type: "array",
          description: "Running order. Each item has trick_id (a trick) or title (a free-text bit like 'Intro' or 'Q&A').",
          items: {
            type: "object",
            properties: {
              trick_id: { type: "string" },
              title: { type: "string" },
              duration_min: { type: ["number", "null"] },
              notes: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "delete_setlist",
    description: "Permanently delete a set list. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_playlists",
    description: "List playlists with their tracks.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_playlist",
    description: "Create a playlist (omit id) or update one (give id). Only the fields you include change; tracks, when given, replaces the whole list.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        setlist_id: { type: ["string", "null"] },
        tracks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: strProp("Keep an existing track's id when reordering or editing it"),
              title: { type: "string" },
              artist: { type: "string" },
              url: { type: "string" },
              file_key: strProp("Uploaded audio key (media/…), keep as is"),
              duration_sec: { type: ["number", "null"] },
              cue: strProp("When to play it"),
              trick_id: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
    },
  },
  {
    name: "delete_playlist",
    description: "Permanently delete a playlist. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

function summary(t: data.Trick) {
  return {
    id: t.id, name: t.name, category: t.category || undefined, status: t.status,
    duration_min: t.duration_min ?? undefined, location: t.location || undefined,
    audiences: t.audiences.length ? t.audiences : undefined, tags: t.tags.length ? t.tags : undefined,
    effect: t.effect ? t.effect.slice(0, 160) : undefined, images: t.images.length || undefined,
  };
}

const idOf = (input: Json) => (typeof input.id === "string" && input.id ? input.id : undefined);

/** Runs one tool. Returns the result text, a human summary for the chat, and which lists changed. */
async function runTool(env: Env, name: string, input: Json): Promise<{ result: string; step?: string; changed?: string }> {
  switch (name) {
    case "search_tricks": {
      const q = typeof input.query === "string" ? input.query.toLowerCase().trim() : "";
      const words = q.split(/\s+/).filter(Boolean);
      const all = await data.listTricks(env);
      const hits = all.filter((t) => {
        if (input.status && t.status !== input.status) return false;
        const hay = [t.name, t.category, t.effect, t.props, t.location, t.notes, t.source, ...t.tags, ...t.audiences].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      return { result: JSON.stringify({ total_in_inventory: all.length, matches: hits.map(summary) }) };
    }
    case "get_trick": {
      const t = await data.getTrick(env, String(input.id));
      return { result: t ? JSON.stringify(t) : "No trick with that id." };
    }
    case "save_trick": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      delete fields.add_images;
      if (Array.isArray(input.add_images)) {
        const current = id ? (await data.getTrick(env, id))?.images ?? [] : [];
        fields.images = [...(Array.isArray(fields.images) ? (fields.images as string[]) : current), ...(input.add_images as string[])];
      }
      const t = await data.saveTrick(env, fields, id);
      return { result: JSON.stringify(summary(t)), step: `${id ? "Updated" : "Added"} trick “${t.name}”`, changed: "tricks" };
    }
    case "delete_trick": {
      const t = await data.getTrick(env, String(input.id));
      if (!t || !(await data.deleteTrick(env, t.id))) return { result: "No trick with that id." };
      return { result: "Deleted.", step: `Deleted trick “${t.name}”`, changed: "tricks" };
    }
    case "list_setlists": {
      const [sets, tricks] = await Promise.all([data.listSetlists(env), data.listTricks(env)]);
      const byId = new Map(tricks.map((t) => [t.id, t]));
      return {
        result: JSON.stringify(sets.map((s) => {
          const items = s.items.map((i) => {
            const t = i.trick_id ? byId.get(i.trick_id) : undefined;
            return { ...i, name: t?.name ?? i.title ?? "(deleted trick)", duration_min: i.duration_min ?? t?.duration_min ?? null };
          });
          return { ...s, items, total_min: items.reduce((n, i) => n + (i.duration_min ?? 0), 0) };
        })),
      };
    }
    case "save_setlist": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      const s = await data.saveSetlist(env, fields, id);
      return { result: JSON.stringify({ id: s.id, name: s.name, items: s.items.length }), step: `${id ? "Updated" : "Created"} set list “${s.name}”`, changed: "setlists" };
    }
    case "delete_setlist": {
      const s = await data.getSetlist(env, String(input.id));
      if (!s || !(await data.deleteSetlist(env, s.id))) return { result: "No set list with that id." };
      return { result: "Deleted.", step: `Deleted set list “${s.name}”`, changed: "setlists" };
    }
    case "list_playlists":
      return { result: JSON.stringify(await data.listPlaylists(env)) };
    case "save_playlist": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      const p = await data.savePlaylist(env, fields, id);
      return { result: JSON.stringify({ id: p.id, name: p.name, tracks: p.tracks.length }), step: `${id ? "Updated" : "Created"} playlist “${p.name}”`, changed: "playlists" };
    }
    case "delete_playlist": {
      const p = await data.getPlaylist(env, String(input.id));
      if (!p || !(await data.deletePlaylist(env, p.id))) return { result: "No playlist with that id." };
      return { result: "Deleted.", step: `Deleted playlist “${p.name}”`, changed: "playlists" };
    }
    default:
      return { result: `Unknown tool ${name}.` };
  }
}

// ---------- storage: chat list in D1, transcript in R2 ----------

const chatKey = (id: string) => `chats/${id}.json`;

export async function loadChat(env: Env, id: string): Promise<ChatFile | null> {
  const obj = await env.MEDIA.get(chatKey(id));
  return obj ? ((await obj.json()) as ChatFile) : null;
}

async function saveChat(env: Env, id: string, file: ChatFile, title?: string) {
  await env.MEDIA.put(chatKey(id), JSON.stringify(file), { httpMetadata: { contentType: "application/json" } });
  if (title) await env.DB.prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?").bind(title, Date.now(), id).run();
  else await env.DB.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").bind(Date.now(), id).run();
}

export async function deleteChat(env: Env, id: string) {
  await env.DB.prepare("DELETE FROM chats WHERE id = ?").bind(id).run();
  await env.MEDIA.delete(chatKey(id));
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const VISION_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Handles one user message: streams Claude's reply and saves the transcript. */
export function streamReply(env: Env, chatId: string, text: string, imageKeys: string[], today: string): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: Json) => writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});

  (async () => {
    const file = (await loadChat(env, chatId)) ?? { history: [], view: [] };
    const isFirst = file.view.length === 0;
    const steps: string[] = [];
    let replyText = "";
    let lastGood = file.history.length; // history is only ever cut back to a valid point

    try {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      for (const key of imageKeys) {
        const obj = await env.MEDIA.get(key);
        const type = obj?.httpMetadata?.contentType as (typeof VISION_TYPES)[number] | undefined;
        if (!obj || !type || !VISION_TYPES.includes(type)) continue;
        content.push({ type: "image", source: { type: "base64", media_type: type, data: toBase64(await obj.arrayBuffer()) } });
        content.push({ type: "text", text: `(That photo is saved as ${key} — use this key to attach it to a trick.)` });
      }
      content.push({ type: "text", text: `${text || "(photo only)"}\n\n(Today is ${today}.)` });
      file.history.push({ role: "user", content });
      file.view.push({ role: "user", text, images: imageKeys.length ? imageKeys : undefined, at: Date.now() });
      lastGood = file.history.length;

      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("Chat isn't switched on yet: the site needs an Anthropic API key (ANTHROPIC_API_KEY).");
      }
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          tools: TOOLS,
          messages: file.history,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
        stream.on("text", (delta) => {
          replyText += delta;
          send({ t: "text", d: delta });
        });
        const message = await stream.finalMessage();

        if (message.stop_reason === "refusal") {
          throw new Error("Claude declined to answer that one.");
        }
        file.history.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
        if (message.stop_reason === "pause_turn") continue;

        const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (toolUses.length === 0 || message.stop_reason !== "tool_use") {
          lastGood = file.history.length;
          break;
        }
        if (replyText && !replyText.endsWith("\n")) {
          replyText += "\n\n";
          send({ t: "text", d: "\n\n" });
        }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        const changed = new Set<string>();
        for (const use of toolUses) {
          try {
            const out = await runTool(env, use.name, (use.input ?? {}) as Json);
            results.push({ type: "tool_result", tool_use_id: use.id, content: out.result });
            if (out.step) {
              steps.push(out.step);
              send({ t: "step", d: out.step });
            }
            if (out.changed) changed.add(out.changed);
          } catch (err) {
            const msg = err instanceof data.InputError ? err.message : "That didn't work because of a server error.";
            if (!(err instanceof data.InputError)) console.error("tool failed", use.name, err);
            results.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
          }
        }
        if (changed.size) send({ t: "changed", what: [...changed] });
        file.history.push({ role: "user", content: results });
        lastGood = file.history.length;
      }
    } catch (err) {
      file.history.length = lastGood;
      let msg: string;
      if (err instanceof Anthropic.AuthenticationError) msg = "The Anthropic API key was rejected. It needs replacing.";
      else if (err instanceof Anthropic.RateLimitError) msg = "Claude is busy right now. Try again in a minute.";
      else if (err instanceof Anthropic.APIError) msg = `Claude had a problem (${err.status ?? "network"}). Try again.`;
      else msg = err instanceof Error ? err.message : "Something went wrong.";
      console.error("chat failed", err);
      replyText += (replyText ? "\n\n" : "") + `⚠️ ${msg}`;
      send({ t: "error", d: msg });
    }

    file.view.push({ role: "assistant", text: replyText, steps: steps.length ? steps : undefined, at: Date.now() });
    const title = isFirst ? (text || "Photo").replace(/\s+/g, " ").slice(0, 60) : undefined;
    await saveChat(env, chatId, file, title).catch((e) => console.error("save chat failed", e));
    send({ t: "done" });
    await writer.close().catch(() => {});
  })();

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
