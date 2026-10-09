// All /api/* requests for /backstage. Everything except sign-in needs the session cookie.
import type { Env } from "../../server/env";
import * as auth from "../../server/auth";
import * as data from "../../server/data";
import * as chat from "../../server/chat";
import * as shares from "../../server/shares";
import * as stats from "../../server/stats";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
const fail = (error: string, status = 400) => json({ error }, status);
// The live site is https, where the cookie is Secure. Local http previews (Safari) drop Secure cookies.
const cookieFor = (request: Request, cookie: string) =>
  new URL(request.url).protocol === "https:" ? cookie : cookie.replace("; Secure", "");

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// One table per collection so tricks, set lists and playlists behave the same way.
const collections = {
  tricks: { list: data.listTricks, get: data.getTrick, save: data.saveTrick, remove: data.deleteTrick },
  setlists: { list: data.listSetlists, get: data.getSetlist, save: data.saveSetlist, remove: data.deleteSetlist },
  playlists: { list: data.listPlaylists, get: data.getPlaylist, save: data.savePlaylist, remove: data.deletePlaylist },
  equipment: { list: data.listEquipment, get: data.getEquipment, save: data.saveEquipment, remove: data.deleteEquipment },
  files: { list: data.listFiles, get: data.getFile, save: data.saveFile, remove: data.deleteFile },
  links: { list: data.listLinks, get: data.getLink, save: data.saveLink, remove: data.deleteLink },
  tasks: { list: data.listTasks, get: data.getTask, save: data.saveTask, remove: data.deleteTask },
  notes: { list: data.listNotes, get: data.getNote, save: data.saveNote, remove: data.deleteNote },
} as const;

const SHARE_KIND = { tricks: "trick", setlists: "setlist", playlists: "playlist" } as const;

async function collection(request: Request, env: Env, name: keyof typeof collections, id?: string): Promise<Response> {
  const c = collections[name];
  const m = request.method;
  if (!id && m === "GET") return json(await c.list(env));
  if (!id && m === "POST") return json(await c.save(env, await body(request)), 201);
  if (id && m === "GET") {
    const item = await c.get(env, id);
    return item ? json(item) : fail("Not found.", 404);
  }
  if (id && m === "PUT") return json(await c.save(env, await body(request), id));
  if (id && m === "DELETE") {
    if (!(await c.remove(env, id))) return fail("Not found.", 404);
    if (name in SHARE_KIND) await shares.deleteShare(env, SHARE_KIND[name as keyof typeof SHARE_KIND], id);
    return json({ ok: true });
  }
  return fail("Not allowed.", 405);
}

