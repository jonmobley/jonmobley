// Backstage: Jon's private trick library, set lists and playlists, with a chat assistant.
// Plain ES module, no build step. Preact + htm are vendored in ./vendor.
import { html, render, useState, useEffect, useRef, useMemo, useCallback } from "./vendor/preact-htm.js";

// ---------- small helpers ----------

const STATUSES = [
  ["ready", "Ready"],
  ["learning", "Learning"],
  ["wishlist", "Wishlist"],
  ["retired", "Retired"],
];
const statusLabel = (s) => (STATUSES.find(([k]) => k === s) || [s, s])[1];
const mediaUrl = (key) => `/api/media/${key}`;
const isImageKey = (key) => /\.(jpg|png|webp|gif|heic)$/.test(key);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtMin = (m) => {
  if (!m) return "0 min";
  const h = Math.floor(m / 60);
  const r = Math.round((m % 60) * 10) / 10;
  return h ? `${h} hr${r ? ` ${r} min` : ""}` : `${r} min`;
};
const fmtSec = (s) => (s || s === 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const parseSec = (v) => {
  const t = String(v || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(Number(t)) ? Number(t) : null;
};
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const store = {
  get(k) {
    try { return localStorage.getItem(`backstage:${k}`); } catch { return null; }
  },
  set(k, v) {
    try { v == null ? localStorage.removeItem(`backstage:${k}`) : localStorage.setItem(`backstage:${k}`, v); } catch {}
  },
};

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = "GET", body, raw } = {}) {
  const headers = { "X-Backstage": "1" };
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api/${path}`, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  if (raw) {
    if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error || "Something went wrong.", res.status);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") window.dispatchEvent(new Event("backstage:signed-out"));
  if (!res.ok) throw new ApiError(data.error || "Something went wrong.", res.status);
  return data;
}

// Photos are shrunk in the browser before upload (max 2000px JPEG); anything else goes up as is.
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 600_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

async function upload(file) {
  const fd = new FormData();
  fd.append("file", await shrinkImage(file));
  return api("media", { method: "POST", body: fd });
}

// Tiny, safe Markdown for chat replies: escape first, then bold, italics, code, lists.
function markdown(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const out = [];
  let list = null;
  for (const line of text.split("\n")) {
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const kind = ul ? "ul" : ol ? "ol" : null;
    if (kind) {
      if (!list || list.kind !== kind) {
        if (list) out.push(`</${list.kind}>`);
        list = { kind };
        out.push(`<${kind}>`);
      }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list.kind}>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
  }
  if (list) out.push(`</${list.kind}>`);
  return out.join("");
}

// ---------- icons (Lucide-style strokes) ----------

const PATHS = {
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  up: "M12 19V5M5 12l7-7 7 7",
  image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3",
  newchat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v6M9 10h6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  back: "M15 18l-6-6 6-6",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  arrowUp: "M18 15l-6-6-6 6",
  arrowDown: "M6 9l6 6 6-6",
  play: "M6 3l14 9-14 9z",
  chat: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-8.5h.5a8.5 8.5 0 0 1 8 8z",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
};
const Icon = ({ name, size }) =>
  html`<svg class="i" viewBox="0 0 24 24" style=${size ? `width:${size}px;height:${size}px` : ""} aria-hidden="true"><path d=${PATHS[name]} /></svg>`;

// ---------- app ----------

function useHashRoute() {
  const read = () => (location.hash.replace(/^#\/?/, "") || "tricks").split("/");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
// Set while an editor has unsaved changes, so moving around inside the app asks first.
let unsaved = false;
const go = (path) => {
  if (unsaved && !confirm("You have unsaved changes. Leave without saving?")) return;
  unsaved = false;
  location.hash = `#/${path}`;
};

function App() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    api("session").then(setSession).catch(() => setSession({ signedIn: false, passwordSet: true, offline: true }));
    const out = () => setSession((s) => ({ ...(s || {}), signedIn: false }));
    addEventListener("backstage:signed-out", out);
    return () => removeEventListener("backstage:signed-out", out);
  }, []);
  const [wasIn, setWasIn] = useState(false);
  useEffect(() => { if (session?.signedIn) setWasIn(true); }, [session]);
  if (!session) return null;
  const login = html`<${Login} session=${session} onIn=${() => setSession({ ...session, signedIn: true })} />`;
  if (!wasIn && !session.signedIn) return login;
  // Signed out mid-session (expired, or password changed elsewhere): sign in on top, keeping unsaved work.
  return html`
    <${Backstage} onOut=${() => { unsaved = false; setWasIn(false); setSession({ ...session, signedIn: false }); }} />
    ${!session.signedIn && html`<div class="modal-wrap">${login}</div>`}`;
}

function Login({ session, onIn }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(session.offline ? "Can't reach the server right now." : "");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setErr("");
    try {
      await api("login", { method: "POST", body: { password: pw } });
      onIn();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };
  return html`<div class="center">
    <form class="login" onSubmit=${submit}>
      <div class="badge">JM</div>
      <h1>Backstage</h1>
      <p>${session.passwordSet ? "Sign in to your trick library." : "Backstage isn't set up yet."}</p>
      <label class="field"><span>PASSWORD</span>
        <input class="input" type="password" autocomplete="current-password" autofocus value=${pw} onInput=${(e) => setPw(e.target.value)} />
      </label>
      <button class="btn primary" disabled=${busy || !pw}>${busy ? "Signing in…" : "Sign in"}</button>
      <div class="err" role="alert">${err}</div>
    </form>
  </div>`;
}

