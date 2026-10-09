// Backstage: Jon's private trick library, set lists and playlists, with a chat assistant.
// Plain ES module, no build step. Preact + htm are vendored in ./vendor.
import { html, render, useState, useEffect, useRef, useMemo, useCallback } from "./vendor/preact-htm.js";
import { DEMO_TRICKS, DEMO_SETLISTS, DEMO_PLAYLISTS, DEMO_EQUIPMENT, DEMO_TASKS, DEMO_NOTES, DEMO_FILES, DEMO_LINKS, adopt } from "./demo.js";

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
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  checkbox: "M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  note: "M4 4h16v12l-6 4H4zM14 20v-4h6M8 9h8M8 13h5",
  pin: "M12 17v5M8 3h8l-1 6 3 4H6l3-4z",
  folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  rows: "M3 5h18M3 12h18M3 19h18",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
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

// The six library sections: [route, desktop label, phone label, icon].
const SECTIONS = [
  ["tricks", "Tricks", "Tricks", "wand"],
  ["gear", "Equipment", "Gear", "box"],
  ["sets", "Set lists", "Sets", "list"],
  ["playlists", "Playlists", "Music", "music"],
  ["tasks", "Tasks", "Tasks", "checkbox"],
  ["notes", "Notes", "Notes", "note"],
  ["files", "Files", "Files", "folder"],
  ["links", "Links", "Links", "link"],
  ["stats", "Stats", "Stats", "chart"],
];
// Phones show these in the bottom bar; the rest live under "More".
const PHONE_MAIN = ["tricks", "gear", "sets", "tasks"];

