// Tricks, set lists and playlists. Used by both the REST API and the chat assistant,
// so every write goes through the same cleaning rules.
import type { Env } from "./env";

export const STATUSES = ["ready", "learning", "wishlist", "retired"] as const;

type Json = Record<string, unknown>;

export interface Link { label: string; url: string }
export interface Trick {
  id: string; name: string; category: string; status: string; effect: string; method: string;
  props: string; reset: string; duration_min: number | null; location: string; source: string;
  cost: number | null; purchase_url: string; audiences: string[]; tags: string[]; links: Link[]; images: string[];
  notes: string; created_at: number; updated_at: number;
}
export interface SetItem { id: string; trick_id?: string; title?: string; duration_min?: number | null; notes?: string }
export interface Setlist {
  id: string; name: string; event: string; venue: string; date: string; notes: string;
  items: SetItem[]; equipment: string[]; created_at: number; updated_at: number;
}
export interface Track {
  id: string; title: string; artist?: string; url?: string; file_key?: string;
  duration_sec?: number | null; cue?: string; trick_id?: string;
}
export interface Playlist {
  id: string; name: string; description: string; setlist_id: string | null;
  tracks: Track[]; created_at: number; updated_at: number;
}

export class InputError extends Error {}

export const newId = () => crypto.randomUUID();

// ---------- cleaning helpers ----------

const str = (v: unknown, max = 20000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optStr = (v: unknown, max = 20000): string | undefined => {
  const s = str(v, max);
  return s ? s : undefined;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, 60)).filter(Boolean))].slice(0, 30) : [];