function Backstage({ onOut }) {
  const route = useHashRoute();
  const [tricks, setTricks] = useState(null);
  const [setlists, setSetlists] = useState(null);
  const [playlists, setPlaylists] = useState(null);
  const [pane, setPane] = useState(() => (matchMedia("(max-width: 900px)").matches ? "lib" : "both"));
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [show, setShow] = useState(null);

  const load = useCallback(async (which) => {
    const all = !which || which.length === 0;
    const jobs = [];
    if (all || which.includes("tricks")) jobs.push(api("tricks").then(setTricks));
    if (all || which.includes("setlists")) jobs.push(api("setlists").then(setSetlists));
    if (all || which.includes("playlists")) jobs.push(api("playlists").then(setPlaylists));
    await Promise.all(jobs).catch((e) => setToast(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx = { tricks, setlists, playlists, load, setToast, setShow };
  const [section, id] = route;
  const tab = ["sets", "playlists"].includes(section) ? section : "tricks";

  let view;
  if (section === "sets" && id) view = html`<${SetlistEditor} key=${id} id=${id} ctx=${ctx} />`;
  else if (section === "sets") view = html`<${SetlistList} ctx=${ctx} />`;
  else if (section === "playlists" && id) view = html`<${PlaylistEditor} key=${id} id=${id} ctx=${ctx} />`;
  else if (section === "playlists") view = html`<${PlaylistList} ctx=${ctx} />`;
  else if (section === "tricks" && id) view = html`<${TrickEditor} key=${id} id=${id} ctx=${ctx} />`;
  else view = html`<${TrickList} ctx=${ctx} />`;

  const setTab = (t) => { go(t); if (pane === "chat") setPane("lib"); };

  return html`
    <div class="shell">
      <header class="top">
        <div class="brand"><div class="badge">JM</div><span class="word">Backstage</span></div>
        <nav class="tabs">
          <button class=${`tab ${tab === "tricks" && pane !== "chat" ? "on" : ""}`} onClick=${() => setTab("tricks")}>Tricks</button>
          <button class=${`tab ${tab === "sets" && pane !== "chat" ? "on" : ""}`} onClick=${() => setTab("sets")}>Set<span class="long"> lists</span></button>
          <button class=${`tab ${tab === "playlists" && pane !== "chat" ? "on" : ""}`} onClick=${() => setTab("playlists")}>Playlists</button>
          <button class=${`tab pane-switch ${pane === "chat" ? "on" : ""}`} onClick=${() => setPane("chat")}>Chat</button>
        </nav>
        <div class="spacer"></div>
        <a class="ghost" href="/" target="_blank" rel="noopener"><${Icon} name="external" /><span class="word">View site</span></a>
        <button class="ghost" onClick=${() => setSettings(true)} aria-label="Settings"><${Icon} name="settings" /><span class="word">Settings</span></button>
      </header>
      <main class=${`split ${pane === "chat" ? "show-chat" : pane === "lib" ? "show-lib" : ""}`}>
        <${Chat} ctx=${ctx} />
        <section class="stage">${view}</section>
      </main>
    </div>
    ${show && html`<${ShowMode} ...${show} onClose=${() => setShow(null)} />`}
    ${settings && html`<${Settings} onClose=${() => setSettings(false)} onOut=${onOut} />`}
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
  `;
}

// ---------- tricks ----------

function Cover({ trick }) {
  const img = trick.images.find(isImageKey);
  return html`<div class="cover">
    ${img ? html`<img src=${mediaUrl(img)} alt="" loading="lazy" />` : html`<span class="initial">${(trick.name[0] || "?").toUpperCase()}</span>`}
  </div>`;
}

function TrickList({ ctx }) {
  const [q, setQ] = useState(() => store.get("trick-q") || "");
  const [status, setStatus] = useState(() => store.get("trick-status") || "");
  useEffect(() => { store.set("trick-q", q || null); store.set("trick-status", status || null); }, [q, status]);
  const { tricks } = ctx;
  const shown = useMemo(() => {
    if (!tricks) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return tricks.filter((t) => {
      if (status && t.status !== status) return false;
      const hay = [t.name, t.category, t.effect, t.props, t.location, t.source, t.notes, ...t.tags, ...t.audiences].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [tricks, q, status]);

  return html`
    <div class="bar">
      <h1>Tricks</h1>
      <label class="search"><${Icon} name="search" /><span class="sr">Search tricks</span>
        <input placeholder="Search tricks, props, tags…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </label>
      <div class="chips">
        <button class=${`chip ${!status ? "on" : ""}`} onClick=${() => setStatus("")}>All</button>
        ${STATUSES.map(([k, label]) => html`<button class=${`chip ${status === k ? "on" : ""}`} onClick=${() => setStatus(status === k ? "" : k)}>${label}</button>`)}
      </div>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => go("tricks/new")}><${Icon} name="plus" />New trick</button>
    </div>
    <div class="scroll pad">
      ${!tricks
        ? null
        : tricks.length === 0
          ? html`<div class="empty"><h2>Your trick library is empty</h2><p>Add your first trick, or send the chat a photo of a prop and it'll fill in the details.</p><button class="btn primary" onClick=${() => go("tricks/new")}><${Icon} name="plus" />New trick</button></div>`
          : shown.length === 0
            ? html`<div class="empty"><h2>No matches</h2><p>Nothing fits that search.</p></div>`
            : html`<div class="grid">
                ${shown.map((t) => html`<button class="card" onClick=${() => go(`tricks/${t.id}`)}>
                  <${Cover} trick=${t} />
                  <div class="meta">
                    <div class="name">${t.name}</div>
                    <div class="sub">${[t.category, t.duration_min ? `${t.duration_min} min` : ""].filter(Boolean).join(" · ") || " "}</div>
                    <span class=${`pill ${t.status}`}>${statusLabel(t.status)}</span>
                  </div>
                </button>`)}
              </div>`}
    </div>`;
}

const BLANK_TRICK = {
  name: "", category: "", status: "ready", effect: "", method: "", props: "", reset: "", duration_min: null,
  location: "", source: "", cost: null, audiences: [], tags: [], links: [], images: [], notes: "",
};

/** Shared editor state: load once, track edits, save, and pick up chat changes when nothing is unsaved. */
function useDraft(id, list, blank) {
  const isNew = id === "new";
  const fromList = list && list.find((x) => x.id === id);
  const [draft, setDraft] = useState(() => (isNew ? { ...blank } : fromList ? structuredClone(fromList) : null));
  const [dirty, setDirty] = useState(isNew);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (isNew || dirty) return;
    if (fromList) setDraft(structuredClone(fromList));
    else if (list) setMissing(true);
  }, [fromList, list]);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  return { draft, set, dirty, setDirty, isNew, missing, setDraft };
}

function SaveBar({ dirty, busy, err, isNew, onSave, onDelete, what }) {
  return html`<div class="foot">
    <span class=${`note ${err ? "err" : ""}`}>${err || (dirty ? "Unsaved changes" : "All changes saved")}</span>
    ${!isNew && html`<button class="btn danger" onClick=${onDelete}><${Icon} name="trash" />Delete</button>`}
    <button class="btn primary" disabled=${!dirty || busy} onClick=${onSave}>${busy ? "Saving…" : isNew ? `Add ${what}` : "Save"}</button>
  </div>`;
}

function useSaver({ path, id, draft, isNew, setDirty, ctx, which, back, what }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const saved = await api(isNew ? path : `${path}/${id}`, { method: isNew ? "POST" : "PUT", body: draft });
      setDirty(false);
      await ctx.load([which]);
      if (isNew) location.replace(`#/${back}/${saved.id}`);
      ctx.setToast("Saved");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm(`Delete this ${what}? This can't be undone.`)) return;
    try {
      await api(`${path}/${id}`, { method: "DELETE" });
      await ctx.load([which]);
      unsaved = false;
      go(back);
      ctx.setToast("Deleted");
    } catch (e) {
      setErr(e.message);
    }
  };
  return { busy, err, save, remove };
}

// Warn before leaving an editor with unsaved changes.
function useLeaveGuard(dirty) {
  useEffect(() => {
    unsaved = dirty;
    if (!dirty) return;
    const on = (e) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", on);
    return () => { removeEventListener("beforeunload", on); unsaved = false; };
  }, [dirty]);
}

function BackBar({ to, label, children }) {
  return html`<div class="bar">
    <button class="ghost" onClick=${() => go(to)}><${Icon} name="back" />${label}</button>
    <div class="grow"></div>
    ${children}
  </div>`;
}

function Field({ label, children }) {
  return html`<label class="field"><span>${label}</span>${children}</label>`;
}

function Text({ value, onInput, ...rest }) {
  return html`<input class="input" value=${value ?? ""} onInput=${(e) => onInput(e.target.value)} ...${rest} />`;
}

function Area({ value, onInput, rows = 3, ...rest }) {
  return html`<textarea class="textarea" rows=${rows} value=${value ?? ""} onInput=${(e) => onInput(e.target.value)} ...${rest}></textarea>`;
}

function TagInput({ value, onChange, placeholder }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim().replace(/,$/, "");
    if (v && !value.includes(v)) onChange([...value, v]);
    setText("");
  };
  return html`<div class="taglist">
    ${value.map((t) => html`<span class="tag">${t}<button type="button" aria-label=${`Remove ${t}`} onClick=${() => onChange(value.filter((x) => x !== t))}><${Icon} name="x" /></button></span>`)}
    <input value=${text} placeholder=${value.length ? "" : placeholder}
      onInput=${(e) => setText(e.target.value)}
      onKeyDown=${(e) => {
        if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
        else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
      }}
      onBlur=${add} />
  </div>`;
}

function Uploader({ onAdded, accept, label = "Add photo", ctx }) {
  const input = useRef();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const send = async (files) => {
    const keys = [];
    setBusy((n) => n + files.length);
    for (const f of files) {
      try {
        keys.push((await upload(f)).key);
      } catch (e) {
        ctx.setToast(e.message);
      }
      setBusy((n) => n - 1);
    }
    if (keys.length) onAdded(keys);
  };
  return html`<button type="button" class=${`drop ${over ? "over" : ""}`} onClick=${() => input.current.click()}
      onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}>
    <span><${Icon} name="plus" /><br />${busy ? "Uploading…" : label}</span>
    <input ref=${input} type="file" hidden multiple accept=${accept} onChange=${(e) => { send([...e.target.files]); e.target.value = ""; }} />
  </button>`;
}

function Gallery({ keys, onChange, ctx }) {
  return html`<div class="gallery">
    ${keys.map((k) => html`<div class="thumb">
      <a href=${mediaUrl(k)} target="_blank" rel="noopener">
        ${isImageKey(k) ? html`<img src=${mediaUrl(k)} alt="" loading="lazy" />` : html`<div class="file"><${Icon} name="file" />${k.split(".").pop().toUpperCase()}</div>`}
      </a>
      <button class="x" aria-label="Remove" onClick=${() => onChange(keys.filter((x) => x !== k))}><${Icon} name="x" /></button>
    </div>`)}
    <${Uploader} ctx=${ctx} accept="image/*,application/pdf,video/mp4,video/quicktime" label="Add photo or file" onAdded=${(added) => onChange([...keys, ...added])} />
  </div>`;
}

function Links({ links, onChange }) {
  const update = (i, patch) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return html`<div class="section" style="gap:8px">
    ${links.map((l, i) => html`<div class="linkrow">
      <input class="input label" placeholder="Label (e.g. Tutorial)" value=${l.label} onInput=${(e) => update(i, { label: e.target.value })} />
      <input class="input" placeholder="https://…" value=${l.url} inputmode="url" onInput=${(e) => update(i, { url: e.target.value })} />
      <a class="icon-btn" href=${/^https?:/.test(l.url) ? l.url : `https://${l.url}`} target="_blank" rel="noopener" aria-label="Open link"><${Icon} name="external" /></a>
      <button class="icon-btn" aria-label="Remove link" onClick=${() => onChange(links.filter((_, j) => j !== i))}><${Icon} name="trash" /></button>
    </div>`)}
    <div><button class="btn" onClick=${() => onChange([...links, { label: "", url: "" }])}><${Icon} name="link" />Add link</button></div>
  </div>`;
}

function TrickEditor({ id, ctx }) {
  const { draft, set, dirty, setDirty, isNew, missing } = useDraft(id, ctx.tricks, BLANK_TRICK);
  const { busy, err, save, remove } = useSaver({ path: "tricks", id, draft, isNew, setDirty, ctx, which: "tricks", back: "tricks", what: "trick" });
  useLeaveGuard(dirty);
  if (missing) return html`<${BackBar} to="tricks" label="Tricks" /><div class="empty"><h2>Trick not found</h2><p>It may have been deleted.</p></div>`;
  if (!draft) return html`<${BackBar} to="tricks" label="Tricks" />`;
  const usedIn = (ctx.setlists || []).filter((s) => s.items.some((i) => i.trick_id === id));

  return html`
    <${BackBar} to="tricks" label="Tricks" />
    <div class="scroll pad">
      <div class="editor">
        <input class="title-input" placeholder="Trick name" value=${draft.name} onInput=${(e) => set({ name: e.target.value })} autofocus=${isNew} />
        <div class="cols">
          <${Field} label="STATUS">
            <select class="select" value=${draft.status} onChange=${(e) => set({ status: e.target.value })}>
              ${STATUSES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
          <//>
          <${Field} label="CATEGORY"><${Text} value=${draft.category} placeholder="Close-up, stage, mentalism…" onInput=${(v) => set({ category: v })} /><//>
          <${Field} label="LENGTH (MIN)"><${Text} type="number" min="0" step="0.5" inputmode="decimal" value=${draft.duration_min ?? ""} onInput=${(v) => set({ duration_min: v === "" ? null : Number(v) })} /><//>
          <${Field} label="WHERE IT LIVES"><${Text} value=${draft.location} placeholder="Case, shelf, bag…" onInput=${(v) => set({ location: v })} /><//>
        </div>
        <div class="section">
          <h3>Photos & files</h3>
          <${Gallery} ctx=${ctx} keys=${draft.images} onChange=${(images) => set({ images })} />
        </div>
        <div class="section">
          <h3>The trick</h3>
          <${Field} label="EFFECT — WHAT THEY SEE"><${Area} value=${draft.effect} onInput=${(v) => set({ effect: v })} /><//>
          <${Field} label="METHOD — PRIVATE"><${Area} rows="4" value=${draft.method} onInput=${(v) => set({ method: v })} /><//>
          <${Field} label="PROPS TO PACK"><${Area} rows="2" value=${draft.props} onInput=${(v) => set({ props: v })} /><//>
          <${Field} label="PREP & RESET"><${Area} rows="2" value=${draft.reset} onInput=${(v) => set({ reset: v })} /><//>
        </div>
        <div class="section">
          <h3>Audiences & tags</h3>
          <${Field} label="GOOD FOR"><${TagInput} value=${draft.audiences} placeholder="corporate, family, kids…" onChange=${(audiences) => set({ audiences })} /><//>
          <${Field} label="TAGS"><${TagInput} value=${draft.tags} placeholder="cards, needs batteries, opener…" onChange=${(tags) => set({ tags })} /><//>
        </div>
        <div class="section">
          <h3>Links</h3>
          <${Links} links=${draft.links} onChange=${(links) => set({ links })} />
        </div>
        <div class="section">
          <h3>Details</h3>
          <div class="cols">
            <${Field} label="SOURCE / MAKER"><${Text} value=${draft.source} onInput=${(v) => set({ source: v })} /><//>
            <${Field} label="COST ($)"><${Text} type="number" min="0" step="0.01" inputmode="decimal" value=${draft.cost ?? ""} onInput=${(v) => set({ cost: v === "" ? null : Number(v) })} /><//>
          </div>
          <${Field} label="NOTES"><${Area} value=${draft.notes} onInput=${(v) => set({ notes: v })} /><//>
        </div>
        ${usedIn.length > 0 && html`<div class="section"><h3>In set lists</h3>
          <div class="chips">${usedIn.map((s) => html`<button class="chip" onClick=${() => go(`sets/${s.id}`)}>${s.name}</button>`)}</div>
        </div>`}
      </div>
    </div>
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} onSave=${save} onDelete=${remove} what="trick" />`;
}

// ---------- set lists ----------

const itemMinutes = (item, byId) => item.duration_min ?? byId.get(item.trick_id)?.duration_min ?? 0;

function SetlistList({ ctx }) {
  const { setlists, tricks } = ctx;
  const byId = useMemo(() => new Map((tricks || []).map((t) => [t.id, t])), [tricks]);
  return html`
    <div class="bar">
      <h1>Set lists</h1>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => go("sets/new")}><${Icon} name="plus" />New set list</button>
    </div>
    <div class="scroll pad">
      ${!setlists
        ? null
        : setlists.length === 0
          ? html`<div class="empty"><h2>No set lists yet</h2><p>Build a running order for your next show, or ask the chat to draft one.</p><button class="btn primary" onClick=${() => go("sets/new")}><${Icon} name="plus" />New set list</button></div>`
          : html`<div class="rows">${setlists.map((s) => {
              const total = s.items.reduce((n, i) => n + itemMinutes(i, byId), 0);
              return html`<button class="row" onClick=${() => go(`sets/${s.id}`)}>
                <div class="ico"><${Icon} name="list" /></div>
                <div class="txt"><div class="name">${s.name}</div>
                  <div class="sub">${[s.event, s.venue, fmtDate(s.date)].filter(Boolean).join(" · ") || `${s.items.length} items`}</div></div>
                <div class="right">${s.items.length} items · ${fmtMin(total)}</div>
              </button>`;
            })}</div>`}
    </div>`;
}

function TrickPicker({ tricks, onPick, label = "Add trick" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const shown = (tricks || []).filter((t) => t.status !== "retired" || q).filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  return html`<div class="picker" ref=${ref}>
    <button class="btn" onClick=${() => setOpen(!open)}><${Icon} name="plus" />${label}</button>
    ${open && html`<div class="menu">
      <input class="input" placeholder="Search tricks…" value=${q} autofocus onInput=${(e) => setQ(e.target.value)} />
      ${shown.length === 0 && html`<div class="none">No tricks match.</div>`}
      ${shown.map((t) => html`<button class="opt" onClick=${() => { onPick(t); setOpen(false); setQ(""); }}>
        ${t.name}<span class="sub">${[statusLabel(t.status), t.duration_min ? `${t.duration_min} min` : ""].filter(Boolean).join(" · ")}</span>
      </button>`)}
    </div>`}
  </div>`;
}

/** Drag-to-reorder (mouse) plus up/down buttons (touch and keyboard). */
function useReorder(list, onChange) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const move = (from, to) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  const props = (i) => ({
    draggable: true,
    class: `item ${dragging === i ? "dragging" : ""} ${over === i && dragging !== i ? "over" : ""}`,
    onDragStart: (e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e) => { e.preventDefault(); setOver(i); },
    onDragEnd: () => { setDragging(null); setOver(null); },
    onDrop: (e) => { e.preventDefault(); if (dragging !== null) move(dragging, i); setDragging(null); setOver(null); },
  });
  return { move, props };
}

const BLANK_SET = { name: "", event: "", venue: "", date: "", notes: "", items: [] };

function SetlistEditor({ id, ctx }) {
  const { draft, set, dirty, setDirty, isNew, missing } = useDraft(id, ctx.setlists, BLANK_SET);
  const { busy, err, save, remove } = useSaver({ path: "setlists", id, draft, isNew, setDirty, ctx, which: "setlists", back: "sets", what: "set list" });
  useLeaveGuard(dirty);
  const byId = useMemo(() => new Map((ctx.tricks || []).map((t) => [t.id, t])), [ctx.tricks]);
  const items = draft?.items || [];
  const setItems = (next) => set({ items: next });
  const { move, props } = useReorder(items, setItems);
  if (missing) return html`<${BackBar} to="sets" label="Set lists" /><div class="empty"><h2>Set list not found</h2></div>`;
  if (!draft) return html`<${BackBar} to="sets" label="Set lists" />`;
  const total = items.reduce((n, i) => n + itemMinutes(i, byId), 0);
  const upd = (i, patch) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const openShow = () => ctx.setShow({
    title: draft.name || "Set list",
    when: [draft.event, draft.venue, fmtDate(draft.date)].filter(Boolean).join(" · "),
    rows: items.map((i) => ({ name: i.trick_id ? byId.get(i.trick_id)?.name ?? "(deleted trick)" : i.title, notes: i.notes, min: itemMinutes(i, byId) })),
    total,
  });

  return html`
    <${BackBar} to="sets" label="Set lists">
      <button class="btn" disabled=${!items.length} onClick=${openShow}><${Icon} name="play" />Show mode</button>
    <//>
    <div class="scroll pad">
      <div class="editor">
        <input class="title-input" placeholder="Set list name" value=${draft.name} onInput=${(e) => set({ name: e.target.value })} autofocus=${isNew} />
        <div class="cols">
          <${Field} label="EVENT"><${Text} value=${draft.event} placeholder="Acme holiday party" onInput=${(v) => set({ event: v })} /><//>
          <${Field} label="VENUE"><${Text} value=${draft.venue} onInput=${(v) => set({ venue: v })} /><//>
          <${Field} label="DATE"><input class="input" type="date" value=${draft.date} onInput=${(e) => set({ date: e.target.value })} /><//>
        </div>
        <div class="section">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <h3 style="margin:0;flex:1">Running order</h3>
            <div class="total">Total <b>${fmtMin(total)}</b></div>
          </div>
          <div class="order">
            ${items.map((item, i) => {
              const t = item.trick_id ? byId.get(item.trick_id) : null;
              return html`<div key=${item.id} ...${props(i)}>
                <div class="grip" title="Drag to reorder"><${Icon} name="grip" /></div>
                <div class="num">${i + 1}</div>
                <div class="body">
                  <div class="line">
                    ${item.trick_id
                      ? html`<span class="tname" onClick=${() => go(`tricks/${item.trick_id}`)}>${t ? t.name : "(deleted trick)"}</span>`
                      : html`<input class="input" style="flex:1;min-width:140px" placeholder="Bit, intro, Q&A…" value=${item.title || ""} onInput=${(e) => upd(i, { title: e.target.value })} />`}
                    <input class="input mins" type="number" min="0" step="0.5" inputmode="decimal" aria-label="Minutes"
                      placeholder=${t?.duration_min ? `${t.duration_min} min` : "min"} value=${item.duration_min ?? ""}
                      onInput=${(e) => upd(i, { duration_min: e.target.value === "" ? null : Number(e.target.value) })} />
                  </div>
                  <input class="input" placeholder="Notes for this spot" value=${item.notes || ""} onInput=${(e) => upd(i, { notes: e.target.value })} />
                </div>
                <div class="acts">
                  <button class="icon-btn" aria-label="Move up" disabled=${i === 0} onClick=${() => move(i, i - 1)}><${Icon} name="arrowUp" /></button>
                  <button class="icon-btn" aria-label="Move down" disabled=${i === items.length - 1} onClick=${() => move(i, i + 1)}><${Icon} name="arrowDown" /></button>
                  <button class="icon-btn" aria-label="Remove" onClick=${() => setItems(items.filter((_, j) => j !== i))}><${Icon} name="x" /></button>
                </div>
              </div>`;
            })}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <${TrickPicker} tricks=${ctx.tricks} onPick=${(t) => setItems([...items, { id: uid(), trick_id: t.id }])} />
            <button class="btn" onClick=${() => setItems([...items, { id: uid(), title: "" }])}><${Icon} name="plus" />Add a bit</button>
          </div>
        </div>
        <${Field} label="NOTES"><${Area} rows="4" value=${draft.notes} placeholder="Stage size, tech, contact on site…" onInput=${(v) => set({ notes: v })} /><//>
      </div>
    </div>
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} onSave=${save} onDelete=${remove} what="set list" />`;
}

function ShowMode({ title, when, rows, total, onClose }) {
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  return html`<div class="show">
    <div class="close" style="display:flex;gap:8px">
      <button class="btn" onClick=${() => print()}>Print</button>
      <button class="btn" onClick=${onClose}><${Icon} name="x" />Close</button>
    </div>
    <div class="inner">
      <h1>${title}</h1>
      <div class="when">${[when, fmtMin(total)].filter(Boolean).join(" · ")}</div>
      <ol>${rows.map((r) => html`<li><div>${r.name}${r.notes && html`<small>${r.notes}</small>`}</div><span class="mm">${r.min ? `${r.min}′` : ""}</span></li>`)}</ol>
    </div>
  </div>`;
}

// ---------- playlists ----------

function PlaylistList({ ctx }) {
  const { playlists } = ctx;
  return html`
    <div class="bar">
      <h1>Playlists</h1>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => go("playlists/new")}><${Icon} name="plus" />New playlist</button>
    </div>
    <div class="scroll pad">
      ${!playlists
        ? null
        : playlists.length === 0
          ? html`<div class="empty"><h2>No playlists yet</h2><p>Keep your walk-on music and sound cues together, with links or uploaded audio.</p><button class="btn primary" onClick=${() => go("playlists/new")}><${Icon} name="plus" />New playlist</button></div>`
          : html`<div class="rows">${playlists.map((p) => {
              const secs = p.tracks.reduce((n, t) => n + (t.duration_sec || 0), 0);
              const linked = (ctx.setlists || []).find((s) => s.id === p.setlist_id);
              return html`<button class="row" onClick=${() => go(`playlists/${p.id}`)}>
                <div class="ico"><${Icon} name="music" /></div>
                <div class="txt"><div class="name">${p.name}</div><div class="sub">${linked ? `For ${linked.name}` : p.description || " "}</div></div>
                <div class="right">${p.tracks.length} tracks${secs ? ` · ${fmtSec(secs)}` : ""}</div>
              </button>`;
            })}</div>`}
    </div>`;
}

const BLANK_PLAYLIST = { name: "", description: "", setlist_id: null, tracks: [] };

function PlaylistEditor({ id, ctx }) {
  const { draft, set, dirty, setDirty, isNew, missing } = useDraft(id, ctx.playlists, BLANK_PLAYLIST);
  const { busy, err, save, remove } = useSaver({ path: "playlists", id, draft, isNew, setDirty, ctx, which: "playlists", back: "playlists", what: "playlist" });
  useLeaveGuard(dirty);
  const tracks = draft?.tracks || [];
  const setTracks = (next) => set({ tracks: next });
  const { move, props } = useReorder(tracks, setTracks);
  if (missing) return html`<${BackBar} to="playlists" label="Playlists" /><div class="empty"><h2>Playlist not found</h2></div>`;
  if (!draft) return html`<${BackBar} to="playlists" label="Playlists" />`;
  const upd = (i, patch) => setTracks(tracks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const secs = tracks.reduce((n, t) => n + (t.duration_sec || 0), 0);

  return html`
    <${BackBar} to="playlists" label="Playlists" />
    <div class="scroll pad">
      <div class="editor">
        <input class="title-input" placeholder="Playlist name" value=${draft.name} onInput=${(e) => set({ name: e.target.value })} autofocus=${isNew} />
        <div class="cols">
          <${Field} label="FOR SET LIST">
            <select class="select" value=${draft.setlist_id || ""} onChange=${(e) => set({ setlist_id: e.target.value || null })}>
              <option value="">None</option>
              ${(ctx.setlists || []).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
            </select>
          <//>
          <${Field} label="DESCRIPTION"><${Text} value=${draft.description} placeholder="Walk-on, background, cues…" onInput=${(v) => set({ description: v })} /><//>
        </div>
        <div class="section">
          <div style="display:flex;align-items:center;gap:12px">
            <h3 style="margin:0;flex:1">Tracks</h3>
            ${secs > 0 && html`<div class="total">Total <b>${fmtSec(secs)}</b></div>`}
          </div>
          <div class="order">
            ${tracks.map((t, i) => html`<div key=${t.id} ...${props(i)}>
              <div class="grip" title="Drag to reorder"><${Icon} name="grip" /></div>
              <div class="num">${i + 1}</div>
              <div class="body">
                <div class="line">
                  <input class="input" style="flex:2;min-width:140px" placeholder="Title" value=${t.title} onInput=${(e) => upd(i, { title: e.target.value })} />
                  <input class="input" style="flex:1;min-width:110px" placeholder="Artist" value=${t.artist || ""} onInput=${(e) => upd(i, { artist: e.target.value })} />
                  <input class="input mins" placeholder="3:20" aria-label="Length" value=${fmtSec(t.duration_sec)} onChange=${(e) => upd(i, { duration_sec: parseSec(e.target.value) })} />
                </div>
                <div class="line">
                  <input class="input" style="flex:2;min-width:160px" placeholder="Cue — when to play it" value=${t.cue || ""} onInput=${(e) => upd(i, { cue: e.target.value })} />
                  <select class="select" style="flex:1;min-width:140px" value=${t.trick_id || ""} onChange=${(e) => upd(i, { trick_id: e.target.value || undefined })}>
                    <option value="">No trick</option>
                    ${(ctx.tricks || []).map((x) => html`<option value=${x.id}>${x.name}</option>`)}
                  </select>
                </div>
                <div class="line">
                  <input class="input" style="flex:1;min-width:160px" placeholder="Link (Spotify, YouTube, Dropbox…)" inputmode="url" value=${t.url || ""} onInput=${(e) => upd(i, { url: e.target.value })} />
                  ${t.url && html`<a class="icon-btn" href=${/^https?:/.test(t.url) ? t.url : `https://${t.url}`} target="_blank" rel="noopener" aria-label="Open link"><${Icon} name="external" /></a>`}
                  ${!t.file_key && html`<${AudioUpload} ctx=${ctx} onAdded=${(k) => upd(i, { file_key: k })} />`}
                </div>
                ${t.file_key && html`<div class="line">
                  <audio controls preload="none" src=${mediaUrl(t.file_key)}></audio>
                  <button class="icon-btn" aria-label="Remove audio file" onClick=${() => upd(i, { file_key: undefined })}><${Icon} name="x" /></button>
                </div>`}
              </div>
              <div class="acts">
                <button class="icon-btn" aria-label="Move up" disabled=${i === 0} onClick=${() => move(i, i - 1)}><${Icon} name="arrowUp" /></button>
                <button class="icon-btn" aria-label="Move down" disabled=${i === tracks.length - 1} onClick=${() => move(i, i + 1)}><${Icon} name="arrowDown" /></button>
                <button class="icon-btn" aria-label="Remove" onClick=${() => setTracks(tracks.filter((_, j) => j !== i))}><${Icon} name="x" /></button>
              </div>
            </div>`)}
          </div>
          <div><button class="btn" onClick=${() => setTracks([...tracks, { id: uid(), title: "" }])}><${Icon} name="plus" />Add track</button></div>
        </div>
      </div>
    </div>
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} onSave=${save} onDelete=${remove} what="playlist" />`;
}

function AudioUpload({ onAdded, ctx }) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  return html`<button class="btn" disabled=${busy} onClick=${() => input.current.click()}>
    <${Icon} name="music" />${busy ? "Uploading…" : "Upload audio"}
    <input ref=${input} type="file" hidden accept="audio/*" onChange=${async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      setBusy(true);
      try { onAdded((await upload(f)).key); } catch (err) { ctx.setToast(err.message); }
      setBusy(false);
    }} />
  </button>`;
}

// ---------- chat ----------

const IDEAS = [
  "Add a trick from a photo of the prop",
  "Build a 30-minute corporate set from my ready tricks",
  "Which of my tricks need batteries or a reset?",
  "Make a walk-on playlist for my next show",
];

function Chat({ ctx }) {
  const [chatId, setChatId] = useState(() => store.get("chat"));
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [text, setText] = useState("");
  const [pics, setPics] = useState([]); // {key?, preview, loading}
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const scroller = useRef();
  const fileInput = useRef();
  const box = useRef();
  const created = useRef(null); // a chat made by send(): its messages are already on screen

  const loadChats = () => api("chats").then(setChats).catch(() => {});
  useEffect(() => { loadChats(); }, []);
  useEffect(() => {
    store.set("chat", chatId);
    if (!chatId) { setMessages([]); return; }
    if (created.current === chatId) return;
    api(`chats/${chatId}`).then((r) => setMessages(r.messages)).catch((e) => {
      if (e.status === 404) setChatId(null);
    });
  }, [chatId]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const addPics = async (files) => {
    for (const f of files.filter((f) => f.type.startsWith("image/"))) {
      const local = { id: uid(), preview: URL.createObjectURL(f), loading: true };
      setPics((p) => [...p, local]);
      try {
        const r = await upload(f);
        if (!/\.(jpg|png|webp|gif)$/.test(r.key)) throw new Error("Use a JPEG or PNG photo for the chat.");
        setPics((p) => p.map((x) => (x.id === local.id ? { ...x, key: r.key, loading: false } : x)));
      } catch (e) {
        ctx.setToast(e.message);
        setPics((p) => p.filter((x) => x.id !== local.id));
      }
    }
  };

  const send = async (override) => {
    const body = (override ?? text).trim();
    const ready = pics.filter((p) => p.key);
    if (busy || (!body && !ready.length) || pics.some((p) => p.loading)) return;
    setBusy(true);
    setText("");
    setPics([]);
    let id = chatId;
    try {
      if (!id) {
        id = (await api("chats", { method: "POST", body: {} })).id;
        created.current = id;
        setChatId(id);
      }
    } catch (e) {
      ctx.setToast(e.message);
      setText(body);
      setPics(pics);
      setBusy(false);
      return;
    }
    const images = ready.map((p) => p.key);
    setMessages((m) => [...m, { role: "user", text: body, images, at: Date.now() }, { role: "assistant", text: "", steps: [], pending: true }]);
    const patchLast = (fn) => setMessages((m) => (m.length && m[m.length - 1].role === "assistant" ? [...m.slice(0, -1), fn(m[m.length - 1])] : m));
    try {
      const res = await api(`chats/${id}/messages`, { method: "POST", body: { text: body, images, today: today() }, raw: true });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t === "text") patchLast((m) => ({ ...m, text: m.text + ev.d }));
          else if (ev.t === "step") patchLast((m) => ({ ...m, steps: [...m.steps, ev.d] }));
          else if (ev.t === "changed") ctx.load(ev.what);
          else if (ev.t === "error") patchLast((m) => ({ ...m, text: m.text + (m.text ? "\n\n" : "") + `⚠️ ${ev.d}` }));
        }
      }
    } catch (e) {
      patchLast((m) => ({ ...m, text: m.text + (m.text ? "\n\n" : "") + `⚠️ ${e.message}` }));
    }
    patchLast((m) => ({ ...m, pending: false }));
    setBusy(false);
    loadChats();
  };

  const newChat = () => { if (!busy) { setChatId(null); setShowHistory(false); } };
  const current = chats.find((c) => c.id === chatId);

  return html`<aside class="chat"
      onDragOver=${(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${(e) => { e.preventDefault(); setOver(false); addPics([...e.dataTransfer.files]); }}>
    <div class="chat-head">
      <div class="t">${current ? current.title : "New chat"}</div>
      <button class="icon-btn" aria-label="Past chats" onClick=${() => setShowHistory(!showHistory)}><${Icon} name="history" /></button>
      <button class="icon-btn" aria-label="New chat" disabled=${busy} onClick=${newChat}><${Icon} name="newchat" /></button>
    </div>
    ${showHistory && html`<div class="history">
      ${chats.length === 0 && html`<div class="menu none" style="position:static;box-shadow:none;border:0">No past chats yet.</div>`}
      ${chats.map((c) => html`<div class=${`opt ${c.id === chatId ? "on" : ""}`}>
        <button class="t" style="text-align:left" disabled=${busy} onClick=${() => { setChatId(c.id); setShowHistory(false); }}>${c.title}</button>
        <span class="d">${ago(c.updated_at)}</span>
        <button class="icon-btn" aria-label="Delete chat" disabled=${busy} onClick=${async () => {
          if (!confirm("Delete this chat?")) return;
          await api(`chats/${c.id}`, { method: "DELETE" }).catch((e) => ctx.setToast(e.message));
          if (c.id === chatId) setChatId(null);
          loadChats();
        }}><${Icon} name="trash" /></button>
      </div>`)}
    </div>`}
    <div class="msgs" ref=${scroller} onClick=${() => setShowHistory(false)}>
      ${messages.length === 0 && html`<div class="hello">
        <h2>What should we work on?</h2>
        <p>Ask about your tricks, build a set, or send a photo of a prop and I'll add it to your library.</p>
        <div class="ideas">${IDEAS.map((i) => html`<button class="idea" onClick=${() => (i.includes("photo") ? fileInput.current.click() : send(i))}>${i}</button>`)}</div>
      </div>`}
      ${messages.map((m) => m.role === "user"
        ? html`<div class="msg user">
            ${m.images?.length > 0 && html`<div class="pics">${m.images.map((k) => html`<img src=${mediaUrl(k)} alt="" />`)}</div>`}
            ${m.text}
          </div>`
        : html`<div class="msg bot">
            ${m.steps?.length > 0 && html`<div class="steps">${m.steps.map((s) => html`<div class="step"><${Icon} name="check" />${s}</div>`)}</div>`}
            ${m.text && html`<div dangerouslySetInnerHTML=${{ __html: markdown(m.text) }}></div>`}
            ${m.pending && html`<div class="typing" aria-label="Working"><i></i><i></i><i></i></div>`}
          </div>`)}
    </div>
    <div class=${`composer ${over ? "over" : ""}`}>
      ${pics.length > 0 && html`<div class="attach">${pics.map((p) => html`<div class=${`thumb ${p.loading ? "loading" : ""}`}>
        <img src=${p.preview} alt="" />
        <button class="x" aria-label="Remove photo" onClick=${() => setPics(pics.filter((x) => x !== p))}><${Icon} name="x" /></button>
      </div>`)}</div>`}
      <textarea ref=${box} rows="1" placeholder="Ask Backstage anything…" value=${text}
        onInput=${(e) => setText(e.target.value)}
        onPaste=${(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addPics(f); } }}
        onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); } }}></textarea>
      <div class="row2">
        <button class="icon-btn" aria-label="Add photo" onClick=${() => fileInput.current.click()}><${Icon} name="plus" /></button>
        <input ref=${fileInput} type="file" hidden multiple accept="image/*" onChange=${(e) => { addPics([...e.target.files]); e.target.value = ""; }} />
        <div class="spacer"></div>
        <button class="send" aria-label="Send" disabled=${busy || (!text.trim() && !pics.some((p) => p.key)) || pics.some((p) => p.loading)} onClick=${() => send()}><${Icon} name="up" /></button>
      </div>
    </div>
  </aside>`;
}

// ---------- settings ----------

function Settings({ onClose, onOut }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const change = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("password", { method: "POST", body: { current, next } });
      setMsg({ ok: true, text: "Password changed. Other devices are signed out." });
      setCurrent("");
      setNext("");
    } catch (e2) {
      setMsg({ ok: false, text: e2.message });
    }
    setBusy(false);
  };
  const signOut = async () => {
    await api("logout", { method: "POST" }).catch(() => {});
    onOut();
  };
  return html`<div class="modal-wrap" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <form class="modal" onSubmit=${change}>
      <h2>Settings</h2>
      <${Field} label="CURRENT PASSWORD"><input class="input" type="password" autocomplete="current-password" value=${current} onInput=${(e) => setCurrent(e.target.value)} /><//>
      <${Field} label="NEW PASSWORD (10+ CHARACTERS)"><input class="input" type="password" autocomplete="new-password" value=${next} onInput=${(e) => setNext(e.target.value)} /><//>
      ${msg && html`<div class=${msg.ok ? "msg-ok" : "msg-err"}>${msg.text}</div>`}
      <div class="acts">
        <button type="button" class="btn" onClick=${signOut}>Sign out</button>
        <div style="flex:1"></div>
        <button type="button" class="btn" onClick=${onClose}>Close</button>
        <button class="btn primary" disabled=${busy || !current || next.length < 10}>Change password</button>
      </div>
    </form>
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