function Backstage({ onOut }) {
  const route = useHashRoute();
  const [tricks, setTricks] = useState(null);
  const [setlists, setSetlists] = useState(null);
  const [playlists, setPlaylists] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [notes, setNotes] = useState(null);
  const [files, setFiles] = useState(null);
  const [links, setLinks] = useState(null);
  const [more, setMore] = useState(false);
  const [pane, setPane] = useState(() => (matchMedia("(max-width: 900px)").matches ? "lib" : "both"));
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [show, setShow] = useState(null);

  const load = useCallback(async (which) => {
    const all = !which || which.length === 0;
    const want = (k) => all || which.includes(k);
    const jobs = [];
    if (want("tricks")) jobs.push(api("tricks").then(setTricks));
    if (want("setlists")) jobs.push(api("setlists").then(setSetlists));
    if (want("playlists")) jobs.push(api("playlists").then(setPlaylists));
    if (want("equipment")) jobs.push(api("equipment").then(setEquipment));
    if (want("tasks")) jobs.push(api("tasks").then(setTasks));
    if (want("notes")) jobs.push(api("notes").then(setNotes));
    if (want("files")) jobs.push(api("files").then(setFiles));
    if (want("links")) jobs.push(api("links").then(setLinks));
    await Promise.all(jobs).catch((e) => setToast(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // While a section is empty it shows samples; `real` is what's actually saved.
  const sample = (list, demo) => (list && list.length === 0 ? demo : list);
  const ctx = {
    tricks: sample(tricks, DEMO_TRICKS),
    setlists: sample(setlists, DEMO_SETLISTS),
    playlists: sample(playlists, DEMO_PLAYLISTS),
    equipment: sample(equipment, DEMO_EQUIPMENT),
    tasks: sample(tasks, DEMO_TASKS),
    notes: sample(notes, DEMO_NOTES),
    files: sample(files, DEMO_FILES),
    links: sample(links, DEMO_LINKS),
    real: { tricks, setlists, playlists, equipment, tasks, notes, files, links },
    setTasks, load, setToast, setShow,
  };
  const [section, id] = route;
  const tab = SECTIONS.some(([k]) => k === section) ? section : "tricks";

  let view;
  if (section === "sets" && id) view = html`<${SetlistEditor} key=${id} id=${id} ctx=${ctx} />`;
  else if (section === "sets") view = html`<${SetlistList} ctx=${ctx} />`;
  else if (section === "playlists" && id) view = html`<${PlaylistEditor} key=${id} id=${id} ctx=${ctx} />`;
  else if (section === "playlists") view = html`<${PlaylistList} ctx=${ctx} />`;
  else if (section === "gear" && id) view = html`<${GearEditor} key=${id} id=${id} ctx=${ctx} />`;
  else if (section === "gear") view = html`<${GearList} ctx=${ctx} />`;
  else if (section === "tasks") view = html`<${TaskPage} ctx=${ctx} />`;
  else if (section === "notes" && id) view = html`<${NoteEditor} key=${id} id=${id} ctx=${ctx} />`;
  else if (section === "notes") view = html`<${NoteList} ctx=${ctx} />`;
  else if (section === "files") view = html`<${FilesPage} ctx=${ctx} />`;
  else if (section === "links") view = html`<${LinksPage} ctx=${ctx} />`;
  else if (section === "stats") view = html`<${StatsPage} ctx=${ctx} />`;
  else if (section === "tricks" && id) view = html`<${TrickEditor} key=${id} id=${id} ctx=${ctx} />`;
  else view = html`<${TrickList} ctx=${ctx} />`;

  const setTab = (t) => { setMore(false); go(t); if (pane === "chat") setPane("lib"); };
  const inMore = !PHONE_MAIN.includes(tab);
  const openTasks = (tasks || []).filter((t) => !t.done).length;

  return html`
    <div class="shell">
      <header class="top">
        <div class="brand"><div class="badge">JM</div><span class="word">Backstage</span></div>
        <nav class="tabs">
          ${SECTIONS.map(([k, label]) => html`<button class=${`tab ${tab === k && pane !== "chat" ? "on" : ""}`} onClick=${() => setTab(k)}>
            ${label}${k === "tasks" && openTasks > 0 ? html`<span class="count-badge">${openTasks}</span>` : null}
          </button>`)}
        </nav>
        <span class="phone-title">${pane === "chat" ? "Chat" : SECTIONS.find(([k]) => k === tab)[1]}</span>
        <div class="spacer"></div>
        <button class=${`ghost chat-toggle ${pane === "chat" ? "on" : ""}`} onClick=${() => setPane(pane === "chat" ? "lib" : "chat")} aria-label="Chat"><${Icon} name="chat" /><span>Chat</span></button>
        <a class="ghost view-site" href="/" target="_blank" rel="noopener"><${Icon} name="external" /><span class="word">View site</span></a>
        <button class="ghost" onClick=${() => setSettings(true)} aria-label="Settings"><${Icon} name="settings" /><span class="word">Settings</span></button>
      </header>
      <main class=${`split ${pane === "chat" ? "show-chat" : pane === "lib" ? "show-lib" : ""}`}>
        <${Chat} ctx=${ctx} />
        <section class="stage">${view}</section>
      </main>
      <nav class="bottombar">
        ${SECTIONS.filter(([k]) => PHONE_MAIN.includes(k)).map(([k, , short, icon]) => html`<button class=${tab === k && pane !== "chat" ? "on" : ""} onClick=${() => setTab(k)}>
          <span class="bb-icon"><${Icon} name=${icon} />${k === "tasks" && openTasks > 0 ? html`<i class="bb-badge">${openTasks}</i>` : null}</span>
          <span>${short}</span>
        </button>`)}
        <button class=${(inMore && pane !== "chat") || more ? "on" : ""} onClick=${() => setMore(!more)} aria-expanded=${more}>
          <span class="bb-icon"><${Icon} name="more" /></span>
          <span>More</span>
        </button>
      </nav>
    </div>
    ${more && html`<div class="sheet-wrap" onClick=${(e) => e.target === e.currentTarget && setMore(false)}>
      <div class="sheet" role="menu">
        ${SECTIONS.filter(([k]) => !PHONE_MAIN.includes(k)).map(([k, label, , icon]) => html`<button role="menuitem" class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>
          <span class="sheet-ico"><${Icon} name=${icon} /></span>${label}
        </button>`)}
      </div>
    </div>`}
    ${show && html`<${ShowMode} ...${show} onClose=${() => setShow(null)} />`}
    ${settings && html`<${Settings} onClose=${() => setSettings(false)} onOut=${onOut} />`}
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
  `;
}

// ---------- tricks ----------

function Cover({ trick }) {
  const img = trick.images.find(isImageKey);
  return html`<div class="cover">
    ${img
      ? html`<img src=${mediaUrl(img)} alt="" loading="lazy" />`
      : trick.emoji
        ? html`<span class="emoji">${trick.emoji}</span>`
        : html`<span class="initial">${(trick.name[0] || "?").toUpperCase()}</span>`}
  </div>`;
}

function SampleNote({ list, what, newPath }) {
  if (!list?.[0]?.demo) return null;
  return html`<div class="sample-note">
    <b>These are samples</b> to show how this page works. They disappear when you add your own ${what}.
    Open one and press <b>Add to my library</b> to keep it, or <a href=${`#/${newPath}`}>start fresh</a>.
  </div>`;
}
const SampleTag = ({ item }) => (item.demo ? html`<span class="sample-tag">Sample</span>` : null);

const uniqueSorted = (vals) => [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
const money = (n) => (n || n === 0 ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "");

function TrickList({ ctx }) {
  const [q, setQ] = useState(() => store.get("trick-q") || "");
  const [status, setStatus] = useState(() => store.get("trick-status") || "");
  const [category, setCategory] = useState(() => store.get("trick-category") || "");
  const [tag, setTag] = useState(() => store.get("trick-tag") || "");
  const [view, setView] = useState(() => store.get("trick-view") || "grid");
  useEffect(() => {
    store.set("trick-q", q || null);
    store.set("trick-status", status || null);
    store.set("trick-category", category || null);
    store.set("trick-tag", tag || null);
    store.set("trick-view", view);
  }, [q, status, category, tag, view]);
  const { tricks } = ctx;
  const categories = useMemo(() => uniqueSorted((tricks || []).map((t) => t.category)), [tricks]);
  const tags = useMemo(() => uniqueSorted((tricks || []).flatMap((t) => t.tags)), [tricks]);
  const shown = useMemo(() => {
    if (!tricks) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return tricks.filter((t) => {
      if (status && t.status !== status) return false;
      if (category && t.category.toLowerCase() !== category.toLowerCase()) return false;
      if (tag && !t.tags.includes(tag)) return false;
      const hay = [t.name, t.category, t.effect, t.props, t.location, t.source, t.notes, ...t.tags, ...t.audiences].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [tricks, q, status, category, tag]);
  const filtered = q || status || category || tag;
  const clear = () => { setQ(""); setStatus(""); setCategory(""); setTag(""); };

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
    <div class="filters">
      <select class=${`select mini ${category ? "set" : ""}`} value=${category} onChange=${(e) => setCategory(e.target.value)} aria-label="Category">
        <option value="">All categories</option>
        ${categories.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
      <select class=${`select mini ${tag ? "set" : ""}`} value=${tag} onChange=${(e) => setTag(e.target.value)} aria-label="Tag">
        <option value="">All tags</option>
        ${tags.map((t) => html`<option value=${t}>${t}</option>`)}
      </select>
      <span class="count">${tricks ? `${shown.length} ${shown.length === 1 ? "trick" : "tricks"}` : ""}</span>
      ${filtered && html`<button class="link-btn" onClick=${clear}>Clear</button>`}
      <div class="grow"></div>
      <div class="seg" role="group" aria-label="View">
        <button class=${view === "grid" ? "on" : ""} aria-label="Grid view" aria-pressed=${view === "grid"} onClick=${() => setView("grid")}><${Icon} name="grid" /></button>
        <button class=${view === "list" ? "on" : ""} aria-label="List view" aria-pressed=${view === "list"} onClick=${() => setView("list")}><${Icon} name="rows" /></button>
      </div>
    </div>
    <div class="scroll pad">
      <${SampleNote} list=${tricks} what="tricks" newPath="tricks/new" />
      ${!tricks
        ? null
        : tricks.length === 0
          ? html`<div class="empty"><h2>Your trick library is empty</h2><p>Add your first trick, or send the chat a photo of a prop and it'll fill in the details.</p><button class="btn primary" onClick=${() => go("tricks/new")}><${Icon} name="plus" />New trick</button></div>`
          : shown.length === 0
            ? html`<div class="empty"><h2>No matches</h2><p>Nothing fits those filters.</p><button class="btn" onClick=${clear}>Clear filters</button></div>`
            : view === "list"
              ? html`<div class="tlist">
                  ${shown.map((t) => html`<button class="trow" onClick=${() => go(`tricks/${t.id}`)}>
                    <div class="tthumb"><${Cover} trick=${t} /></div>
                    <div class="tmain">
                      <div class="name">${t.name} <${SampleTag} item=${t} /></div>
                      <div class="sub">${[t.category, t.duration_min ? `${t.duration_min} min` : "", t.location].filter(Boolean).join(" · ") || " "}</div>
                      ${t.tags.length > 0 && html`<div class="ttags">${t.tags.slice(0, 4).map((x) => html`<span class="ttag">${x}</span>`)}${t.tags.length > 4 ? html`<span class="ttag">+${t.tags.length - 4}</span>` : null}</div>`}
                    </div>
                    <div class="tside">
                      <span class=${`pill ${t.status}`}>${statusLabel(t.status)}</span>
                      ${money(t.cost) && html`<span class="price">${money(t.cost)}</span>`}
                    </div>
                  </button>`)}
                </div>`
              : html`<div class="grid">
                  ${shown.map((t) => html`<button class="card" onClick=${() => go(`tricks/${t.id}`)}>
                    <${Cover} trick=${t} />
                    <div class="meta">
                      <div class="name">${t.name}</div>
                      <div class="sub">${[t.category, t.duration_min ? `${t.duration_min} min` : ""].filter(Boolean).join(" · ") || " "}</div>
                      <div class="pills"><span class=${`pill ${t.status}`}>${statusLabel(t.status)}</span><${SampleTag} item=${t} /></div>
                    </div>
                  </button>`)}
                </div>`}
    </div>`;
}

const BLANK_TRICK = {
  name: "", category: "", status: "ready", effect: "", method: "", props: "", reset: "", duration_min: null,
  location: "", source: "", cost: null, purchase_url: "", audiences: [], tags: [], links: [], images: [], notes: "",
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
    if (fromList) { setDraft(structuredClone(fromList)); setMissing(false); }
    else if (list && !draft?.demo) setMissing(true);
  }, [fromList, list]);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  return { draft, set, dirty, setDirty, isNew, missing, setDraft };
}

function SaveBar({ dirty, busy, err, isNew, sample, onSave, onDelete, what }) {
  const note = err || (sample ? `This is a sample ${what}. Edit it if you like, then add it.` : dirty ? "Unsaved changes" : "All changes saved");
  return html`<div class="foot">
    <span class=${`note ${err ? "err" : ""}`}>${note}</span>
    ${!isNew && !sample && html`<button class="btn danger" onClick=${onDelete}><${Icon} name="trash" />Delete</button>`}
    <button class="btn primary" disabled=${(!dirty && !sample) || busy} onClick=${onSave}>
      ${busy ? "Saving…" : sample ? "Add to my library" : isNew ? `Add ${what}` : "Save"}
    </button>
  </div>`;
}

function useSaver({ path, id, draft, isNew, setDirty, ctx, which, back, what }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      // A sample is saved as a brand-new record.
      const asNew = isNew || !!draft.demo;
      const body = draft.demo ? adopt(which, draft) : draft;
      const saved = await api(asNew ? path : `${path}/${id}`, { method: asNew ? "POST" : "PUT", body });
      setDirty(false);
      await ctx.load([which]);
      if (asNew) location.replace(`#/${back}/${saved.id}`);
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
function useLeaveGuard(dirty, inApp = true) {
  useEffect(() => {
    if (inApp) unsaved = dirty;
    if (!dirty) return;
    const on = (e) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", on);
    return () => { removeEventListener("beforeunload", on); if (inApp) unsaved = false; };
  }, [dirty]);
}

function BackBar({ to, label, children }) {
  return html`<div class="bar">
    <button class="ghost" onClick=${() => go(to)} aria-label=${`Back to ${label}`}><${Icon} name="back" /><span class="back-word">${label}</span></button>
    <div class="grow"></div>
    ${children}
  </div>`;
}

// ---------- share links ----------

const SHARE_WHAT = {
  setlist: "the running order, timings, notes, each trick's props, reset and photos, a packing checklist, and any playlist linked to this set",
  playlist: "the tracks, cues, links and uploaded audio",
  trick: "the name, photos, what the audience sees, props, reset and where it lives",
};

function ShareButton({ kind, item, isNew, ctx }) {
  const [open, setOpen] = useState(false);
  if (isNew || item.demo) return null;
  return html`
    <button class="btn" onClick=${() => setOpen(true)}><${Icon} name="share" />Share</button>
    ${open && html`<${ShareDialog} kind=${kind} item=${item} ctx=${ctx} onClose=${() => setOpen(false)} />`}`;
}

function ShareDialog({ kind, item, ctx, onClose }) {
  const [link, setLink] = useState(undefined); // undefined = loading, null = off
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const path = `shares/${kind}/${item.id}`;
  useEffect(() => { api(path).then(setLink).catch((e) => setErr(e.message)); }, []);
  const act = async (method) => {
    setBusy(true);
    setErr("");
    try {
      const r = await api(path, { method });
      setLink(method === "DELETE" ? null : r);
      if (method === "DELETE") ctx.setToast("Link turned off");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      ctx.setToast("Link copied");
    } catch {
      ctx.setToast("Couldn't copy. Press and hold the link to copy it.");
    }
  };
  const canShare = typeof navigator.share === "function";
  return html`<div class="modal-wrap" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-label="Share">
      <h2>Share “${item.name}”</h2>
      <p class="modal-p">Anyone with the link can view ${SHARE_WHAT[kind]}. They can't change anything. Methods, costs and your private notes are never shared.</p>
      ${link === undefined && !err && html`<p class="modal-p">Loading…</p>`}
      ${link === null && html`<div class="acts"><button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${() => act("POST")}><${Icon} name="link" />Create link</button></div>`}
      ${link && html`
        <input class="input" readonly value=${link.url} onFocus=${(e) => e.target.select()} aria-label="Share link" />
        <div class="acts share-acts">
          <button class="btn danger" disabled=${busy} onClick=${() => confirm("Turn off this link? Anyone who has it won't be able to open it.") && act("DELETE")}>Turn off link</button>
          <div style="flex:1"></div>
          <a class="btn" href=${link.url} target="_blank" rel="noopener"><${Icon} name="external" />Open</a>
          ${canShare
            ? html`<button class="btn primary" onClick=${() => navigator.share({ title: item.name, url: link.url }).catch(() => {})}><${Icon} name="share" />Send</button>`
            : html`<button class="btn primary" onClick=${copy}>Copy link</button>`}
        </div>
        ${canShare && html`<button class="link-btn" onClick=${copy}>Copy link instead</button>`}`}
      ${err && html`<div class="msg-err">${err}</div>`}
    </div>
  </div>`;
}

// The big name at the top of an editor: wraps onto more lines instead of cutting off long names.
function TitleInput({ value, onInput, placeholder, autofocus }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return html`<textarea ref=${ref} class="title-input" rows="1" placeholder=${placeholder} value=${value} autofocus=${autofocus}
    onInput=${(e) => onInput(e.target.value.replace(/\n/g, " "))}
    onKeyDown=${(e) => e.key === "Enter" && e.preventDefault()}></textarea>`;
}

function Field({ label, children }) {
  return html`<label class="field"><span>${label}</span>${children}</label>`;
}

function Text({ value, onInput, ...rest }) {
  return html`<input class="input" value=${value ?? ""} onInput=${(e) => onInput(e.target.value)} ...${rest} />`;
}

// Text boxes start small and grow with what's typed (up to a point, then scroll).
function Area({ value, onInput, rows = 2, max = 420, ...rest }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight) el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
  }, [value]);
  return html`<textarea ref=${ref} class="textarea" rows=${rows} value=${value ?? ""} onInput=${(e) => onInput(e.target.value)} ...${rest}></textarea>`;
}

function TagInput({ value, onChange, placeholder, suggestions = [] }) {
  const [text, setText] = useState("");
  const listId = useMemo(() => `tags-${uid()}`, []);
  const add = () => {
    const v = text.trim().replace(/,$/, "");
    if (v && !value.includes(v)) onChange([...value, v]);
    setText("");
  };
  return html`<div class="taglist">
    ${value.map((t) => html`<span class="tag">${t}<button type="button" aria-label=${`Remove ${t}`} onClick=${() => onChange(value.filter((x) => x !== t))}><${Icon} name="x" /></button></span>`)}
    <input value=${text} placeholder=${value.length ? "" : placeholder} list=${listId}
      onInput=${(e) => {
        // Picking from the suggestion list adds the tag straight away.
        if (e.inputType === "insertReplacementText" || (!e.inputType && suggestions.includes(e.target.value))) {
          const v = e.target.value.trim();
          if (v && !value.includes(v)) onChange([...value, v]);
          setText("");
        } else setText(e.target.value);
      }}
      onKeyDown=${(e) => {
        if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
        else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
      }}
      onBlur=${add} />
    <datalist id=${listId}>${suggestions.filter((x) => !value.includes(x)).map((x) => html`<option value=${x} />`)}</datalist>
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

// The trick page is split into tabs so it never turns into one long scroll.
// Each entry: [key, label, does this tab hold anything?]
const TRICK_TABS = [
  ["overview", "Overview", (t) => t.images.length || t.effect || t.notes],
  ["perform", "Performance", (t) => t.method || t.props || t.reset],
  ["tags", "Tags & links", (t) => t.audiences.length || t.tags.length || t.links.length],
  ["buying", "Buying", (t) => t.cost != null || t.source || t.purchase_url],
];

function TrickEditor({ id, ctx }) {
  const { draft, set, dirty, setDirty, isNew, missing } = useDraft(id, ctx.tricks, BLANK_TRICK);
  const [tab, setTabState] = useState(() => (TRICK_TABS.some(([k]) => k === store.get("trick-tab")) ? store.get("trick-tab") : "overview"));
  const setTab = (k) => { setTabState(k); store.set("trick-tab", k); };
  const { busy, err, save, remove } = useSaver({ path: "tricks", id, draft, isNew, setDirty, ctx, which: "tricks", back: "tricks", what: "trick" });
  useLeaveGuard(dirty);
  if (missing) return html`<${BackBar} to="tricks" label="Tricks" /><div class="empty"><h2>Trick not found</h2><p>It may have been deleted.</p></div>`;
  if (!draft) return html`<${BackBar} to="tricks" label="Tricks" />`;
  const usedIn = (ctx.setlists || []).filter((s) => s.items.some((i) => i.trick_id === id));
  const real = ctx.real.tricks || [];
  const allTags = uniqueSorted(real.flatMap((t) => t.tags));
  const allAudiences = uniqueSorted(["corporate", "family", "kids", "adults", ...real.flatMap((t) => t.audiences)]);
  const allCategories = uniqueSorted(["close-up", "parlor", "stage", "mentalism", "kids", ...real.map((t) => t.category)]);

  return html`
    <${BackBar} to="tricks" label="Tricks">
      <${ShareButton} kind="trick" item=${draft} isNew=${isNew} ctx=${ctx} />
    <//>
    <div class="scroll pad">
      <div class="editor">
        <${TitleInput} placeholder="Trick name" value=${draft.name} onInput=${(v) => set({ name: v })} autofocus=${isNew} />
        <div class="cols">
          <${Field} label="STATUS">
            <select class="select" value=${draft.status} onChange=${(e) => set({ status: e.target.value })}>
              ${STATUSES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
          <//>
          <${Field} label="CATEGORY"><${Text} value=${draft.category} placeholder="Close-up, stage, mentalism…" list="trick-categories" onInput=${(v) => set({ category: v })} /><//>
          <${Field} label="LENGTH (MIN)"><${Text} type="number" min="0" step="0.5" inputmode="decimal" value=${draft.duration_min ?? ""} onInput=${(v) => set({ duration_min: v === "" ? null : Number(v) })} /><//>
          <${Field} label="WHERE IT LIVES"><${Text} value=${draft.location} placeholder="Case, shelf, bag…" onInput=${(v) => set({ location: v })} /><//>
        </div>
        <datalist id="trick-categories">${allCategories.map((c) => html`<option value=${c} />`)}</datalist>
        <div class="etabs" role="tablist">
          ${TRICK_TABS.map(([k, label, filled]) => html`<button role="tab" aria-selected=${tab === k} class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>
            ${label}${tab !== k && filled(draft) ? html`<i class="dot" aria-label="has content"></i>` : null}
          </button>`)}
        </div>
        ${tab === "overview" && html`
          <div class="section">
            <${Gallery} ctx=${ctx} keys=${draft.images} onChange=${(images) => set({ images })} />
          </div>
          <${Field} label="EFFECT — WHAT THEY SEE"><${Area} value=${draft.effect} onInput=${(v) => set({ effect: v })} /><//>
          <${Field} label="NOTES"><${Area} value=${draft.notes} onInput=${(v) => set({ notes: v })} /><//>
          ${usedIn.length > 0 && html`<div class="section"><h3>In set lists</h3>
            <div class="chips">${usedIn.map((s) => html`<button class="chip" onClick=${() => go(`sets/${s.id}`)}>${s.name}</button>`)}</div>
          </div>`}`}
        ${tab === "perform" && html`
          <${Field} label="METHOD — PRIVATE"><${Area} rows="3" value=${draft.method} onInput=${(v) => set({ method: v })} /><//>
          <${Field} label="PROPS TO PACK"><${Area} value=${draft.props} onInput=${(v) => set({ props: v })} /><//>
          <${Field} label="PREP & RESET"><${Area} value=${draft.reset} onInput=${(v) => set({ reset: v })} /><//>`}
        ${tab === "tags" && html`
          <${Field} label="GOOD FOR"><${TagInput} value=${draft.audiences} suggestions=${allAudiences} placeholder="corporate, family, kids…" onChange=${(audiences) => set({ audiences })} /><//>
          <${Field} label="TAGS"><${TagInput} value=${draft.tags} suggestions=${allTags} placeholder="cards, needs batteries, opener…" onChange=${(tags) => set({ tags })} /><//>
          <div class="section"><h3>Links</h3><${Links} links=${draft.links} onChange=${(links) => set({ links })} /></div>`}
        ${tab === "buying" && html`
          <div class="cols">
            <${Field} label="PRICE ($)"><${Text} type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value=${draft.cost ?? ""} onInput=${(v) => set({ cost: v === "" ? null : Number(v) })} /><//>
            <${Field} label="SOURCE / MAKER"><${Text} value=${draft.source} placeholder="Dealer or creator" onInput=${(v) => set({ source: v })} /><//>
          </div>
          <${Field} label="PURCHASE LINK">
            <div class="with-btn">
              <input class="input" inputmode="url" placeholder="https://…" value=${draft.purchase_url || ""} onInput=${(e) => set({ purchase_url: e.target.value })} />
              ${draft.purchase_url && html`<a class="btn" href=${/^https?:/.test(draft.purchase_url) ? draft.purchase_url : `https://${draft.purchase_url}`} target="_blank" rel="noopener"><${Icon} name="external" />${draft.status === "wishlist" ? "Buy" : "Open"}</a>`}
            </div>
          <//>
          <p class="hint">Price and purchase link are private. They're never included in share links.</p>`}
      </div>
    </div>
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} sample=${!!draft.demo} onSave=${save} onDelete=${remove} what="trick" />`;
}

// ---------- set lists ----------

const itemMinutes = (item, byId) => item.duration_min ?? byId.get(item.trick_id)?.duration_min ?? 0;

function SetlistList({ ctx }) {
  const { setlists, tricks } = ctx;
  const byId = useMemo(() => new Map([...DEMO_TRICKS, ...(tricks || [])].map((t) => [t.id, t])), [tricks]);
  return html`
    <div class="bar">
      <h1>Set lists</h1>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => go("sets/new")}><${Icon} name="plus" />New set list</button>
    </div>
    <div class="scroll pad">
      <${SampleNote} list=${setlists} what="set lists" newPath="sets/new" />
      ${!setlists
        ? null
        : setlists.length === 0
          ? html`<div class="empty"><h2>No set lists yet</h2><p>Build a running order for your next show, or ask the chat to draft one.</p><button class="btn primary" onClick=${() => go("sets/new")}><${Icon} name="plus" />New set list</button></div>`
          : html`<div class="rows">${setlists.map((s) => {
              const total = s.items.reduce((n, i) => n + itemMinutes(i, byId), 0);
              return html`<button class="row" onClick=${() => go(`sets/${s.id}`)}>
                <div class="ico"><${Icon} name="list" /></div>
                <div class="txt"><div class="name">${s.name} <${SampleTag} item=${s} /></div>
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
      ${shown.length === 0 && html`<div class="none">${(tricks || []).length ? "No tricks match." : "Add tricks to your library first."}</div>`}
      ${shown.map((t) => html`<button class="opt" onClick=${() => { onPick(t); setOpen(false); setQ(""); }}>
        ${t.name}<span class="sub">${[statusLabel(t.status), t.duration_min ? `${t.duration_min} min` : ""].filter(Boolean).join(" · ")}</span>
      </button>`)}
    </div>`}
  </div>`;
}

/**
 * Reordering: press the handle and slide (finger or mouse). The list reshuffles live as you
 * pass each row, and scrolls when you reach the top or bottom edge. Up/down buttons still work.
 */
function useReorder(list, onChange) {
  const [dragging, setDragging] = useState(null);
  const latest = useRef();
  latest.current = { list, onChange };
  const move = (from, to) => {
    const { list: cur, onChange: change } = latest.current;
    if (to < 0 || to >= cur.length || from === to) return;
    const next = [...cur];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    change(next);
  };
  const startDrag = (i) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const row = e.currentTarget.closest(".item");
    const container = row?.parentElement;
    const scroller = row?.closest(".scroll");
    if (!row || !container) return;
    let index = i;
    let lastY = e.clientY;
    // Rows fold down to one line while dragging; keep the grabbed row under the finger.
    const before = row.getBoundingClientRect().top;
    setDragging(index);
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop += row.getBoundingClientRect().top - before;
    });
    const reorderAt = (y) => {
      const rows = [...container.children];
      let to = index;
      rows.forEach((node, j) => {
        const r = node.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (j < index && y < mid) to = Math.min(to, j);
        if (j > index && y > mid) to = Math.max(to, j);
      });
      if (to !== index) {
        move(index, to);
        index = to;
        setDragging(to);
      }
    };
    // Keep scrolling while the finger rests near the top or bottom edge.
    let frame = 0;
    const edgeScroll = () => {
      frame = 0;
      if (!scroller) return;
      const r = scroller.getBoundingClientRect();
      const edge = 70;
      const depth = lastY < r.top + edge ? lastY - (r.top + edge) : lastY > r.bottom - edge ? lastY - (r.bottom - edge) : 0;
      const speed = Math.max(-9, Math.min(9, depth / 8));
      if (speed) {
        scroller.scrollTop += speed;
        reorderAt(lastY);
        frame = requestAnimationFrame(edgeScroll);
      }
    };
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      lastY = ev.clientY;
      reorderAt(lastY);
      if (!frame) frame = requestAnimationFrame(edgeScroll);
    };
    const onEnd = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
      setDragging(null);
    };
    // Listen on the page: the row moves in the list while it's being dragged.
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  };
  const props = (i) => ({ class: `item ${dragging === i ? "dragging" : ""}` });
  const grip = (i) => html`<div class="grip" title="Drag to reorder" aria-hidden="true" onPointerDown=${startDrag(i)}><${Icon} name="grip" /></div>`;
  return { move, props, grip, dragging: dragging !== null };
}