function safeUrl(v: unknown): string | undefined {
  const s = str(v, 2000);
  if (!s) return undefined;
  try {
    const u = new URL(/^[a-z]+:/i.test(s) ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const links = (v: unknown): Link[] =>
  Array.isArray(v)
    ? v.flatMap((l) => {
        const url = safeUrl((l as Json)?.url);
        return url ? [{ label: str((l as Json)?.label, 120) || new URL(url).hostname, url }] : [];
      }).slice(0, 30)
    : [];

const mediaKey = (v: unknown): string | undefined => {
  const s = str(v, 200);
  return /^media\/[a-f0-9-]+\.[a-z0-9]+$/.test(s) ? s : undefined;
};
const mediaKeys = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map(mediaKey).filter((k): k is string => !!k))].slice(0, 40) : [];

const parse = <T>(s: unknown, fallback: T): T => {
  try {
    return typeof s === "string" ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

// ---------- tricks ----------

function rowToTrick(r: Json): Trick {
  return {
    ...(r as unknown as Trick),
    audiences: parse(r.audiences, []),
    tags: parse(r.tags, []),
    links: parse(r.links, []),
    images: parse(r.images, []),
  };
}

export async function listTricks(env: Env): Promise<Trick[]> {
  const { results } = await env.DB.prepare("SELECT * FROM tricks ORDER BY name COLLATE NOCASE").all<Json>();
  return results.map(rowToTrick);
}

export async function getTrick(env: Env, id: string): Promise<Trick | null> {
  const r = await env.DB.prepare("SELECT * FROM tricks WHERE id = ?").bind(id).first<Json>();
  return r ? rowToTrick(r) : null;
}

/** Creates (no id) or updates (id) a trick. Only the fields present in `input` change. */
export async function saveTrick(env: Env, input: Json, id?: string): Promise<Trick> {
  const existing = id ? await getTrick(env, id) : null;
  if (id && !existing) throw new InputError("That trick doesn't exist.");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const base: Trick = existing ?? {
    id: newId(), name: "", category: "", status: "ready", effect: "", method: "", props: "", reset: "",
    duration_min: null, location: "", source: "", cost: null, purchase_url: "", audiences: [], tags: [], links: [], images: [],
    notes: "", created_at: Date.now(), updated_at: Date.now(),
  };
  const t: Trick = { ...base, updated_at: Date.now() };
  for (const k of ["name", "category", "effect", "method", "props", "reset", "location", "source", "notes"] as const) {
    if (has(k)) t[k] = str(input[k], k === "name" || k === "category" || k === "location" ? 200 : 20000);
  }
  if (has("status")) {
    const s = str(input.status).toLowerCase();
    if (!(STATUSES as readonly string[]).includes(s)) throw new InputError(`Status must be one of: ${STATUSES.join(", ")}.`);
    t.status = s;
  }
  if (has("duration_min")) t.duration_min = num(input.duration_min);
  if (has("cost")) t.cost = num(input.cost);
  if (has("purchase_url")) {
    const raw = str(input.purchase_url, 2000);
    const url = safeUrl(raw);
    if (raw && !url) throw new InputError("The purchase link doesn't look like a web address.");
    t.purchase_url = url ?? "";
  }
  if (has("audiences")) t.audiences = strList(input.audiences);
  if (has("tags")) t.tags = strList(input.tags);
  if (has("links")) t.links = links(input.links);
  if (has("images")) t.images = mediaKeys(input.images);
  if (!t.name) throw new InputError("A trick needs a name.");

  await env.DB.prepare(
    `INSERT INTO tricks (id, name, category, status, effect, method, props, reset, duration_min, location, source, cost,
       audiences, tags, links, images, notes, created_at, updated_at, purchase_url)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
     ON CONFLICT(id) DO UPDATE SET name=?2, category=?3, status=?4, effect=?5, method=?6, props=?7, reset=?8,
       duration_min=?9, location=?10, source=?11, cost=?12, audiences=?13, tags=?14, links=?15, images=?16, notes=?17,
       updated_at=?19, purchase_url=?20`,
  )
    .bind(t.id, t.name, t.category, t.status, t.effect, t.method, t.props, t.reset, t.duration_min, t.location, t.source,
      t.cost, JSON.stringify(t.audiences), JSON.stringify(t.tags), JSON.stringify(t.links), JSON.stringify(t.images),
      t.notes, t.created_at, t.updated_at, t.purchase_url)
    .run();
  return t;
}

export async function deleteTrick(env: Env, id: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM tricks WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

// ---------- set lists ----------

function rowToSetlist(r: Json): Setlist {
  return { ...(r as unknown as Setlist), items: parse(r.items, []), equipment: parse(r.equipment, []) };
}

export async function listSetlists(env: Env): Promise<Setlist[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM setlists ORDER BY CASE WHEN date = '' THEN 1 ELSE 0 END, date DESC, updated_at DESC",
  ).all<Json>();
  return results.map(rowToSetlist);
}

export async function getSetlist(env: Env, id: string): Promise<Setlist | null> {
  const r = await env.DB.prepare("SELECT * FROM setlists WHERE id = ?").bind(id).first<Json>();
  return r ? rowToSetlist(r) : null;
}

const setItems = (v: unknown): SetItem[] =>
  Array.isArray(v)
    ? v.slice(0, 200).flatMap((raw) => {
        const i = (raw ?? {}) as Json;
        const item: SetItem = {
          id: optStr(i.id, 64) ?? newId(),
          trick_id: optStr(i.trick_id, 64),
          title: optStr(i.title, 200),
          duration_min: num(i.duration_min),
          notes: optStr(i.notes, 2000),
        };
        return item.trick_id || item.title ? [item] : [];
      })
    : [];

export async function saveSetlist(env: Env, input: Json, id?: string): Promise<Setlist> {
  const existing = id ? await getSetlist(env, id) : null;
  if (id && !existing) throw new InputError("That set list doesn't exist.");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const s: Setlist = {
    ...(existing ?? { id: newId(), name: "", event: "", venue: "", date: "", notes: "", items: [], equipment: [], created_at: Date.now() }),
    updated_at: Date.now(),
  } as Setlist;
  for (const k of ["name", "event", "venue", "notes"] as const) if (has(k)) s[k] = str(input[k], k === "notes" ? 20000 : 200);
  if (has("date")) {
    const d = str(input.date, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new InputError("Dates look like 2026-10-31.");
    s.date = d;
  }
  if (has("items")) s.items = setItems(input.items);
  if (has("equipment")) s.equipment = Array.isArray(input.equipment) ? [...new Set(input.equipment.map((x) => str(x, 64)).filter(Boolean))].slice(0, 200) : [];
  if (!s.name) throw new InputError("A set list needs a name.");
  await env.DB.prepare(
    `INSERT INTO setlists (id, name, event, venue, date, notes, items, created_at, updated_at, equipment)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(id) DO UPDATE SET name=?2, event=?3, venue=?4, date=?5, notes=?6, items=?7, updated_at=?9, equipment=?10`,
  )
    .bind(s.id, s.name, s.event, s.venue, s.date, s.notes, JSON.stringify(s.items), s.created_at, s.updated_at, JSON.stringify(s.equipment))
    .run();
  return s;
}

export async function deleteSetlist(env: Env, id: string): Promise<boolean> {
  await env.DB.prepare("UPDATE tasks SET setlist_id = NULL WHERE setlist_id = ?").bind(id).run();
  const r = await env.DB.prepare("DELETE FROM setlists WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

// ---------- playlists ----------

function rowToPlaylist(r: Json): Playlist {
  return { ...(r as unknown as Playlist), tracks: parse(r.tracks, []) };
}

export async function listPlaylists(env: Env): Promise<Playlist[]> {
  const { results } = await env.DB.prepare("SELECT * FROM playlists ORDER BY updated_at DESC").all<Json>();
  return results.map(rowToPlaylist);
}

export async function getPlaylist(env: Env, id: string): Promise<Playlist | null> {
  const r = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first<Json>();
  return r ? rowToPlaylist(r) : null;
}

const tracks = (v: unknown): Track[] =>
  Array.isArray(v)
    ? v.slice(0, 300).flatMap((raw) => {
        const t = (raw ?? {}) as Json;
        const title = str(t.title, 200);
        if (!title) return [];
        return [{
          id: optStr(t.id, 64) ?? newId(),
          title,
          artist: optStr(t.artist, 200),
          url: safeUrl(t.url),
          file_key: mediaKey(t.file_key),
          duration_sec: num(t.duration_sec),
          cue: optStr(t.cue, 2000),
          trick_id: optStr(t.trick_id, 64),
        }];
      })
    : [];

export async function savePlaylist(env: Env, input: Json, id?: string): Promise<Playlist> {
  const existing = id ? await getPlaylist(env, id) : null;
  if (id && !existing) throw new InputError("That playlist doesn't exist.");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const p: Playlist = {
    ...(existing ?? { id: newId(), name: "", description: "", setlist_id: null, tracks: [], created_at: Date.now() }),
    updated_at: Date.now(),
  } as Playlist;
  if (has("name")) p.name = str(input.name, 200);
  if (has("description")) p.description = str(input.description);
  if (has("setlist_id")) p.setlist_id = optStr(input.setlist_id, 64) ?? null;
  if (has("tracks")) p.tracks = tracks(input.tracks);
  if (!p.name) throw new InputError("A playlist needs a name.");
  await env.DB.prepare(
    `INSERT INTO playlists (id, name, description, setlist_id, tracks, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET name=?2, description=?3, setlist_id=?4, tracks=?5, updated_at=?7`,
  )
    .bind(p.id, p.name, p.description, p.setlist_id, JSON.stringify(p.tracks), p.created_at, p.updated_at)
    .run();
  return p;
}

export async function deletePlaylist(env: Env, id: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

// ---------- media (photos, PDFs, audio) in R2 ----------

const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
  "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/aac": "aac", "video/mp4": "mp4", "video/quicktime": "mov",
};
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

export async function putMedia(env: Env, file: File): Promise<{ key: string; type: string; name: string; size: number }> {
  const ext = MEDIA_TYPES[file.type];
  if (!ext) throw new InputError("That file type isn't supported. Use a photo, PDF, audio or video file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new InputError("That file is too big (95 MB max).");
  const key = `media/${newId()}.${ext}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { name: file.name.slice(0, 200) },
  });
  return { key, type: file.type, name: file.name, size: file.size };
}

// ---------- tasks ----------

export interface Task {
  id: string; title: string; done: boolean; due: string; notes: string; setlist_id: string | null;
  done_at: number | null; created_at: number; updated_at: number;
}

const rowToTask = (r: Json): Task => ({ ...(r as unknown as Task), done: !!r.done });

/** Open tasks first (soonest due date first, undated last), then finished ones (latest first). */
export async function listTasks(env: Env): Promise<Task[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM tasks ORDER BY done,
       CASE WHEN done = 0 AND due = '' THEN 1 ELSE 0 END, CASE WHEN done = 0 THEN due END, done_at DESC, created_at`,
  ).all<Json>();
  return results.map(rowToTask);
}

export async function getTask(env: Env, id: string): Promise<Task | null> {
  const r = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Json>();
  return r ? rowToTask(r) : null;
}

export async function saveTask(env: Env, input: Json, id?: string): Promise<Task> {
  const existing = id ? await getTask(env, id) : null;
  if (id && !existing) throw new InputError("That task doesn't exist.");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const now = Date.now();
  const t: Task = {
    ...(existing ?? { id: newId(), title: "", done: false, due: "", notes: "", setlist_id: null, done_at: null, created_at: now }),
    updated_at: now,
  } as Task;
  if (has("title")) t.title = str(input.title, 500);
  if (has("notes")) t.notes = str(input.notes);
  if (has("due")) {
    const d = str(input.due, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new InputError("Dates look like 2026-10-31.");
    t.due = d;
  }
  if (has("setlist_id")) t.setlist_id = optStr(input.setlist_id, 64) ?? null;
  if (has("done")) {
    const done = input.done === true || input.done === 1;
    if (done !== t.done) t.done_at = done ? now : null;
    t.done = done;
  }
  if (!t.title) throw new InputError("A task needs some words.");
  await env.DB.prepare(
    `INSERT INTO tasks (id, title, done, due, notes, setlist_id, done_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET title=?2, done=?3, due=?4, notes=?5, setlist_id=?6, done_at=?7, updated_at=?9`,
  )
    .bind(t.id, t.title, t.done ? 1 : 0, t.due, t.notes, t.setlist_id, t.done_at, t.created_at, t.updated_at)
    .run();
  return t;
}

export async function deleteTask(env: Env, id: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

// ---------- notes ----------

export interface Note { id: string; title: string; body: string; pinned: boolean; created_at: number; updated_at: number }

const rowToNote = (r: Json): Note => ({ ...(r as unknown as Note), pinned: !!r.pinned });

export async function listNotes(env: Env): Promise<Note[]> {
  const { results } = await env.DB.prepare("SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC").all<Json>();
  return results.map(rowToNote);
}

export async function getNote(env: Env, id: string): Promise<Note | null> {
  const r = await env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first<Json>();
  return r ? rowToNote(r) : null;
}

export async function saveNote(env: Env, input: Json, id?: string): Promise<Note> {
  const existing = id ? await getNote(env, id) : null;
  if (id && !existing) throw new InputError("That note doesn't exist.");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const now = Date.now();
  const n: Note = { ...(existing ?? { id: newId(), title: "", body: "", pinned: false, created_at: now }), updated_at: now } as Note;
  if (has("title")) n.title = str(input.title, 300);
  if (has("body")) n.body = typeof input.body === "string" ? input.body.slice(0, 100000) : "";
  if (has("pinned")) n.pinned = input.pinned === true || input.pinned === 1;
  await env.DB.prepare(
    `INSERT INTO notes (id, title, body, pinned, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET title=?2, body=?3, pinned=?4, updated_at=?6`,
  )
    .bind(n.id, n.title, n.body, n.pinned ? 1 : 0, n.created_at, n.updated_at)
    .run();
  return n;
}

export async function deleteNote(env: Env, id: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}

// ---------- equipment ----------

export const GEAR_STATUSES = ["working", "repair", "wishlist", "retired"] as const;

export interface Gear {
  id: string; name: string; category: string; status: string; quantity: number; location: string; make_model: string;
  serial: string; cost: number | null; purchase_url: string; purchased_on: string; tags: string[]; links: Link[];
  images: string[]; notes: string; created_at: number; updated_at: number;
}

const rowToGear = (r: Json): Gear => ({
  ...(r as unknown as Gear), tags: parse(r.tags, []), links: parse(r.links, []), images: parse(r.images, []),
});

export async function listEquipment(env: Env): Promise<Gear[]> {
  const { results } = await env.DB.prepare("SELECT * FROM equipment ORDER BY name COLLATE NOCASE").all<Json>();
  return results.map(rowToGear);
}

export async function getEquipment(env: Env, id: string): Promise<Gear | null> {
  const r = await env.DB.prepare("SELECT * FROM equipment WHERE id = ?").bind(id).first<Json>();
  return r ? rowToGear(r) : null;
}

export async function saveEquipment(env: Env, input: Json, id?: string): Promise<Gear> {
  const existing = id ? await getEquipment(env, id) : null;
  if (id && !existing) throw new InputError("That equipment doesn't exist.");
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const now = Date.now();
  const g: Gear = {
    ...(existing ?? {
      id: newId(), name: "", category: "", status: "working", quantity: 1, location: "", make_model: "", serial: "", cost: null,
      purchase_url: "", purchased_on: "", tags: [], links: [], images: [], notes: "", created_at: now,
    }),
    updated_at: now,
  } as Gear;
  for (const k of ["name", "category", "location", "make_model", "serial"] as const) if (has(k)) g[k] = str(input[k], 200);
  if (has("notes")) g.notes = str(input.notes);
  if (has("status")) {
    const st = str(input.status).toLowerCase();
    if (!(GEAR_STATUSES as readonly string[]).includes(st)) throw new InputError(`Condition must be one of: ${GEAR_STATUSES.join(", ")}.`);
    g.status = st;
  }
  if (has("quantity")) g.quantity = Math.max(0, Math.min(9999, Math.round(num(input.quantity) ?? 1)));
  if (has("cost")) g.cost = num(input.cost);
  if (has("purchase_url")) {
    const raw = str(input.purchase_url, 2000);
    const url = safeUrl(raw);
    if (raw && !url) throw new InputError("The purchase link doesn't look like a web address.");
    g.purchase_url = url ?? "";
  }
  if (has("purchased_on")) {
    const d = str(input.purchased_on, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new InputError("Dates look like 2026-10-31.");
    g.purchased_on = d;
  }
  if (has("tags")) g.tags = strList(input.tags);
  if (has("links")) g.links = links(input.links);
  if (has("images")) g.images = mediaKeys(input.images);
  if (!g.name) throw new InputError("Equipment needs a name.");
  await env.DB.prepare(
    `INSERT INTO equipment (id, name, category, status, quantity, location, make_model, serial, cost, purchase_url,
       purchased_on, tags, links, images, notes, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
     ON CONFLICT(id) DO UPDATE SET name=?2, category=?3, status=?4, quantity=?5, location=?6, make_model=?7, serial=?8,
       cost=?9, purchase_url=?10, purchased_on=?11, tags=?12, links=?13, images=?14, notes=?15, updated_at=?17`,
  )
    .bind(g.id, g.name, g.category, g.status, g.quantity, g.location, g.make_model, g.serial, g.cost, g.purchase_url,
      g.purchased_on, JSON.stringify(g.tags), JSON.stringify(g.links), JSON.stringify(g.images), g.notes, g.created_at, g.updated_at)
    .run();
  return g;
}

export async function deleteEquipment(env: Env, id: string): Promise<boolean> {
  const r = await env.DB.prepare("DELETE FROM equipment WHERE id = ?").bind(id).run();
  return r.meta.changes > 0;
}
