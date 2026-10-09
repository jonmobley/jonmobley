// All /api/* requests for /backstage. Everything except sign-in needs the session cookie.
import type { Env } from "../../server/env";
import * as auth from "../../server/auth";
import * as data from "../../server/data";
import * as chat from "../../server/chat";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
const fail = (error: string, status = 400) => json({ error }, status);

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
} as const;

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
  if (id && m === "DELETE") return (await c.remove(env, id)) ? json({ ok: true }) : fail("Not found.", 404);
  return fail("Not allowed.", 405);
}

async function media(request: Request, env: Env, key: string): Promise<Response> {
  const range = request.headers.get("Range");
  const obj = await env.MEDIA.get(key, range ? { range: request.headers } : undefined);
  if (!obj) return fail("Not found.", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const name = obj.customMetadata?.name;
  if (name) headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
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

    // Writes must come from our own page (blocks cross-site form posts).
    if (method !== "GET" && method !== "HEAD" && request.headers.get("X-Backstage") !== "1") {
      return fail("Missing request header.", 403);
    }

    if (section === "login" && method === "POST") {
      const { password } = await body(request);
      const result = await auth.login(request, env, typeof password === "string" ? password : "");
      if ("error" in result) return fail(result.error, result.status);
      return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
    }
    if (section === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": auth.clearCookie() });
    }

    if (!(await auth.isSignedIn(request, env))) return fail("Please sign in.", 401);

    switch (section) {
      case "password": {
        if (method !== "POST") break;
        const b = await body(request);
        const result = await auth.changePassword(env, String(b.current ?? ""), String(b.next ?? ""));
        if ("error" in result) return fail(result.error);
        return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
      }
      case "tricks":
      case "setlists":
      case "playlists":
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
          return chat.streamReply(env, waitUntil, id, text, images, today);
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