const BLANK_SET = { name: "", event: "", venue: "", date: "", notes: "", items: [], equipment: [] };

function SetlistEditor({ id, ctx }) {
  const { draft, set, dirty, setDirty, isNew, missing } = useDraft(id, ctx.setlists, BLANK_SET);
  const { busy, err, save, remove } = useSaver({ path: "setlists", id, draft, isNew, setDirty, ctx, which: "setlists", back: "sets", what: "set list" });
  useLeaveGuard(dirty);
  const byId = useMemo(() => new Map([...DEMO_TRICKS, ...(ctx.tricks || [])].map((t) => [t.id, t])), [ctx.tricks]);
  const items = draft?.items || [];
  const setItems = (next) => set({ items: next });
  const { move, props, grip, dragging: reordering } = useReorder(items, setItems);
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
      <${ShareButton} kind="setlist" item=${draft} isNew=${isNew} ctx=${ctx} />
      <button class="btn" disabled=${!items.length} onClick=${openShow}><${Icon} name="play" />Show<span class="hide-sm"> mode</span></button>
    <//>
    <div class="scroll pad">
      <div class="editor">
        <${TitleInput} placeholder="Set list name" value=${draft.name} onInput=${(v) => set({ name: v })} autofocus=${isNew} />
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
          <div class=${`order ${reordering ? "reordering" : ""}`}>
            ${items.map((item, i) => {
              const t = item.trick_id ? byId.get(item.trick_id) : null;
              return html`<div key=${item.id} ...${props(i)}>
                ${grip(i)}
                <div class="num">${i + 1}</div>
                <div class="body">
                  <div class="line">
                    ${item.trick_id
                      ? html`<span class="tname" onClick=${() => go(`tricks/${item.trick_id}`)}>${t ? t.name : "(deleted trick)"}</span>`
                      : html`<input class="input s-title" style="flex:1;min-width:140px" placeholder="Bit, intro, Q&A…" value=${item.title || ""} onInput=${(e) => upd(i, { title: e.target.value })} />`}
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
            <${TrickPicker} tricks=${ctx.real.tricks} onPick=${(t) => setItems([...items, { id: uid(), trick_id: t.id }])} />
            <button class="btn" onClick=${() => setItems([...items, { id: uid(), title: "" }])}><${Icon} name="plus" />Add a bit</button>
          </div>
        </div>
        <div class="section">
          <h3>Equipment to bring</h3>
          <${GearPicker} ctx=${ctx} value=${draft.equipment || []} onChange=${(equipment) => set({ equipment })} />
        </div>
        ${!isNew && html`<div class="section">
          <h3>To do for this show</h3>
          ${(ctx.tasks || []).filter((t) => t.setlist_id === id).map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${ctx} showSet=${false} />`)}
          ${!draft.demo && html`<${TaskAdd} ctx=${ctx} setlistId=${id} placeholder="Add a task for this show…" />`}
        </div>`}
        ${!isNew && html`<div class="section">
          <h3>Files for this show</h3>
          <div class="flist">${(ctx.files || []).filter((f) => f.setlist_id === id).map((f) => html`<${FileRow} key=${f.id} file=${f} ctx=${ctx} showSet=${false} />`)}</div>
          ${!draft.demo && html`<div><${FileUploadButton} ctx=${ctx} extra=${{ setlist_id: id }} label="Upload insurance, contract…" primary=${false} /></div>`}
        </div>`}
        <${Field} label="NOTES"><${Area} rows="3" value=${draft.notes} placeholder="Stage size, tech, contact on site…" onInput=${(v) => set({ notes: v })} /><//>
      </div>
    </div>
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} sample=${!!draft.demo} onSave=${save} onDelete=${remove} what="set list" />`;
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
      <${SampleNote} list=${playlists} what="playlists" newPath="playlists/new" />
      ${!playlists
        ? null
        : playlists.length === 0
          ? html`<div class="empty"><h2>No playlists yet</h2><p>Keep your walk-on music and sound cues together, with links or uploaded audio.</p><button class="btn primary" onClick=${() => go("playlists/new")}><${Icon} name="plus" />New playlist</button></div>`
          : html`<div class="rows">${playlists.map((p) => {
              const secs = p.tracks.reduce((n, t) => n + (t.duration_sec || 0), 0);
              const linked = (ctx.setlists || []).find((s) => s.id === p.setlist_id);
              return html`<button class="row" onClick=${() => go(`playlists/${p.id}`)}>
                <div class="ico"><${Icon} name="music" /></div>
                <div class="txt"><div class="name">${p.name} <${SampleTag} item=${p} /></div><div class="sub">${linked ? `For ${linked.name}` : p.description || " "}</div></div>
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
  const { move, props, grip, dragging: reordering } = useReorder(tracks, setTracks);
  if (missing) return html`<${BackBar} to="playlists" label="Playlists" /><div class="empty"><h2>Playlist not found</h2></div>`;
  if (!draft) return html`<${BackBar} to="playlists" label="Playlists" />`;
  const upd = (i, patch) => setTracks(tracks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const secs = tracks.reduce((n, t) => n + (t.duration_sec || 0), 0);

  return html`
    <${BackBar} to="playlists" label="Playlists">
      <${ShareButton} kind="playlist" item=${draft} isNew=${isNew} ctx=${ctx} />
    <//>
    <div class="scroll pad">
      <div class="editor">
        <${TitleInput} placeholder="Playlist name" value=${draft.name} onInput=${(v) => set({ name: v })} autofocus=${isNew} />
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
          <div class=${`order ${reordering ? "reordering" : ""}`}>
            ${tracks.map((t, i) => html`<div key=${t.id} ...${props(i)}>
              ${grip(i)}
              <div class="num">${i + 1}</div>
              <div class="body">
                <div class="line">
                  <input class="input t-title" style="flex:2;min-width:140px" placeholder="Title" value=${t.title} onInput=${(e) => upd(i, { title: e.target.value })} />
                  <input class="input t-artist" style="flex:1;min-width:110px" placeholder="Artist" value=${t.artist || ""} onInput=${(e) => upd(i, { artist: e.target.value })} />
                  <input class="input mins" placeholder="3:20" aria-label="Length" value=${fmtSec(t.duration_sec)} onChange=${(e) => upd(i, { duration_sec: parseSec(e.target.value) })} />
                </div>
                <div class="line">
                  <input class="input" style="flex:2;min-width:160px" placeholder="Cue — when to play it" value=${t.cue || ""} onInput=${(e) => upd(i, { cue: e.target.value })} />
                  <select class="select" style="flex:1;min-width:140px" value=${t.trick_id || ""} onChange=${(e) => upd(i, { trick_id: e.target.value || undefined })}>
                    <option value="">No trick</option>
                    ${(ctx.real.tricks || []).map((x) => html`<option value=${x.id}>${x.name}</option>`)}
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
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} sample=${!!draft.demo} onSave=${save} onDelete=${remove} what="playlist" />`;
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

// ---------- equipment ----------

const GEAR_STATUSES = [
  ["working", "Working"],
  ["repair", "Needs repair"],
  ["wishlist", "Wishlist"],
  ["retired", "Retired"],
];
const gearStatusLabel = (s) => (GEAR_STATUSES.find(([k]) => k === s) || [s, s])[1];

function GearList({ ctx }) {
  const [q, setQ] = useState(() => store.get("gear-q") || "");
  const [status, setStatus] = useState(() => store.get("gear-status") || "");
  const [category, setCategory] = useState(() => store.get("gear-category") || "");
  useEffect(() => {
    store.set("gear-q", q || null);
    store.set("gear-status", status || null);
    store.set("gear-category", category || null);
  }, [q, status, category]);
  const { equipment } = ctx;
  const categories = useMemo(() => uniqueSorted((equipment || []).map((g) => g.category)), [equipment]);
  const shown = useMemo(() => {
    if (!equipment) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return equipment.filter((g) => {
      if (status && g.status !== status) return false;
      if (category && g.category.toLowerCase() !== category.toLowerCase()) return false;
      const hay = [g.name, g.category, g.location, g.make_model, g.serial, g.notes, ...g.tags].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [equipment, q, status, category]);
  const repairs = (ctx.real.equipment || []).filter((g) => g.status === "repair").length;

  return html`
    <div class="bar">
      <h1>Equipment</h1>
      <label class="search"><${Icon} name="search" /><span class="sr">Search equipment</span>
        <input placeholder="Search gear, models, places…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </label>
      <div class="chips">
        <button class=${`chip ${!status ? "on" : ""}`} onClick=${() => setStatus("")}>All</button>
        ${GEAR_STATUSES.map(([k, label]) => html`<button class=${`chip ${status === k ? "on" : ""}`} onClick=${() => setStatus(status === k ? "" : k)}>
          ${label}${k === "repair" && repairs ? ` · ${repairs}` : ""}</button>`)}
      </div>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => go("gear/new")}><${Icon} name="plus" />New item</button>
    </div>
    <div class="filters">
      <select class=${`select mini ${category ? "set" : ""}`} value=${category} onChange=${(e) => setCategory(e.target.value)} aria-label="Category">
        <option value="">All categories</option>
        ${categories.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
      <span class="count">${equipment ? `${shown.length} ${shown.length === 1 ? "item" : "items"}` : ""}</span>
    </div>
    <div class="scroll pad">
      <${SampleNote} list=${equipment} what="equipment" newPath="gear/new" />
      ${!equipment
        ? null
        : shown.length === 0
          ? html`<div class="empty"><h2>No matches</h2><p>Nothing fits those filters.</p></div>`
          : html`<div class="tlist">
              ${shown.map((g) => html`<button class="trow" onClick=${() => go(`gear/${g.id}`)}>
                <div class="tthumb"><${Cover} trick=${g} /></div>
                <div class="tmain">
                  <div class="name">${g.name}${g.quantity > 1 ? html` <span class="qty">×${g.quantity}</span>` : null} <${SampleTag} item=${g} /></div>
                  <div class="sub">${[g.category, g.make_model, g.location].filter(Boolean).join(" · ") || " "}</div>
                </div>
                <div class="tside">
                  <span class=${`pill g-${g.status}`}>${gearStatusLabel(g.status)}</span>
                  ${money(g.cost) && html`<span class="price">${money(g.cost)}</span>`}
                </div>
              </button>`)}
            </div>`}
    </div>`;
}

const BLANK_GEAR = {
  name: "", category: "", status: "working", quantity: 1, location: "", make_model: "", serial: "", cost: null,
  purchase_url: "", purchased_on: "", tags: [], links: [], images: [], notes: "",
};

function GearEditor({ id, ctx }) {
  const { draft, set, dirty, setDirty, isNew, missing } = useDraft(id, ctx.equipment, BLANK_GEAR);
  const { busy, err, save, remove } = useSaver({ path: "equipment", id, draft, isNew, setDirty, ctx, which: "equipment", back: "gear", what: "item" });
  useLeaveGuard(dirty);
  if (missing) return html`<${BackBar} to="gear" label="Equipment" /><div class="empty"><h2>Item not found</h2><p>It may have been deleted.</p></div>`;
  if (!draft) return html`<${BackBar} to="gear" label="Equipment" />`;
  const real = ctx.real.equipment || [];
  const allCategories = uniqueSorted(["audio", "lighting", "staging", "cases", "tech", ...real.map((g) => g.category)]);
  const allTags = uniqueSorted(real.flatMap((g) => g.tags));
  const usedIn = (ctx.setlists || []).filter((s) => (s.equipment || []).includes(id));
  return html`
    <${BackBar} to="gear" label="Equipment" />
    <div class="scroll pad">
      <div class="editor">
        <${TitleInput} placeholder="Item name" value=${draft.name} onInput=${(v) => set({ name: v })} autofocus=${isNew} />
        <div class="cols">
          <${Field} label="CONDITION">
            <select class="select" value=${draft.status} onChange=${(e) => set({ status: e.target.value })}>
              ${GEAR_STATUSES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
          <//>
          <${Field} label="CATEGORY"><${Text} value=${draft.category} placeholder="Audio, lighting, staging…" list="gear-categories" onInput=${(v) => set({ category: v })} /><//>
          <${Field} label="HOW MANY"><${Text} type="number" min="0" step="1" inputmode="numeric" value=${draft.quantity ?? 1} onInput=${(v) => set({ quantity: v === "" ? 1 : Number(v) })} /><//>
          <${Field} label="WHERE IT LIVES"><${Text} value=${draft.location} placeholder="Case, shelf, car…" onInput=${(v) => set({ location: v })} /><//>
        </div>
        <datalist id="gear-categories">${allCategories.map((c) => html`<option value=${c} />`)}</datalist>
        <${Gallery} ctx=${ctx} keys=${draft.images} onChange=${(images) => set({ images })} />
        <div class="cols">
          <${Field} label="MAKE / MODEL"><${Text} value=${draft.make_model} onInput=${(v) => set({ make_model: v })} /><//>
          <${Field} label="SERIAL NUMBER"><${Text} value=${draft.serial} onInput=${(v) => set({ serial: v })} /><//>
        </div>
        <${Field} label="TAGS"><${TagInput} value=${draft.tags} suggestions=${allTags} placeholder="charge before show, fragile…" onChange=${(tags) => set({ tags })} /><//>
        <${Field} label="NOTES"><${Area} value=${draft.notes} onInput=${(v) => set({ notes: v })} /><//>
        <div class="section">
          <h3>Buying</h3>
          <div class="cols">
            <${Field} label="PRICE ($)"><${Text} type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value=${draft.cost ?? ""} onInput=${(v) => set({ cost: v === "" ? null : Number(v) })} /><//>
            <${Field} label="BOUGHT ON"><input class="input" type="date" value=${draft.purchased_on} onInput=${(e) => set({ purchased_on: e.target.value })} /><//>
          </div>
          <${Field} label="PURCHASE LINK">
            <div class="with-btn">
              <input class="input" inputmode="url" placeholder="https://…" value=${draft.purchase_url || ""} onInput=${(e) => set({ purchase_url: e.target.value })} />
              ${draft.purchase_url && html`<a class="btn" href=${/^https?:/.test(draft.purchase_url) ? draft.purchase_url : `https://${draft.purchase_url}`} target="_blank" rel="noopener"><${Icon} name="external" />${draft.status === "wishlist" ? "Buy" : "Open"}</a>`}
            </div>
          <//>
        </div>
        ${usedIn.length > 0 && html`<div class="section"><h3>Packed for</h3>
          <div class="chips">${usedIn.map((s) => html`<button class="chip" onClick=${() => go(`sets/${s.id}`)}>${s.name}</button>`)}</div>
        </div>`}
      </div>
    </div>
    <${SaveBar} dirty=${dirty} busy=${busy} err=${err} isNew=${isNew} sample=${!!draft.demo} onSave=${save} onDelete=${remove} what="item" />`;
}

/** Equipment chips for a set list, with a picker to add more. */
function GearPicker({ ctx, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const byId = new Map([...DEMO_EQUIPMENT, ...(ctx.real.equipment || [])].map((g) => [g.id, g]));
  const options = (ctx.real.equipment || []).filter((g) => !value.includes(g.id) && g.status !== "retired" && g.name.toLowerCase().includes(q.toLowerCase()));
  return html`<div class="gear-pick">
    ${value.map((gid) => {
      const g = byId.get(gid);
      return html`<span class="tag">${g ? g.name : "(removed)"}${g?.quantity > 1 ? ` ×${g.quantity}` : ""}
        <button type="button" aria-label="Remove" onClick=${() => onChange(value.filter((x) => x !== gid))}><${Icon} name="x" /></button></span>`;
    })}
    <div class="picker" ref=${ref}>
      <button class="btn" onClick=${() => setOpen(!open)}><${Icon} name="plus" />Add equipment</button>
      ${open && html`<div class="menu">
        <input class="input" placeholder="Search equipment…" value=${q} autofocus onInput=${(e) => setQ(e.target.value)} />
        ${options.length === 0 && html`<div class="none">${(ctx.real.equipment || []).length ? "Nothing else matches." : "Add equipment to your inventory first."}</div>`}
        ${options.map((g) => html`<button class="opt" onClick=${() => { onChange([...value, g.id]); setQ(""); }}>
          ${g.name}<span class="sub">${[g.category, g.location].filter(Boolean).join(" · ")}</span>
        </button>`)}
      </div>`}
    </div>
  </div>`;
}

// ---------- tasks ----------

const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
function dueLabel(due) {
  if (!due) return "";
  const t = today();
  if (due === t) return "Today";
  if (due === addDays(t, 1)) return "Tomorrow";
  const [y, m, d] = due.split("-").map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return due < t ? `Overdue · ${nice}` : nice;
}

/** Saves a change to a task straight away (shown instantly, then confirmed by the server). */
async function patchTask(ctx, task, patch) {
  if (task.demo) {
    ctx.setToast("That's a sample task. Add your own and the samples go away.");
    return;
  }
  ctx.setTasks((list) => (list || []).map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
  try {
    await api(`tasks/${task.id}`, { method: "PUT", body: patch });
  } catch (e) {
    ctx.setToast(e.message);
  }
  ctx.load(["tasks"]);
}

function TaskRow({ task, ctx, showSet = true }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  useEffect(() => { setTitle(task.title); setNotes(task.notes); }, [task.title, task.notes]);
  const set = (ctx.setlists || []).find((s) => s.id === task.setlist_id);
  const overdue = !task.done && task.due && task.due < today();
  const remove = async () => {
    if (!confirm("Delete this task?")) return;
    ctx.setTasks((list) => list.filter((t) => t.id !== task.id));
    await api(`tasks/${task.id}`, { method: "DELETE" }).catch((e) => ctx.setToast(e.message));
    ctx.load(["tasks"]);
  };
  return html`<div class=${`task ${task.done ? "done" : ""} ${open ? "open" : ""}`}>
    <div class="task-line">
      <button class="tick" role="checkbox" aria-checked=${task.done} aria-label=${task.done ? "Mark not done" : "Mark done"}
        onClick=${() => patchTask(ctx, task, { done: !task.done })}>${task.done ? html`<${Icon} name="check" />` : null}</button>
      <button class="task-main" onClick=${() => (task.demo ? patchTask(ctx, task, {}) : setOpen(!open))}>
        <span class="task-title">${task.title}</span>
        ${(task.due || (showSet && set) || task.notes) && html`<span class="task-meta">
          ${task.due && html`<span class=${overdue ? "late" : ""}>${dueLabel(task.due)}</span>`}
          ${showSet && set && html`<span>${set.name}</span>`}
          ${task.notes && !open && html`<span>Has notes</span>`}
          <${SampleTag} item=${task} />
        </span>`}
      </button>
    </div>
    ${open && html`<div class="task-edit">
      <input class="input" value=${title} aria-label="Task" onInput=${(e) => setTitle(e.target.value)}
        onBlur=${() => title.trim() && title !== task.title && patchTask(ctx, task, { title })} />
      <div class="cols">
        <${Field} label="DUE"><input class="input" type="date" value=${task.due} onChange=${(e) => patchTask(ctx, task, { due: e.target.value })} /><//>
        <${Field} label="FOR SHOW">
          <select class="select" value=${task.setlist_id || ""} onChange=${(e) => patchTask(ctx, task, { setlist_id: e.target.value || null })}>
            <option value="">None</option>
            ${(ctx.real.setlists || []).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select>
        <//>
      </div>
      <${Area} value=${notes} placeholder="Notes" onInput=${setNotes} onBlur=${() => notes !== task.notes && patchTask(ctx, task, { notes })} />
      <div class="task-acts">
        <button class="btn danger" onClick=${remove}><${Icon} name="trash" />Delete</button>
        <div style="flex:1"></div>
        <button class="btn" onClick=${() => setOpen(false)}>Done editing</button>
      </div>
    </div>`}
  </div>`;
}

function TaskAdd({ ctx, setlistId, placeholder = "Add a task…" }) {
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await api("tasks", { method: "POST", body: { title, due, setlist_id: setlistId || null } });
      setText("");
      setDue("");
      setPicking(false);
      await ctx.load(["tasks"]);
    } catch (e2) {
      ctx.setToast(e2.message);
    }
    setBusy(false);
  };
  return html`<form class="task-add" onSubmit=${add}>
    <${Icon} name="plus" />
    <input class="ta-text" placeholder=${placeholder} value=${text} onInput=${(e) => setText(e.target.value)} aria-label="New task" />
    ${picking || due
      ? html`<input class="ta-date" type="date" value=${due} autofocus aria-label="Due date"
          ref=${(el) => { if (el && picking && !due) { try { el.showPicker(); } catch {} } }}
          onInput=${(e) => setDue(e.target.value)} onBlur=${() => !due && setPicking(false)} />`
      : html`<button type="button" class="ta-when" onClick=${() => setPicking(true)}>+ Date</button>`}
    <button class="btn primary" disabled=${!text.trim() || busy}>Add</button>
  </form>`;
}

function TaskPage({ ctx }) {
  const [showDone, setShowDone] = useState(false);
  const list = ctx.tasks;
  const t = today();
  const open = (list || []).filter((x) => !x.done);
  const done = (list || []).filter((x) => x.done);
  const groups = [
    ["Overdue", open.filter((x) => x.due && x.due < t)],
    ["Today", open.filter((x) => x.due === t)],
    ["Coming up", open.filter((x) => x.due && x.due > t)],
    ["Anytime", open.filter((x) => !x.due)],
  ].filter(([, items]) => items.length);
  return html`
    <div class="bar"><h1>Tasks</h1><div class="grow"></div>
      ${list && html`<span class="muted-sm">${open.length} to do</span>`}
    </div>
    <div class="scroll pad">
      <div class="tasks-wrap">
        <${TaskAdd} ctx=${ctx} />
        <${SampleNote} list=${list} what="tasks" newPath="tasks" />
        ${list && open.length === 0 && html`<div class="empty small"><h2>All done</h2><p>Nothing left to do. Add a task above, or ask the chat to remind you of something.</p></div>`}
        ${groups.map(([label, items]) => html`<div class="task-group"><h3 class=${label === "Overdue" ? "late" : ""}>${label}</h3>
          ${items.map((x) => html`<${TaskRow} key=${x.id} task=${x} ctx=${ctx} />`)}
        </div>`)}
        ${done.length > 0 && html`<div class="task-group">
          <button class="done-toggle" onClick=${() => setShowDone(!showDone)}>${showDone ? "Hide" : "Show"} done (${done.length})</button>
          ${showDone && done.map((x) => html`<${TaskRow} key=${x.id} task=${x} ctx=${ctx} />`)}
        </div>`}
      </div>
    </div>`;
}

// ---------- notes ----------

const noteTitle = (n) => n.title || (n.body || "").split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "New note";

function NoteList({ ctx }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const { notes } = ctx;
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (notes || []).filter((n) => words.every((w) => `${n.title} ${n.body}`.toLowerCase().includes(w)));
  }, [notes, q]);
  const create = async () => {
    setBusy(true);
    try {
      const n = await api("notes", { method: "POST", body: { title: "", body: "" } });
      await ctx.load(["notes"]);
      go(`notes/${n.id}`);
    } catch (e) {
      ctx.setToast(e.message);
    }
    setBusy(false);
  };
  return html`
    <div class="bar">
      <h1>Notes</h1>
      <label class="search"><${Icon} name="search" /><span class="sr">Search notes</span>
        <input placeholder="Search notes…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </label>
      <div class="grow"></div>
      <button class="btn primary" disabled=${busy} onClick=${create}><${Icon} name="plus" />New note</button>
    </div>
    <div class="scroll pad">
      <${SampleNote} list=${notes} what="notes" newPath="notes" />
      ${notes && shown.length === 0 && html`<div class="empty"><h2>No matches</h2><p>No note has those words.</p></div>`}
      <div class="rows">
        ${shown.map((n) => html`<button class="row note-row" onClick=${() => go(`notes/${n.id}`)}>
          <div class="txt">
            <div class="name">${n.pinned ? html`<span class="pin-mark"><${Icon} name="pin" /></span>` : null}${noteTitle(n)} <${SampleTag} item=${n} /></div>
            <div class="sub">${(n.title ? n.body : n.body.split("\n").slice(1).join(" ")).replace(/\s+/g, " ").trim().slice(0, 140) || "No more text"}</div>
          </div>
          <div class="right">${ago(n.updated_at)}</div>
        </button>`)}
      </div>
    </div>`;
}

/** Notes save themselves a moment after you stop typing. */
function NoteEditor({ id, ctx }) {
  const fromList = (ctx.notes || []).find((n) => n.id === id);
  const [draft, setDraft] = useState(() => (fromList ? { ...fromList } : null));
  const [state, setState] = useState("saved"); // saved | pending | saving | error
  const timer = useRef(0);
  const gone = useRef(false); // deleted: nothing to save on the way out
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => { if (!draft && fromList) setDraft({ ...fromList }); }, [fromList]);
  const flush = async () => {
    clearTimeout(timer.current);
    const d = latest.current;
    if (!d || d.demo) return;
    setState("saving");
    try {
      await api(`notes/${id}`, { method: "PUT", body: { title: d.title, body: d.body, pinned: d.pinned } });
      setState((s) => (s === "saving" ? "saved" : s));
      ctx.load(["notes"]);
    } catch (e) {
      setState("error");
      ctx.setToast(e.message);
    }
  };
  const change = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (latest.current?.demo) return; // samples are only saved with "Add to my notes"
    setState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };
  // Moving around the app saves on the way out; only closing the tab needs a warning.
  useLeaveGuard(state === "pending" || state === "saving", false);
  // Leaving the page: save what's pending, and drop a note that was never written in.
  useEffect(() => () => {
    const d = latest.current;
    if (!d || d.demo || gone.current) return;
    if (!d.title.trim() && !d.body.trim()) {
      api(`notes/${id}`, { method: "DELETE" }).then(() => ctx.load(["notes"])).catch(() => {});
    } else if (timer.current) {
      clearTimeout(timer.current);
      api(`notes/${id}`, { method: "PUT", body: { title: d.title, body: d.body, pinned: d.pinned } }).then(() => ctx.load(["notes"])).catch(() => {});
    }
  }, []);
  if (!draft) {
    return html`<${BackBar} to="notes" label="Notes" />${ctx.notes && html`<div class="empty"><h2>Note not found</h2><p>It may have been deleted.</p></div>`}`;
  }
  const keep = async () => {
    try {
      const n = await api("notes", { method: "POST", body: adopt("notes", draft) });
      await ctx.load(["notes"]);
      location.replace(`#/notes/${n.id}`);
    } catch (e) {
      ctx.setToast(e.message);
    }
  };
  const remove = async () => {
    if (!confirm("Delete this note? This can't be undone.")) return;
    gone.current = true;
    clearTimeout(timer.current);
    await api(`notes/${id}`, { method: "DELETE" }).catch((e) => ctx.setToast(e.message));
    await ctx.load(["notes"]);
    unsaved = false;
    go("notes");
  };
  const label = { saved: "Saved", pending: "Editing…", saving: "Saving…", error: "Couldn't save" }[state];
  return html`
    <${BackBar} to="notes" label="Notes">
      ${!draft.demo && html`<span class=${`save-state ${state}`}>${label}</span>`}
      ${!draft.demo && html`<button class=${`icon-btn ${draft.pinned ? "pinned" : ""}`} aria-label=${draft.pinned ? "Unpin" : "Pin to top"} aria-pressed=${draft.pinned} onClick=${() => change({ pinned: !draft.pinned })}><${Icon} name="pin" /></button>`}
      ${!draft.demo && html`<button class="icon-btn" aria-label="Delete note" onClick=${remove}><${Icon} name="trash" /></button>`}
      ${draft.demo && html`<button class="btn primary" onClick=${keep}>Add to my notes</button>`}
    <//>
    <div class="scroll pad">
      <div class="editor note-editor">
        <${TitleInput} placeholder="Title" value=${draft.title} onInput=${(v) => change({ title: v })} autofocus=${!draft.title && !draft.body} />
        <${Area} class="textarea note-body" rows="10" max=${100000} value=${draft.body} placeholder="Start writing…" onInput=${(v) => change({ body: v })} />
      </div>
    </div>`;
}

// ---------- files ----------

const FILE_FOLDERS = ["Insurance", "Logos & branding", "Contracts", "Promo", "Invoices"];
const fmtSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n || 0} B`);
const fileExt = (f) => (f.name.includes(".") ? f.name.split(".").pop() : f.key.split(".").pop() || "file").slice(0, 5).toUpperCase();
const isPreviewable = (f) => /^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(f.type);

function expiryInfo(expires) {
  if (!expires) return null;
  const t = today();
  const [y, m, d] = expires.split("-").map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (expires < t) return { cls: "expired", text: `Expired ${nice}` };
  const days = Math.round((new Date(y, m - 1, d) - new Date(...t.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))))) / 86400000);
  if (days <= 30) return { cls: "soon", text: days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}` };
  return { cls: "", text: `Expires ${nice}` };
}

/** Uploads files into the Files area (optionally into a folder or for a show). */
async function uploadFiles(ctx, list, extra = {}) {
  let ok = 0;
  for (const file of list) {
    try {
      const up = await upload(file);
      await api("files", { method: "POST", body: { key: up.key, name: file.name, ...extra } });
      ok++;
    } catch (e) {
      ctx.setToast(`${file.name}: ${e.message}`);
    }
  }
  if (ok) {
    await ctx.load(["files"]);
    ctx.setToast(ok === 1 ? "File added" : `${ok} files added`);
  }
}

function FileUploadButton({ ctx, extra, label = "Upload", primary = true }) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  return html`<button class=${`btn ${primary ? "primary" : ""}`} disabled=${busy} onClick=${() => input.current.click()}>
    <${Icon} name="upload" />${busy ? "Uploading…" : label}
    <input ref=${input} type="file" hidden multiple onChange=${async (e) => {
      const list = [...e.target.files];
      e.target.value = "";
      if (!list.length) return;
      setBusy(true);
      await uploadFiles(ctx, list, extra);
      setBusy(false);
    }} />
  </button>`;
}

function FileRow({ file, ctx, showSet = true, startOpen = false, onClose }) {
  const [open, setOpenState] = useState(startOpen);
  const setOpen = (v) => { setOpenState(v); if (!v && onClose) onClose(); };
  const [name, setName] = useState(file.name);
  const [notes, setNotes] = useState(file.notes);
  useEffect(() => { setName(file.name); setNotes(file.notes); }, [file.name, file.notes]);
  const set = (ctx.setlists || []).find((s) => s.id === file.setlist_id);
  const exp = expiryInfo(file.expires);
  const folders = uniqueSorted([...FILE_FOLDERS, ...(ctx.real.files || []).map((f) => f.folder)]);
  const patch = async (p) => {
    if (file.demo) return ctx.setToast("That's a sample. Upload your own files and the samples go away.");
    try {
      await api(`files/${file.id}`, { method: "PUT", body: p });
      await ctx.load(["files"]);
    } catch (e) {
      ctx.setToast(e.message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete “${file.name}”? The file itself is deleted too.`)) return;
    await api(`files/${file.id}`, { method: "DELETE" }).catch((e) => ctx.setToast(e.message));
    await ctx.load(["files"]);
    if (onClose) onClose();
  };
  const url = file.key ? mediaUrl(file.key) : null;
  return html`<div class=${`frow ${open ? "open" : ""}`}>
    <div class="frow-line">
      <button class="frow-main" onClick=${() => (file.demo ? patch({}) : setOpen(!open))}>
        <span class="fthumb">${url && isPreviewable(file) ? html`<img src=${url} alt="" loading="lazy" />` : html`<span class="fext">${fileExt(file)}</span>`}</span>
        <span class="fmain">
          <span class="name">${file.name} <${SampleTag} item=${file} /></span>
          <span class="sub">${[file.folder, fmtSize(file.size), showSet && set ? set.name : "", ago(file.updated_at)].filter(Boolean).join(" · ")}</span>
          ${exp && html`<span class=${`exp ${exp.cls}`}>${exp.text}</span>`}
        </span>
      </button>
      ${url && html`<a class="icon-btn" href=${url} target="_blank" rel="noopener" aria-label=${`Open ${file.name}`}><${Icon} name="external" /></a>`}
      ${url && html`<a class="icon-btn" href=${url} download=${file.name} aria-label=${`Download ${file.name}`}><${Icon} name="download" /></a>`}
    </div>
    ${open && html`<div class="frow-edit">
      <${Field} label="NAME"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} onBlur=${() => name.trim() && name !== file.name && patch({ name })} /><//>
      <div class="cols">
        <${Field} label="FOLDER"><input class="input" list="file-folders" value=${file.folder} placeholder="Insurance, Contracts…" onChange=${(e) => patch({ folder: e.target.value })} /><//>
        <${Field} label="EXPIRES"><input class="input" type="date" value=${file.expires} onChange=${(e) => patch({ expires: e.target.value })} /><//>
      </div>
      <${Field} label="FOR SHOW">
        <select class="select" value=${file.setlist_id || ""} onChange=${(e) => patch({ setlist_id: e.target.value || null })}>
          <option value="">None</option>
          ${(ctx.real.setlists || []).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
        </select>
      <//>
      <${Field} label="NOTES"><${Area} value=${notes} onInput=${setNotes} onBlur=${() => notes !== file.notes && patch({ notes })} /><//>
      <datalist id="file-folders">${folders.map((f) => html`<option value=${f} />`)}</datalist>
      <div class="task-acts">
        <button class="btn danger" onClick=${remove}><${Icon} name="trash" />Delete</button>
        <div style="flex:1"></div>
        <button class="btn" onClick=${() => setOpen(false)}>Done</button>
      </div>
    </div>`}
  </div>`;
}

/** Grid view: a big preview per file; tapping opens its details. */
function FileCard({ file, onOpen, ctx }) {
  const url = file.key ? mediaUrl(file.key) : null;
  const exp = expiryInfo(file.expires);
  return html`<button class="card fcard" onClick=${() => (file.demo ? ctx.setToast("That's a sample. Upload your own files and the samples go away.") : onOpen(file))}>
    <div class="cover">
      ${url && isPreviewable(file) ? html`<img src=${url} alt="" loading="lazy" class="contain" />` : html`<span class="fext big">${fileExt(file)}</span>`}
    </div>
    <div class="meta">
      <div class="name">${file.name}</div>
      <div class="sub">${[file.folder, fmtSize(file.size)].filter(Boolean).join(" · ")}</div>
      <div class="pills">${exp ? html`<span class=${`exp ${exp.cls}`}>${exp.text}</span>` : null}<${SampleTag} item=${file} /></div>
    </div>
  </button>`;
}

function FilesPage({ ctx }) {
  const [view, setView] = useState(() => store.get("file-view") || "list");
  const [opened, setOpened] = useState(null);
  useEffect(() => { store.set("file-view", view); }, [view]);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState(() => store.get("file-folder") || "");
  const [over, setOver] = useState(false);
  useEffect(() => { store.set("file-folder", folder || null); }, [folder]);
  const { files } = ctx;
  const folders = uniqueSorted((files || []).map((f) => f.folder));
  const expiring = (files || []).filter((f) => f.expires && (expiryInfo(f.expires)?.cls || "") !== "").length;
  const shown = (files || []).filter((f) => {
    if (folder === "__expiring") { if (!f.expires || !expiryInfo(f.expires).cls) return false; }
    else if (folder && f.folder !== folder) return false;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every((w) => `${f.name} ${f.folder} ${f.notes}`.toLowerCase().includes(w));
  });
  const extra = folder && folder !== "__expiring" ? { folder } : {};
  return html`
    <div class="bar">
      <h1>Files</h1>
      <label class="search"><${Icon} name="search" /><span class="sr">Search files</span>
        <input placeholder="Search files…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </label>
      <div class="grow"></div>
      <${FileUploadButton} ctx=${ctx} extra=${extra} />
    </div>
    <div class="filters">
      <div class="chips">
        <button class=${`chip ${!folder ? "on" : ""}`} onClick=${() => setFolder("")}>All</button>
        ${expiring > 0 && html`<button class=${`chip warn ${folder === "__expiring" ? "on" : ""}`} onClick=${() => setFolder(folder === "__expiring" ? "" : "__expiring")}>Expiring · ${expiring}</button>`}
        ${folders.map((f) => html`<button class=${`chip ${folder === f ? "on" : ""}`} onClick=${() => setFolder(folder === f ? "" : f)}>${f}</button>`)}
      </div>
      <div class="grow"></div>
      <div class="seg" role="group" aria-label="View">
        <button class=${view === "grid" ? "on" : ""} aria-label="Grid view" aria-pressed=${view === "grid"} onClick=${() => setView("grid")}><${Icon} name="grid" /></button>
        <button class=${view === "list" ? "on" : ""} aria-label="List view" aria-pressed=${view === "list"} onClick=${() => setView("list")}><${Icon} name="rows" /></button>
      </div>
    </div>
    <div class=${`scroll pad ${over ? "drop-over" : ""}`}
      onDragOver=${(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${(e) => { e.preventDefault(); setOver(false); uploadFiles(ctx, [...e.dataTransfer.files], extra); }}>
      <${SampleNote} list=${files} what="files" newPath="files" />
      ${files && shown.length === 0 && html`<div class="empty"><h2>${q || folder ? "No matches" : "No files yet"}</h2><p>${q || folder ? "Nothing fits that search." : "Upload your logo, insurance policies, contracts or anything else, or drag files here."}</p></div>`}
      ${view === "grid"
        ? html`<div class="grid">${shown.map((f) => html`<${FileCard} key=${f.id} file=${f} ctx=${ctx} onOpen=${setOpened} />`)}</div>`
        : html`<div class="flist">${shown.map((f) => html`<${FileRow} key=${f.id} file=${f} ctx=${ctx} />`)}</div>`}
      ${opened && (() => {
        const live = (ctx.files || []).find((f) => f.id === opened.id);
        return live && html`<div class="modal-wrap" onClick=${(e) => e.target === e.currentTarget && setOpened(null)}>
          <div class="modal file-modal"><${FileRow} file=${live} ctx=${ctx} startOpen=${true} onClose=${() => setOpened(null)} /></div>
        </div>`;
      })()}
      <p class="hint drop-hint">Tip: drag files onto this page to upload them${folder && folder !== "__expiring" ? ` into ${folder}` : ""}.</p>
    </div>`;
}

// ---------- links ----------

const linkHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const avatarHue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function LinkForm({ ctx, link, onDone }) {
  const [form, setForm] = useState(() => ({ title: link?.title || "", url: link?.url || "", folder: link?.folder || "", note: link?.note || "", pinned: !!link?.pinned }));
  const [err, setErr] = useState("");
  const folders = uniqueSorted(["Insurance", "Payments", "Booking", "Social", ...(ctx.real.links || []).map((l) => l.folder)]);
  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api(link ? `links/${link.id}` : "links", { method: link ? "PUT" : "POST", body: form });
      await ctx.load(["links"]);
      onDone();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete the “${link.title}” link?`)) return;
    await api(`links/${link.id}`, { method: "DELETE" }).catch((e2) => ctx.setToast(e2.message));
    await ctx.load(["links"]);
    onDone();
  };
  return html`<form class="link-form" onSubmit=${save}>
    <div class="cols">
      <${Field} label="WEB ADDRESS"><input class="input" inputmode="url" autofocus=${!link} placeholder="thimble.com" value=${form.url} onInput=${(e) => setForm({ ...form, url: e.target.value })} /><//>
      <${Field} label="NAME"><input class="input" placeholder="Thimble" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.target.value })} /><//>
      <${Field} label="GROUP"><input class="input" list="link-folders" placeholder="Insurance, Payments…" value=${form.folder} onInput=${(e) => setForm({ ...form, folder: e.target.value })} /><//>
      <${Field} label="NOTE"><input class="input" placeholder="Optional" value=${form.note} onInput=${(e) => setForm({ ...form, note: e.target.value })} /><//>
    </div>
    <datalist id="link-folders">${folders.map((f) => html`<option value=${f} />`)}</datalist>
    <label class="check-line"><input type="checkbox" checked=${form.pinned} onChange=${(e) => setForm({ ...form, pinned: e.target.checked })} /> Pin to the top</label>
    ${err && html`<div class="msg-err">${err}</div>`}
    <div class="task-acts">
      ${link && html`<button type="button" class="btn danger" onClick=${remove}><${Icon} name="trash" />Delete</button>`}
      ${link && html`<button type="button" class="btn" onClick=${async () => {
        await api(`links/${link.id}/thumbnail`, { method: "POST" }).catch((e2) => ctx.setToast(e2.message));
        ctx.setToast("Getting a fresh preview…");
        await ctx.load(["links"]);
        onDone();
      }}>New preview</button>`}
      <div style="flex:1"></div>
      <button type="button" class="btn" onClick=${onDone}>Cancel</button>
      <button class="btn primary" disabled=${!form.url.trim()}>${link ? "Save" : "Add link"}</button>
    </div>
  </form>`;
}

function LinksPage({ ctx }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const { links } = ctx;
  const capturing = (ctx.real.links || []).some((l) => l.image_kind === "" || l.image_kind === "working");
  useEffect(() => {
    if (!capturing) return;
    let tries = 0;
    const t = setInterval(() => { if (++tries > 15) clearInterval(t); else ctx.load(["links"]); }, 4000);
    return () => clearInterval(t);
  }, [capturing]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (links || []).filter((l) => words.every((w) => `${l.title} ${l.url} ${l.folder} ${l.note}`.toLowerCase().includes(w)));
  const groups = [];
  const pinned = shown.filter((l) => l.pinned);
  if (pinned.length) groups.push(["Pinned", pinned]);
  for (const f of uniqueSorted(shown.filter((l) => !l.pinned).map((l) => l.folder))) groups.push([f, shown.filter((l) => !l.pinned && l.folder === f)]);
  const loose = shown.filter((l) => !l.pinned && !l.folder);
  if (loose.length) groups.push([groups.length ? "Other" : "", loose]);
  return html`
    <div class="bar">
      <h1>Links</h1>
      <label class="search"><${Icon} name="search" /><span class="sr">Search links</span>
        <input placeholder="Search links…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </label>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => { setAdding(true); setEditing(null); }}><${Icon} name="plus" />Add link</button>
    </div>
    <div class="scroll pad">
      <div class="links-wrap">
        ${adding && html`<${LinkForm} ctx=${ctx} onDone=${() => setAdding(false)} />`}
        <${SampleNote} list=${links} what="links" newPath="links" />
        ${links && shown.length === 0 && html`<div class="empty"><h2>No matches</h2><p>No link fits that search.</p></div>`}
        ${groups.map(([label, items]) => html`<div class="link-group">
          ${label && html`<h3>${label}</h3>`}
          <div class="link-grid">
            ${items.map((l) => editing === l.id
              ? html`<div class="link-edit-wrap"><${LinkForm} ctx=${ctx} link=${l} onDone=${() => setEditing(null)} /></div>`
              : html`<div class="link-card">
                  <a href=${l.url} target="_blank" rel="noopener noreferrer" class="lc-shot" aria-label=${`Open ${l.title}`}>
                    ${l.image_key && (l.image_kind === "screenshot" || l.image_kind === "preview")
                      ? html`<img src=${mediaUrl(l.image_key)} alt="" loading="lazy" />`
                      : l.image_key && l.image_kind === "icon"
                        ? html`<span class="lc-icon"><img src=${mediaUrl(l.image_key)} alt="" loading="lazy" /></span>`
                        : html`<span class="lc-letter" style=${`background:hsl(${avatarHue(linkHost(l.url))} 45% 26%)`}>
                            ${(l.title[0] || "?").toUpperCase()}${!l.demo && (l.image_kind === "" || l.image_kind === "working") ? html`<small>Getting preview…</small>` : null}
                          </span>`}
                  </a>
                  <div class="lc-meta">
                    <a href=${l.url} target="_blank" rel="noopener noreferrer" class="lt-txt">
                      <span class="name">${l.title} <${SampleTag} item=${l} /></span><span class="sub">${l.note || linkHost(l.url)}</span>
                    </a>
                    ${!l.demo && html`<button class="icon-btn" aria-label=${`Edit ${l.title}`} onClick=${() => { setEditing(l.id); setAdding(false); }}><${Icon} name="edit" /></button>`}
                  </div>
                </div>`)}
          </div>
        </div>`)}
      </div>
    </div>`;
}

// ---------- stats ----------

const STAT_RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"]];
const nf = (n) => Number(n || 0).toLocaleString();
const shortDay = (d) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const BOT_KIND = { ai_live: "Looked you up for someone", ai_index: "AI search index", ai_train: "AI training", search: "Search engine" };

/** A small round number at or above n, for the top gridline. */
function niceMax(n) {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= n);
}

/**
 * Bars per day (stacked when there is more than one series). One axis, thin bars with
 * rounded tops, 2px surface gaps between stacked pieces, hairline grid, hover tooltip.
 */
function DayBars({ data, series, label }) {
  const [hover, setHover] = useState(null);
  const box = useRef();
  const W = 720, H = 180, L = 34, R = 6, T = 8, B = 22;
  const n = data.length;
  const totals = data.map((d) => series.reduce((t, s) => t + (d[s.key] || 0), 0));
  const max = niceMax(Math.max(...totals, 0));
  const slot = (W - L - R) / n;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const xLabels = n <= 7 ? data.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width * W - L) / slot);
    setHover(i >= 0 && i < n ? i : null);
  };
  const h = hover != null ? data[hover] : null;
  return html`<div class="chart" ref=${box} onPointerMove=${onMove} onPointerDown=${onMove} onPointerLeave=${() => setHover(null)}>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${label} preserveAspectRatio="none">
      ${ticks.map((t) => html`<line x1=${L} x2=${W - R} y1=${y(t)} y2=${y(t)} class="grid" />`)}
      ${data.map((d, i) => {
        let base = 0;
        const x = L + i * slot + (slot - bw) / 2;
        const parts = series.filter((s) => d[s.key] > 0);
        return html`<g class=${hover === i ? "hov" : ""}>${parts.map((s, j) => {
          const v = d[s.key];
          const top = y(base + v), bottom = y(base);
          base += v;
          const gap = j > 0 ? 2 : 0; // surface gap between stacked pieces
          const hgt = Math.max(0, bottom - top - gap);
          const r = j === parts.length - 1 ? Math.min(4, hgt, bw / 2) : 0;
          return html`<path fill=${s.color} d=${`M${x},${bottom - gap} V${top + r} q0,${-r} ${r},${-r} H${x + bw - r} q${r},0 ${r},${r} V${bottom - gap} Z`} />`;
        })}</g>`;
      })}
      ${hover != null && html`<line class="cross" x1=${L + hover * slot + slot / 2} x2=${L + hover * slot + slot / 2} y1=${T} y2=${H - B} />`}
    </svg>
    <div class="y-labels">${ticks.map((t) => html`<span style=${`top:${(y(t) / H) * 100}%`}>${nf(t)}</span>`)}</div>
    <div class="x-labels">${xLabels.map((i) => html`<span style=${`left:${((L + i * slot + slot / 2) / W) * 100}%`}>${shortDay(data[i].day)}</span>`)}</div>
    ${h && html`<div class="tip" style=${`left:${((L + hover * slot + slot / 2) / W) * 100}%`}>
      <b>${shortDay(h.day)}</b>
      ${series.map((s) => html`<div class="tip-row"><i style=${`background:${s.color}`}></i>${s.label}<span>${nf(h[s.key])}</span></div>`)}
    </div>`}
  </div>`;
}

function Legend({ series }) {
  return html`<div class="legend">${series.map((s) => html`<span><i style=${`background:${s.color}`}></i>${s.label}</span>`)}</div>`;
}

function BarList({ rows, valueLabel = "visits", tag }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return html`<div class="barlist">${rows.map((r) => html`<div class="bl-row">
    <div class="bl-bar" style=${`width:${(r.value / max) * 100}%`}></div>
    <span class="bl-name">${r.name}${tag && tag(r)}</span>
    <span class="bl-val" title=${`${nf(r.value)} ${valueLabel}`}>${nf(r.value)}</span>
  </div>`)}</div>`;
}

const PEOPLE = [{ key: "visitors", label: "Visitors", color: "var(--s-blue)" }];
const AI_SERIES = [
  { key: "fromAi", label: "Sent you visitors", color: "var(--s-blue)" },
  { key: "aiLive", label: "Looked you up", color: "var(--s-orange)" },
  { key: "aiCrawl", label: "Crawled your site", color: "var(--s-aqua)" },
];

function StatsPage({ ctx }) {
  const [days, setDays] = useState(() => Number(store.get("stats-days")) || 30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [table, setTable] = useState(false);
  useEffect(() => {
    store.set("stats-days", String(days));
    setErr("");
    api(`stats?days=${days}`).then(setData).catch((e) => setErr(e.message));
  }, [days]);
  const series = (data?.series || []).map((d) => ({ ...d, aiCrawl: d.aiIndex + d.aiTrain }));
  const t = data?.totals;
  const empty = data && !data.trackingSince;
  return html`
    <div class="bar">
      <h1>Stats</h1>
      <div class="grow"></div>
      <div class="seg wide" role="group" aria-label="Time range">
        ${STAT_RANGES.map(([d, label]) => html`<button class=${days === d ? "on" : ""} aria-pressed=${days === d} onClick=${() => setDays(d)}>${label}</button>`)}
      </div>
    </div>
    <div class="scroll pad">
      <div class="stats">
        ${err && html`<div class="empty"><h2>Couldn't load stats</h2><p>${err}</p></div>`}
        ${!data && !err && html`<p class="muted-sm">Loading…</p>`}
        ${data && html`
          <p class="muted-sm">${empty ? "Counting starts now — visits will show up here as they happen." : `Counting since ${shortDay(data.trackingSince)} · ${shortDay(data.start)} – ${shortDay(data.end)}`}</p>
          <div class="tiles">
            <div class="tile"><span class="t-label">Visitors</span><b>${nf(t.visitors)}</b><span class="t-sub">${nf(t.views)} page views</span></div>
            <div class="tile"><span class="t-label">Sent by AI assistants</span><b>${nf(t.fromAi)}</b><span class="t-sub">Visits from ChatGPT, Perplexity, Gemini…</span></div>
            <div class="tile"><span class="t-label">AI looked you up</span><b>${nf(t.aiLive)}</b><span class="t-sub">An assistant read your site while answering someone</span></div>
            <div class="tile"><span class="t-label">AI crawler visits</span><b>${nf(t.aiCrawl)}</b><span class="t-sub">Reading your site so AI knows about you</span></div>
          </div>

          <section class="card-sec">
            <div class="sec-top"><h3>People per day</h3><button class="link-btn" onClick=${() => setTable(!table)}>${table ? "Show charts" : "Show as table"}</button></div>
            ${table
              ? html`<div class="stat-table"><table><thead><tr><th>Day</th><th>Visitors</th><th>Views</th><th>Sent by AI</th><th>Looked up</th><th>Crawled</th></tr></thead>
                  <tbody>${[...series].reverse().map((d) => html`<tr><td>${shortDay(d.day)}</td><td>${nf(d.visitors)}</td><td>${nf(d.views)}</td><td>${nf(d.fromAi)}</td><td>${nf(d.aiLive)}</td><td>${nf(d.aiCrawl)}</td></tr>`)}</tbody></table></div>`
              : html`<${DayBars} data=${series} series=${PEOPLE} label="Visitors per day" />`}
          </section>

          ${!table && html`<section class="card-sec">
            <div class="sec-top"><h3>AI activity per day</h3></div>
            <${Legend} series=${AI_SERIES} />
            <${DayBars} data=${series} series=${AI_SERIES} label="AI activity per day: visitors sent by AI assistants, live look-ups, and crawler visits" />
          </section>`}

          <div class="two-col">
            <section class="card-sec">
              <h3>Where visitors came from</h3>
              ${data.sources.length ? html`<${BarList} rows=${data.sources.map((s) => ({ name: s.name, value: s.views, ai: s.ai }))} valueLabel="page views" tag=${(r) => (r.ai ? html` <span class="ai-tag">AI</span>` : null)} />` : html`<p class="muted-sm">No visitors yet.</p>`}
            </section>
            <section class="card-sec">
              <h3>Top pages</h3>
              ${data.pages.length ? html`<${BarList} rows=${data.pages.map((p) => ({ name: p.path, value: p.views }))} valueLabel="page views" />` : html`<p class="muted-sm">No page views yet.</p>`}
            </section>
          </div>

          <section class="card-sec">
            <h3>AI assistants & search engines</h3>
            ${data.bots.length
              ? html`<div class="bots">${data.bots.map((b) => html`<div class="bot-row"><span class="bl-name">${b.name}</span><span class="bot-kind">${BOT_KIND[b.kind] || b.kind}</span><span class="bl-val">${nf(b.views)}</span></div>`)}</div>`
              : html`<p class="muted-sm">None yet.</p>`}
            <p class="hint">“Looked you up” means an assistant like ChatGPT opened your site while answering someone's question — the closest sign that you came up in a conversation. Nobody can see conversations that never reach your site.</p>
          </section>`}
      </div>
    </div>`;
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
        <a class="btn" href="/" target="_blank" rel="noopener">View site</a>
        <div style="flex:1"></div>
        <button type="button" class="btn" onClick=${onClose}>Close</button>
        <button class="btn primary" disabled=${busy || !current || next.length < 10}>Change password</button>
      </div>
    </form>
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
