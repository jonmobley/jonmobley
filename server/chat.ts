// The Backstage chat: Claude with tools over Jon's tricks, set lists and playlists.
// Streams newline-delimited JSON events to the browser:
//   {t:"text", d}  reply text as it's written     {t:"step", d}  a change Claude made
//   {t:"changed", what}  which library lists to reload   {t:"error", d}   {t:"done"}
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type { Env } from "./env";
import * as data from "./data";
import * as shares from "./shares";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 12;

type Msg = Anthropic.Beta.BetaMessageParam;
type Json = Record<string, unknown>;

export interface ViewMessage { role: "user" | "assistant"; text: string; images?: string[]; steps?: string[]; at: number }
export interface ChatFile { history: Msg[]; view: ViewMessage[] }

const SYSTEM = `You are Backstage, the private assistant inside jonmobley.com for Jon Mobley — a working magician, comedian and emcee from Indianapolis (Penn & Teller: Fool Us, The CW, Chicago Magic Lounge). Only Jon can reach you; he is signed in.

You manage his library with the tools:
- Tricks: his inventory of effects and props. Fields: name, category (e.g. close-up, parlor, stage, mentalism, kids), status (ready = show-ready, learning, wishlist = wants to buy, retired), effect (what the audience sees), method (how it works — private), props (what to pack), reset (prep/reset), duration_min, location (which case or shelf), source (maker/dealer), cost (price in USD), purchase_url (where to buy it), audiences, tags, links, images, notes. Keep categories consistent: reuse an existing category's exact spelling rather than inventing a near-duplicate.
- Set lists: an ordered running order for a show (event, venue, date). Items point at a trick (trick_id) or are a free-text bit (title), each with optional duration_min and notes. Total length = sum of durations, falling back to each trick's duration.
- Playlists: music and sound cues, optionally tied to a set list. Tracks have title, artist, url, cue (when to play), duration_sec, and optional trick_id.

- Equipment: gear that isn't a trick (mics, speakers, cases, tables, lights, cables). Fields: name, category, status (working, repair = needs repair, wishlist, retired), quantity, location, make_model, serial, cost (price USD), purchase_url, purchased_on, tags, links, images, notes. A set list's "equipment" is the list of equipment ids to bring to that show.
- Files: uploaded documents and images (logo, insurance policies from Thimble, contracts, promo photos). Each has name, folder (e.g. Insurance, Logos & branding, Contracts), notes, optional setlist_id (the show it's for) and expires (YYYY-MM-DD, e.g. when an insurance policy ends). Photos Jon sends in chat can be saved as files with their media key. You can't read a file's contents, only its details.
- Links: quick-access web links (title, url, folder, note, pinned) — e.g. Thimble for event insurance.
- Tasks: Jon's to-dos (title, done, due date, notes, optional setlist_id for a show's prep). Use them for reminders like "charge the mic before Saturday" — work out the date from today.
- Notes: free-form notes (title, body, pinned) for ideas, patter, scripts, contacts, anything.

How to work:
- Look things up before changing them; never invent ids. Use the id returned by a tool.
- Act on clear requests without asking. When Jon sends a photo of a prop, a receipt or a page from a catalog, read it and fill in what you can; attach the photo to the trick if he wants it saved.
- Ask before deleting anything, and before replacing a whole set list or playlist he didn't ask to rebuild.
- When building a set, think like a working pro: strong opener, build, a closer that lands; mind resets, angles and the audience. Keep to the requested length.
- Keep replies short and conversational. Say what you changed in a sentence; don't repeat whole records back. Use simple Markdown (bold, lists) only when it helps.
- Share links: share_link gives a view-only link to a set list, playlist or trick that Jon can send to an assistant or crew. Viewers see the running order, timings, notes, props, reset, photos and music cues, never methods, costs or private trick notes. Only make or turn off a link when Jon asks.
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
  cost: { type: ["number", "null"], description: "Price in USD (what it costs or cost)" },
  purchase_url: strProp("Where to buy it (dealer or product page URL), or empty"),
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
        equipment: { type: "array", items: { type: "string" }, description: "Full replacement list of equipment ids to bring" },
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
    name: "share_link",
    description: "Turn on (or look up) the view-only share link for a set list, playlist or trick, or turn it off. Returns the link.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...shares.KINDS] },
        id: { type: "string" },
        off: { type: "boolean", description: "true to turn the link off" },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "search_equipment",
    description: "List equipment, optionally filtered by words or status. No filters lists everything.",
    input_schema: { type: "object", properties: { query: { type: "string" }, status: { type: "string", enum: [...data.GEAR_STATUSES] } } },
  },
  {
    name: "save_equipment",
    description: "Create equipment (omit id) or update it (give id). Only the fields you include change. add_images attaches photos from the chat.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" }, name: { type: "string" }, category: strProp("e.g. audio, lighting, staging, cases, tech"),
        status: { type: "string", enum: [...data.GEAR_STATUSES] }, quantity: { type: "number" }, location: { type: "string" },
        make_model: { type: "string" }, serial: { type: "string" }, cost: { type: ["number", "null"] }, purchase_url: { type: "string" },
        purchased_on: strProp("YYYY-MM-DD or empty"), tags: { type: "array", items: { type: "string" } }, notes: { type: "string" },
        add_images: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "delete_equipment",
    description: "Permanently delete equipment. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "search_files",
    description: "List files in the Files area (name, folder, show, expiry). No query lists everything.",
    input_schema: { type: "object", properties: { query: { type: "string" }, folder: { type: "string" } } },
  },
  {
    name: "save_file",
    description: "Save a photo from this chat into Files (give key = its media key, plus name/folder), or update a file's details (give id). Only the fields you include change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" }, key: strProp("media/… key of a photo from this chat, when saving a new file"),
        name: { type: "string" }, folder: { type: "string" }, notes: { type: "string" },
        setlist_id: { type: ["string", "null"] }, expires: strProp("YYYY-MM-DD or empty"),
      },
    },
  },
  {
    name: "delete_file",
    description: "Permanently delete a file and its stored copy. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_links",
    description: "List the quick-access links.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_link",
    description: "Add a link (omit id) or change one (give id). Only the fields you include change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, url: { type: "string" }, folder: { type: "string" }, note: { type: "string" }, pinned: { type: "boolean" } },
    },
  },
  {
    name: "delete_link",
    description: "Delete a link. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_tasks",
    description: "List tasks. By default only open ones; set include_done to see finished ones too.",
    input_schema: { type: "object", properties: { include_done: { type: "boolean" }, setlist_id: strProp("Only tasks for this set list") } },
  },
  {
    name: "save_task",
    description: "Create a task (omit id) or update one (give id): rename, set due date, tick it off (done: true), attach to a set list. Only the fields you include change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        done: { type: "boolean" },
        due: strProp("YYYY-MM-DD, or empty for no date"),
        notes: { type: "string" },
        setlist_id: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete a task. Only after Jon confirms (ticking it off is usually what he wants).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "search_notes",
    description: "Find notes. Returns titles and a short preview; call get_note for the full text. No query lists them all.",
    input_schema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "get_note",
    description: "Get the full text of one note.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "save_note",
    description: "Create a note (omit id) or update one (give id). body replaces the whole text, so to add to a note, get it first and send the combined text.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, pinned: { type: "boolean" } },
    },
  },
  {
    name: "delete_note",
    description: "Permanently delete a note. Only after Jon confirms.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
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
async function runTool(env: Env, origin: string, name: string, input: Json): Promise<{ result: string; step?: string; changed?: string }> {
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
      await shares.deleteShare(env, "trick", t.id);
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
      await shares.deleteShare(env, "setlist", s.id);
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
      await shares.deleteShare(env, "playlist", p.id);
      return { result: "Deleted.", step: `Deleted playlist “${p.name}”`, changed: "playlists" };
    }
    case "search_equipment": {
      const words = (typeof input.query === "string" ? input.query : "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = (await data.listEquipment(env)).filter((g) => (!input.status || g.status === input.status)
        && words.every((w) => [g.name, g.category, g.location, g.make_model, g.notes, ...g.tags].join(" ").toLowerCase().includes(w)));
      return { result: JSON.stringify(hits.map(({ links, created_at, updated_at, ...g }) => ({ ...g, images: g.images.length }))) };
    }
    case "save_equipment": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      delete fields.add_images;
      if (Array.isArray(input.add_images)) {
        const current = id ? (await data.getEquipment(env, id))?.images ?? [] : [];
        fields.images = [...current, ...(input.add_images as string[])];
      }
      const g = await data.saveEquipment(env, fields, id);
      return { result: JSON.stringify({ id: g.id, name: g.name, status: g.status }), step: `${id ? "Updated" : "Added"} equipment “${g.name}”`, changed: "equipment" };
    }
    case "delete_equipment": {
      const g = await data.getEquipment(env, String(input.id));
      if (!g || !(await data.deleteEquipment(env, g.id))) return { result: "No equipment with that id." };
      return { result: "Deleted.", step: `Deleted equipment “${g.name}”`, changed: "equipment" };
    }
    case "search_files": {
      const words = (typeof input.query === "string" ? input.query : "").toLowerCase().split(/\s+/).filter(Boolean);
      const folder = typeof input.folder === "string" ? input.folder.toLowerCase() : "";
      const hits = (await data.listFiles(env)).filter((f) => (!folder || f.folder.toLowerCase() === folder)
        && words.every((w) => `${f.name} ${f.folder} ${f.notes}`.toLowerCase().includes(w)));
      return { result: JSON.stringify(hits.map(({ key, created_at, ...f }) => ({ ...f, updated_at: new Date(f.updated_at).toISOString().slice(0, 10) }))) };
    }
    case "save_file": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      const f = await data.saveFile(env, fields, id);
      return { result: JSON.stringify({ id: f.id, name: f.name, folder: f.folder }), step: `${id ? "Updated" : "Saved"} file “${f.name}”`, changed: "files" };
    }
    case "delete_file": {
      const f = await data.getFile(env, String(input.id));
      if (!f || !(await data.deleteFile(env, f.id))) return { result: "No file with that id." };
      return { result: "Deleted.", step: `Deleted file “${f.name}”`, changed: "files" };
    }
    case "list_links":
      return { result: JSON.stringify(await data.listLinks(env)) };
    case "save_link": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      const l = await data.saveLink(env, fields, id);
      return { result: JSON.stringify(l), step: `${id ? "Updated" : "Added"} link “${l.title}”`, changed: "links" };
    }
    case "delete_link": {
      const l = await data.getLink(env, String(input.id));
      if (!l || !(await data.deleteLink(env, l.id))) return { result: "No link with that id." };
      return { result: "Deleted.", step: `Deleted link “${l.title}”`, changed: "links" };
    }
    case "list_tasks": {
      const all = await data.listTasks(env);
      const sl = typeof input.setlist_id === "string" ? input.setlist_id : "";
      const shown = all.filter((t) => (input.include_done === true || !t.done) && (!sl || t.setlist_id === sl));
      return { result: JSON.stringify(shown.map(({ created_at, updated_at, done_at, ...t }) => t)) };
    }
    case "save_task": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      const t = await data.saveTask(env, fields, id);
      const verb = !id ? "Added task" : input.done === true ? "Ticked off" : input.done === false ? "Reopened" : "Updated task";
      return { result: JSON.stringify(t), step: `${verb} “${t.title}”`, changed: "tasks" };
    }
    case "delete_task": {
      const t = await data.getTask(env, String(input.id));
      if (!t || !(await data.deleteTask(env, t.id))) return { result: "No task with that id." };
      return { result: "Deleted.", step: `Deleted task “${t.title}”`, changed: "tasks" };
    }
    case "search_notes": {
      const words = (typeof input.query === "string" ? input.query : "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = (await data.listNotes(env)).filter((n) => words.every((w) => `${n.title} ${n.body}`.toLowerCase().includes(w)));
      return { result: JSON.stringify(hits.map((n) => ({ id: n.id, title: n.title || n.body.split("\n")[0].slice(0, 60), pinned: n.pinned, preview: n.body.slice(0, 200), updated_at: new Date(n.updated_at).toISOString().slice(0, 10) }))) };
    }
    case "get_note": {
      const n = await data.getNote(env, String(input.id));
      return { result: n ? JSON.stringify(n) : "No note with that id." };
    }
    case "save_note": {
      const id = idOf(input);
      const fields: Json = { ...input };
      delete fields.id;
      const n = await data.saveNote(env, fields, id);
      const name = n.title || n.body.split("\n")[0].slice(0, 40) || "note";
      return { result: JSON.stringify({ id: n.id, title: n.title }), step: `${id ? "Updated" : "Saved"} note “${name}”`, changed: "notes" };
    }
    case "delete_note": {
      const n = await data.getNote(env, String(input.id));
      if (!n || !(await data.deleteNote(env, n.id))) return { result: "No note with that id." };
      return { result: "Deleted.", step: `Deleted note “${n.title || "untitled"}”`, changed: "notes" };
    }
    case "share_link": {
      const kind = String(input.kind) as shares.Kind;
      if (!shares.KINDS.includes(kind)) return { result: "kind must be setlist, playlist or trick." };
      const id = String(input.id);
      if (input.off === true) {
        await shares.deleteShare(env, kind, id);
        return { result: "Link turned off.", step: `Turned off a share link`, changed: "shares" };
      }
      const share = await shares.createShare(env, kind, id);
      return { result: JSON.stringify({ url: shares.shareUrl(origin, share.token) }), step: `Share link ready`, changed: "shares" };
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

const VISION_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_VISION_BYTES = 5 * 1024 * 1024; // Claude's per-image limit

/** Handles one user message: streams Claude's reply and saves the transcript. */
export function streamReply(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  origin: string,
  chatId: string,
  text: string,
  imageKeys: string[],
  today: string,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: Json) => writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});

  // waitUntil keeps the reply going (and the transcript saved) if the browser goes away mid-answer.
  waitUntil((async () => {
    const file = (await loadChat(env, chatId)) ?? { history: [], view: [] };
    const isFirst = file.view.length === 0;
    const steps: string[] = [];
    let replyText = "";
    let lastGood = file.history.length; // history is only ever cut back to a valid point

    try {
      file.view.push({ role: "user", text, images: imageKeys.length ? imageKeys : undefined, at: Date.now() });
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("Chat isn't switched on yet: the site needs an Anthropic API key (ANTHROPIC_API_KEY).");
      }
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });

      // Photos go to Anthropic's file storage once, so the transcript only holds a short file id.
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      for (const key of imageKeys) {
        const obj = await env.MEDIA.get(key);
        const type = obj?.httpMetadata?.contentType;
        if (!obj || !type || !VISION_TYPES.includes(type)) continue;
        if (obj.size > MAX_VISION_BYTES) {
          content.push({ type: "text", text: `(A photo saved as ${key} was too large for you to view, but it can still be attached to a trick.)` });
          continue;
        }
        const uploaded = await client.files.upload({ file: await toFile(await obj.arrayBuffer(), key.split("/")[1], { type }) });
        content.push({ type: "image", source: { type: "file", file_id: uploaded.id } });
        content.push({ type: "text", text: `(That photo is saved as ${key} — use this key to attach it to a trick.)` });
      }
      content.push({ type: "text", text: `${text || "(photo only)"}\n\n(Today is ${today}.)` });
      // Not counted as good until Claude accepts it, so a bad turn can't break the chat for good.
      file.history.push({ role: "user", content });

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
        if (message.stop_reason !== "tool_use") {
          // Cut off mid-call (e.g. max_tokens): answer any tool calls as "not run" so the history stays valid.
          if (toolUses.length) {
            file.history.push({
              role: "user",
              content: toolUses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, content: "Not run: the reply was cut off.", is_error: true })),
            });
          }
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
            const out = await runTool(env, origin, use.name, (use.input ?? {}) as Json);
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
  })());

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