async function media(request: Request, env: Env, key: string, cache = "private, max-age=31536000, immutable"): Promise<Response> {
  const range = request.headers.get("Range");
  const obj = await env.MEDIA.get(key, range ? { range: request.headers } : undefined);
  if (!obj) return fail("Not found.", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", cache);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const name = obj.customMetadata?.name;
  const opens = /^(image\/(?!vnd)|audio\/|video\/|application\/pdf|text\/plain)/.test(obj.httpMetadata?.contentType || "");
  const disposition = opens ? "inline" : "attachment";
  if (name) headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (range && obj.range && "offset" in obj.range) {
    const start = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - start;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const parts = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean) as string[];
  const [section, id, sub] = parts;
  const method = request.method;

  try {
    if (section === "session" && method === "GET") {
      return json({ signedIn: await auth.isSignedIn(request, env), passwordSet: await auth.hasPassword(env) });
    }

    // Share links: view-only, no sign-in. /api/shared/<token> and /api/shared/<token>/media/<file>
    if (section === "shared" && id && method === "GET") {
      const view = await shares.sharedView(env, id);
      if (!view) return fail("This link has been turned off.", 404);
      if (!sub) return json({ kind: view.kind, data: view.data });
      const file = parts[3];
      const key = `media/${file}`;
      if (sub !== "media" || !file || !view.media.includes(key)) return fail("Not found.", 404);
      return await media(request, env, key, "private, max-age=300");
    }

    // Writes must come from our own page (blocks cross-site form posts).
    if (method !== "GET" && method !== "HEAD" && request.headers.get("X-Backstage") !== "1") {
      return fail("Missing request header.", 403);
    }

    if (section === "login" && method === "POST") {
      const { password } = await body(request);
      const result = await auth.login(request, env, typeof password === "string" ? password : "");
      if ("error" in result) return fail(result.error, result.status);
      return json({ ok: true }, 200, { "Set-Cookie": cookieFor(request, result.cookie) });
    }
    if (section === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": cookieFor(request, auth.clearCookie()) });
    }

    if (!(await auth.isSignedIn(request, env))) return fail("Please sign in.", 401);

    switch (section) {
      case "password": {
        if (method !== "POST") break;
        const b = await body(request);
        const result = await auth.changePassword(env, String(b.current ?? ""), String(b.next ?? ""));
        if ("error" in result) return fail(result.error);
        return json({ ok: true }, 200, { "Set-Cookie": cookieFor(request, result.cookie) });
      }
      case "stats": {
        if (method !== "GET") break;
        const days = Math.min(400, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
        return json(await stats.summary(env, days));
      }
      case "shares": {
        // /api/shares/<kind>/<item id>: GET the link (or null), POST to turn it on, DELETE to turn it off.
        const kind = id as shares.Kind;
        if (!shares.KINDS.includes(kind) || !sub) break;
        const origin = new URL(request.url).origin;
        const out = (s: shares.Share | null) => json(s ? { url: shares.shareUrl(origin, s.token), created_at: s.created_at } : null);
        if (method === "GET") return out(await shares.getShare(env, kind, sub));
        if (method === "POST") return out(await shares.createShare(env, kind, sub));
        if (method === "DELETE") {
          await shares.deleteShare(env, kind, sub);
          return json({ ok: true });
        }
        break;
      }
      case "tricks":
      case "setlists":
      case "playlists":
      case "tasks":
      case "notes":
      case "equipment":
      case "files":
      case "links":
        return await collection(request, env, section, id);
      case "media": {
        if (method === "POST" && !id) {
          const form = await request.formData();
          const file = form.get("file");
          if (!file || typeof file === "string") return fail("No file was sent.");
          return json(await data.putMedia(env, file), 201);
        }
        // /api/media/media/<uuid>.<ext>
        if (method === "GET" && id === "media" && sub && /^[a-f0-9-]+\.[a-z0-9]+$/.test(sub)) {
          return await media(request, env, `media/${sub}`);
        }
        break;
      }
      case "chats": {
        if (!id && method === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM chats ORDER BY updated_at DESC LIMIT 100").all();
          return json(results);
        }
        if (!id && method === "POST") {
          const chatId = data.newId();
          const now = Date.now();
          await env.DB.prepare("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, 'New chat', ?, ?)")
            .bind(chatId, now, now).run();
          return json({ id: chatId, title: "New chat", created_at: now, updated_at: now }, 201);
        }
        if (!id) break;
        const exists = await env.DB.prepare("SELECT id FROM chats WHERE id = ?").bind(id).first();
        if (!exists) return fail("That chat doesn't exist.", 404);
        if (!sub && method === "GET") return json({ messages: (await chat.loadChat(env, id))?.view ?? [] });
        if (!sub && method === "DELETE") {
          await chat.deleteChat(env, id);
          return json({ ok: true });
        }
        if (sub === "messages" && method === "POST") {
          const b = await body(request);
          const text = typeof b.text === "string" ? b.text.trim().slice(0, 20000) : "";
          const images = Array.isArray(b.images)
            ? b.images.filter((k): k is string => typeof k === "string" && /^media\/[a-f0-9-]+\.(jpg|png|webp|gif)$/.test(k)).slice(0, 6)
            : [];
          if (!text && !images.length) return fail("Type a message first.");
          const today = typeof b.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
          return chat.streamReply(env, waitUntil, new URL(request.url).origin, id, text, images, today);
        }
        break;
      }
    }
    return fail("Not found.", 404);
  } catch (err) {
    if (err instanceof data.InputError) return fail(err.message);
    console.error("api error", err);
    return fail("Something went wrong on the server.", 500);
  }
};
