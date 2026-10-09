// View-only share links. Anyone with the link can see a cleaned-up copy of one set list,
// playlist or trick. Methods, costs, sources and private notes are never included.
import type { Env } from "./env";
import * as data from "./data";

export const KINDS = ["setlist", "playlist", "trick"] as const;
export type Kind = (typeof KINDS)[number];

export interface Share { token: string; kind: Kind; item_id: string; created_at: number }

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isToken = (t: string) => /^[A-Za-z0-9_-]{24}$/.test(t);

async function exists(env: Env, kind: Kind, id: string): Promise<boolean> {
  if (kind === "setlist") return !!(await data.getSetlist(env, id));
  if (kind === "playlist") return !!(await data.getPlaylist(env, id));
  return !!(await data.getTrick(env, id));
}

export async function getShare(env: Env, kind: Kind, id: string): Promise<Share | null> {
  return env.DB.prepare("SELECT * FROM shares WHERE kind = ? AND item_id = ?").bind(kind, id).first<Share>();
}

/** Returns the item's link, creating it the first time. */
export async function createShare(env: Env, kind: Kind, id: string): Promise<Share> {
  if (!(await exists(env, kind, id))) throw new data.InputError("That item doesn't exist.");
  const current = await getShare(env, kind, id);
  if (current) return current;
  const share: Share = { token: newToken(), kind, item_id: id, created_at: Date.now() };
  await env.DB.prepare("INSERT OR IGNORE INTO shares (token, kind, item_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(share.token, kind, id, share.created_at).run();
  return (await getShare(env, kind, id))!;
}

export async function deleteShare(env: Env, kind: Kind, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM shares WHERE kind = ? AND item_id = ?").bind(kind, id).run();
}

export const shareUrl = (origin: string, token: string) => `${origin}/share/${token}`;

// ---------- what a viewer sees ----------

const publicTrick = (t: data.Trick) => ({
  id: t.id, name: t.name, category: t.category, duration_min: t.duration_min, effect: t.effect,
  props: t.props, reset: t.reset, location: t.location, images: t.images.filter((k) => /\.(jpg|png|webp|gif)$/.test(k)),
});

const publicPlaylist = (p: data.Playlist, tricks: Map<string, data.Trick>) => ({
  name: p.name, description: p.description,
  tracks: p.tracks.map((t) => ({
    title: t.title, artist: t.artist, url: t.url, file_key: t.file_key, duration_sec: t.duration_sec, cue: t.cue,
    trick: t.trick_id ? tricks.get(t.trick_id)?.name : undefined,
  })),
});

export interface SharedView { kind: Kind; data: unknown; media: string[] }

/** Builds the viewer's copy and the list of files it may load. Null if the link is off or the item is gone. */
export async function sharedView(env: Env, token: string): Promise<SharedView | null> {
  if (!isToken(token)) return null;
  const share = await env.DB.prepare("SELECT * FROM shares WHERE token = ?").bind(token).first<Share>();
  if (!share) return null;
  const tricks = new Map((await data.listTricks(env)).map((t) => [t.id, t]));

  if (share.kind === "trick") {
    const t = tricks.get(share.item_id);
    if (!t) return null;
    const view = publicTrick(t);
    return { kind: "trick", data: view, media: view.images };
  }
  if (share.kind === "playlist") {
    const p = await data.getPlaylist(env, share.item_id);
    if (!p) return null;
    const view = publicPlaylist(p, tricks);
    return { kind: "playlist", data: view, media: view.tracks.flatMap((t) => (t.file_key ? [t.file_key] : [])) };
  }
  const s = await data.getSetlist(env, share.item_id);
  if (!s) return null;
  const items = s.items.map((i) => {
    const t = i.trick_id ? tricks.get(i.trick_id) : undefined;
    return {
      name: t?.name ?? i.title ?? "(removed)",
      duration_min: i.duration_min ?? t?.duration_min ?? null,
      notes: i.notes,
      trick: t ? publicTrick(t) : undefined,
    };
  });
  const playlists = (await data.listPlaylists(env)).filter((p) => p.setlist_id === s.id).map((p) => publicPlaylist(p, tricks));
  const gearById = new Map((await data.listEquipment(env)).map((g) => [g.id, g]));
  const equipment = s.equipment.flatMap((id) => {
    const g = gearById.get(id);
    return g ? [{ name: g.name, quantity: g.quantity, location: g.location, make_model: g.make_model, image: g.images.find((k) => /\.(jpg|png|webp|gif)$/.test(k)) }] : [];
  });
  const media = [
    ...items.flatMap((i) => i.trick?.images ?? []),
    ...playlists.flatMap((p) => p.tracks.flatMap((t) => (t.file_key ? [t.file_key] : []))),
    ...equipment.flatMap((g) => (g.image ? [g.image] : [])),
  ];
  return {
    kind: "setlist",
    data: { name: s.name, event: s.event, venue: s.venue, date: s.date, notes: s.notes, items, playlists, equipment },
    media,
  };
}
