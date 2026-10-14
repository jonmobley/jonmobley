// Social: Jon's online presence (numbers, comments and reviews, drafts and a posting calendar).
// Lives inside Backstage behind the header switch; the chat on the left switches to Social too.
import { html, useState, useEffect, useRef } from "./vendor/preact-htm.js";
import { api, Icon, upload, mediaUrl, ago, go, nf, shortDay, DayBars, Field, Area, Text, store } from "./app.js";

// [route, desktop label, phone label, icon] — same shape as Backstage's SECTIONS.
export const SOCIAL_SECTIONS = [
  ["social", "Today", "Today", "home"],
  ["social/posts", "Posts", "Posts", "calendar"],
  ["social/inbox", "Inbox", "Inbox", "chat"],
  ["social/stats", "Stats", "Stats", "chart"],
  ["social/accounts", "Accounts", "Accounts", "link"],
];
export const SOCIAL_PHONE_MAIN = ["social", "social/posts", "social/inbox", "social/stats"];
export const SOCIAL_DESKTOP_MAIN = SOCIAL_SECTIONS.map(([k]) => k);

export const SOCIAL_IDEAS = [
  "How are my accounts doing?",
  "Draft 3 Instagram posts about my Fool Us clip",
  "Suggest replies to my new YouTube comments",
  "Plan a week of posts around my next show",
];

const PLATFORM = {
  website: { label: "Website", short: "Web", hue: "#8a8a8a" },
  youtube: { label: "YouTube", short: "YT", hue: "#e5484d" },
  instagram: { label: "Instagram", short: "IG", hue: "#d6409f" },
  facebook: { label: "Facebook", short: "FB", hue: "#3e63dd" },
  google: { label: "Google", short: "G", hue: "#30a46c" },
  linkedin: { label: "LinkedIn", short: "in", hue: "#0b75b5" },
};
const POST_TO = ["instagram", "facebook", "youtube", "google", "linkedin"];
// Caption limits worth warning about (characters).
const LIMITS = { instagram: 2200, linkedin: 3000, google: 1500 };
// Where Jon goes to post by hand until a platform is connected.
const POST_HERE = {
  instagram: () => "https://www.instagram.com/mobleymagic/",
  facebook: () => "https://www.facebook.com/mobleymagic",
  youtube: () => "https://studio.youtube.com/",
  google: () => "https://www.google.com/search?q=jon+mobley+magician",
  linkedin: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text.slice(0, 2500))}`,
};

const Dot = ({ p }) => html`<span class="pf-dot" style=${`--pf:${PLATFORM[p]?.hue || "#888"}`} title=${PLATFORM[p]?.label || p}>${PLATFORM[p]?.short || p}</span>`;
const when = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const signed = (n) => (n > 0 ? `+${nf(n)}` : n < 0 ? `−${nf(-n)}` : "no change");
async function copy(text, ctx, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    ctx.setToast(what);
  } catch {
    ctx.setToast("Couldn't copy. Select the text and copy it instead.");
  }
}

/** Loads a Social API path and reloads it when the chat changes something. */
function useSocial(path, ctx) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const reload = () => api(path).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { reload(); }, [path, ctx.socialTick]);
  return { data, err, reload, setData };
}

export function SocialView({ route, ctx }) {
  const [, page, id] = route;
  if (page === "posts" && id) return html`<${PostEditor} key=${id} id=${id} ctx=${ctx} />`;
  if (page === "posts") return html`<${PostsPage} ctx=${ctx} />`;
  if (page === "inbox") return html`<${InboxPage} ctx=${ctx} />`;
  if (page === "stats") return html`<${SocialStats} ctx=${ctx} />`;
  if (page === "accounts") return html`<${AccountsPage} ctx=${ctx} />`;
  return html`<${TodayPage} ctx=${ctx} />`;
}

// ---------- Today: the one-minute approval queue ----------

const KIND = {
  reply: { label: "Reply", icon: "chat" },
  post: { label: "Post", icon: "calendar" },
  task: { label: "To do", icon: "checkbox" },
};

/** One proposal: what, why, the text (editable), and a single Approve / Skip. */
function ActionCard({ a, ctx, onGone }) {
  const [body, setBody] = useState(a.body);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const platforms = a.extra?.platforms?.length ? a.extra.platforms : a.platform ? [a.platform] : [];
  const approveLabel = a.kind === "reply" ? (body ? "Copy reply & open" : "Open") : a.kind === "post" ? (a.when_at ? `Schedule · ${when(a.when_at)}` : "Save as draft") : "Add to my tasks";
  const decide = async (decision) => {
    // Opening a tab and copying must happen right in the click, or the browser blocks them.
    if (decision === "approve" && a.kind === "reply") {
      if (body) navigator.clipboard?.writeText(body).catch(() => {});
      if (a.link) window.open(a.link, "_blank", "noopener");
    }
    setBusy(true);
    try {
      await api(`social/actions/${a.id}`, { method: "POST", body: { decision, body } });
      ctx.setToast(decision === "skip" ? "Skipped" : a.kind === "reply" ? "Reply copied. Paste it there." : a.kind === "post" ? (a.when_at ? "Scheduled" : "Saved to drafts") : "Added to Tasks");
      setLeaving(true);
      setTimeout(() => onGone(a.id), 220);
    } catch (e) {
      ctx.setToast(e.message);
      setBusy(false);
    }
  };
  return html`<article class=${`action-card k-${a.kind} ${leaving ? "leaving" : ""}`}>
    <div class="ac-top">
      <span class="ac-kind"><${Icon} name=${KIND[a.kind]?.icon || "note"} size=${14} />${KIND[a.kind]?.label || a.kind}</span>
      ${platforms.map((p) => html`<${Dot} p=${p} />`)}
    </div>
    <h3>${a.title}</h3>
    ${a.why && html`<p class="ac-why">${a.why}</p>`}
    ${(body || editing) && (editing
      ? html`<${Area} rows=${3} max=${360} value=${body} onInput=${setBody} />`
      : html`<button class="ac-body" title="Edit" onClick=${() => setEditing(true)}>${body}</button>`)}
    <div class="ac-actions">
      <button class="btn ac-skip" disabled=${busy} onClick=${() => decide("skip")}>Skip</button>
      ${body && !editing && html`<button class="btn ac-icon" aria-label="Edit text" onClick=${() => setEditing(true)}><${Icon} name="edit" /></button>`}
      ${a.kind === "task" && a.link && html`<a class="btn ac-icon" href=${a.link} target="_blank" rel="noopener" aria-label="Open"><${Icon} name="external" /></a>`}
      <button class="btn primary ac-go" disabled=${busy} onClick=${() => decide("approve")}><${Icon} name="check" />${approveLabel}</button>
    </div>
  </article>`;
}

/** A scheduled post whose time has come (platforms not connected: Jon posts it himself). */
function DueCard({ p, ctx, onGone }) {
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const open = () => {
    navigator.clipboard?.writeText(p.text).catch(() => {});
    const first = p.platforms[0];
    if (first) window.open(POST_HERE[first](p.text), "_blank", "noopener");
    ctx.setToast("Post copied. Paste it there, then tap Done.");
  };
  const done = async () => {
    setBusy(true);
    try {
      await api(`social/posts/${p.id}`, { method: "PUT", body: { status: "posted" } });
      setLeaving(true);
      setTimeout(() => onGone(p.id), 220);
    } catch (e) {
      ctx.setToast(e.message);
      setBusy(false);
    }
  };
  return html`<article class=${`action-card k-due ${leaving ? "leaving" : ""}`}>
    <div class="ac-top"><span class="ac-kind"><${Icon} name="calendar" size=${14} />Time to post</span>${p.platforms.map((x) => html`<${Dot} p=${x} />`)}</div>
    <h3>${p.text.split("\n")[0] || "Scheduled post"}</h3>
    <p class="ac-why">Scheduled for ${when(p.scheduled_at)}${p.notes ? ` · ${p.notes}` : ""}</p>
    ${p.media?.length > 0 && html`<div class="ac-media">${p.media.map((k) => html`<a href=${mediaUrl(k)} download>${/\.(jpg|png|webp|gif|heic)$/.test(k) ? html`<img src=${mediaUrl(k)} alt="" />` : k.split(".").pop().toUpperCase()}</a>`)}</div>`}
    <div class="ac-actions">
      <button class="btn ac-icon" aria-label="Edit post" onClick=${() => go(`social/posts/${p.id}`)}><${Icon} name="edit" /></button>
      <button class="btn ac-skip" disabled=${busy} onClick=${done}>Posted</button>
      <button class="btn primary ac-go" onClick=${open}><${Icon} name="external" />Copy & open ${PLATFORM[p.platforms[0]]?.label || ""}</button>
    </div>
  </article>`;
}

function TodayPage({ ctx }) {
  const { data: o, err, reload, setData } = useSocial("social/overview", ctx);
  const [thinking, setThinking] = useState(false);
  // The server refreshes in the background on open when things are stale; look again after.
  useEffect(() => { const t = setTimeout(reload, 15000); return () => clearTimeout(t); }, []);
  const more = async () => {
    setThinking(true);
    try {
      const r = await api("social/propose", { method: "POST", body: {} });
      ctx.setToast(r.added ? `${r.added} new suggestion${r.added === 1 ? "" : "s"}` : "Nothing new to suggest right now");
      await reload();
    } catch (e) {
      ctx.setToast(e.message);
    }
    setThinking(false);
  };
  const goneAction = (id) => setData((d) => ({ ...d, actions: d.actions.filter((a) => a.id !== id) }));
  const goneDue = (id) => setData((d) => ({ ...d, due: d.due.filter((p) => p.id !== id) }));

  const yt = o?.numbers?.youtube;
  const web = o?.numbers?.website;
  const count = o ? o.due.length + o.actions.length : 0;
  const nextUp = o?.upcoming?.[0];

  return html`
    <div class="scroll pad">
      <div class="today">
        <header class="home-head">
          <div>
            <h1>${!o ? "Social" : count === 0 ? "All clear" : `${count} thing${count === 1 ? "" : "s"} for you`}</h1>
            <p class="muted-sm">${!o ? "" : count === 0 ? "Nothing needs you right now." : "Approve or skip. Each one is a single tap."}</p>
          </div>
          <div class="quick">
            <button class="btn suggest" disabled=${thinking} onClick=${more} aria-label="Suggest more"><${Icon} name="wand" /><span class="btn-word">${thinking ? "Thinking…" : "Suggest more"}</span></button>
          </div>
        </header>
        ${err && html`<div class="empty"><h2>Couldn't load</h2><p>${err}</p></div>`}
        ${!o && !err && html`<p class="muted-sm">Loading…</p>`}
        ${o && html`
          <div class="pulse">
            <div><b>${yt ? nf(yt.followers) : "—"}</b><span>YouTube subscribers${yt?.change?.followers ? ` · ${signed(yt.change.followers)}` : ""}</span></div>
            <div><b>${web ? nf(web.views) : "—"}</b><span>site visitors this week</span></div>
            <div><b>${web ? nf(web.extra?.booking_views_7d) : "—"}</b><span>booking page views</span></div>
          </div>
          <div class="queue">
            ${o.due.map((p) => html`<${DueCard} key=${p.id} p=${p} ctx=${ctx} onGone=${goneDue} />`)}
            ${o.actions.map((a) => html`<${ActionCard} key=${a.id} a=${a} ctx=${ctx} onGone=${goneAction} />`)}
            ${count === 0 && html`<div class="all-clear">
              <p>${o.last_proposed ? `Last looked ${ago(o.last_proposed)}.` : "No suggestions yet."} New comments and ideas show up here on their own, or tap Suggest more.</p>
            </div>`}
          </div>
          <p class="muted-sm today-foot">
            ${nextUp ? html`Next post: ${when(nextUp.scheduled_at)} · ` : ""}
            <button class="link-btn" onClick=${() => go("social/posts")}>Posts</button> ·
            <button class="link-btn" onClick=${() => go("social/inbox")}>Inbox</button> ·
            <button class="link-btn" onClick=${() => go("social/stats")}>Stats</button>
          </p>`}
      </div>
    </div>`;
}

// ---------- Posts ----------

const POST_FILTERS = [["draft", "Drafts"], ["scheduled", "Scheduled"], ["posted", "Posted"]];

function PostRow({ post: p }) {
  const due = p.status === "scheduled" && p.scheduled_at <= Date.now();
  return html`<button class="post-row" onClick=${() => go(`social/posts/${p.id}`)}>
    ${p.media?.[0] && /\.(jpg|png|webp|gif|heic)$/.test(p.media[0]) ? html`<img class="post-thumb" src=${mediaUrl(p.media[0])} alt="" />` : html`<span class="post-thumb blank"><${Icon} name="note" /></span>`}
    <span class="what">
      <b>${p.text.split("\n")[0] || "Untitled post"}</b>
      <span class="post-meta">
        ${p.platforms.map((x) => html`<${Dot} p=${x} />`)}
        <span class=${due ? "due" : ""}>${p.status === "scheduled" ? (due ? `Due ${ago(p.scheduled_at)}` : when(p.scheduled_at)) : p.status === "posted" ? `Posted ${p.posted_at ? ago(p.posted_at) : ""}` : `Draft · ${ago(p.updated_at)}`}</span>
      </span>
    </span>
  </button>`;
}

function PostsPage({ ctx }) {
  const { data, err } = useSocial("social/posts", ctx);
  const [filter, setFilter] = useState(() => store.get("social-posts-filter") || "draft");
  useEffect(() => { store.set("social-posts-filter", filter); }, [filter]);
  const list = (data || []).filter((p) => p.status === filter);
  if (filter === "scheduled") list.sort((a, b) => a.scheduled_at - b.scheduled_at);
  // Scheduled posts read like a calendar: grouped by day.
  const days = [];
  if (filter === "scheduled") for (const p of list) {
    const d = new Date(p.scheduled_at).toDateString();
    if (!days.length || days[days.length - 1].d !== d) days.push({ d, ms: p.scheduled_at, posts: [] });
    days[days.length - 1].posts.push(p);
  }
  const counts = Object.fromEntries(POST_FILTERS.map(([k]) => [k, (data || []).filter((p) => p.status === k).length]));
  return html`
    <div class="bar">
      <h1>Posts</h1>
      <div class="grow"></div>
      <button class="btn primary" onClick=${() => go("social/posts/new")}><${Icon} name="plus" />New post</button>
    </div>
    <div class="scroll pad">
      <div class="posts">
        <div class="seg wide" role="group" aria-label="Show">
          ${POST_FILTERS.map(([k, l]) => html`<button class=${filter === k ? "on" : ""} aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${l}${counts[k] ? ` (${counts[k]})` : ""}</button>`)}
        </div>
        ${err && html`<div class="empty"><h2>Couldn't load posts</h2><p>${err}</p></div>`}
        ${!data && !err && html`<p class="muted-sm">Loading…</p>`}
        ${data && list.length === 0 && html`<div class="empty">
          <h2>${filter === "draft" ? "No drafts" : filter === "scheduled" ? "Nothing scheduled" : "Nothing posted yet"}</h2>
          <p>${filter === "posted" ? "When you post something, mark it posted and it lands here." : "Write one, or ask the chat: “Draft a post about Saturday's show.”"}</p>
        </div>`}
        ${filter === "scheduled"
          ? days.map((g) => html`<section class="day-group"><h3>${new Date(g.ms).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h3>${g.posts.map((p) => html`<${PostRow} post=${p} />`)}</section>`)
          : list.map((p) => html`<${PostRow} post=${p} />`)}
      </div>
    </div>`;
}

const BLANK_POST = { text: "", platforms: ["instagram", "facebook"], media: [], status: "draft", scheduled_at: null, post_url: "", notes: "" };
// <input type="datetime-local"> works in the browser's time zone (Jon's).
const toLocalInput = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function PostEditor({ id, ctx }) {
  const isNew = id === "new";
  const [draft, setDraft] = useState(isNew ? { ...BLANK_POST } : null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [missing, setMissing] = useState(false);
  const fileInput = useRef();
  useEffect(() => {
    if (isNew) return;
    api(`social/posts/${id}`).then(setDraft).catch((e) => (e.status === 404 ? setMissing(true) : setErr(e.message)));
  }, [id, ctx.socialTick]);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };

  const save = async (patch = {}) => {
    const body = { ...draft, ...patch };
    if (body.status === "scheduled" && !body.scheduled_at) { setErr("Pick a date and time to schedule it."); return; }
    setBusy(true);
    setErr("");
    try {
      const saved = await api(isNew ? "social/posts" : `social/posts/${id}`, { method: isNew ? "POST" : "PUT", body });
      setDraft(saved);
      setDirty(false);
      ctx.setToast(patch.status === "posted" ? "Marked as posted" : "Saved");
      if (isNew) location.replace(`#/social/posts/${saved.id}`);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm("Delete this post?")) return;
    try {
      await api(`social/posts/${id}`, { method: "DELETE" });
      setDirty(false);
      go("social/posts");
    } catch (e) {
      setErr(e.message);
    }
  };
  const addPhotos = async (files) => {
    for (const f of files) {
      try {
        const r = await upload(f);
        setDraft((d) => ({ ...d, media: [...d.media, r.key] }));
        setDirty(true);
      } catch (e) {
        ctx.setToast(e.message);
      }
    }
  };

  const back = html`<div class="bar">
    <button class="ghost" onClick=${() => { if (!dirty || confirm("You have unsaved changes. Leave without saving?")) go("social/posts"); }} aria-label="Back to Posts"><${Icon} name="back" /><span class="back-word">Posts</span></button>
    <div class="grow"></div>
  </div>`;
  if (missing) return html`${back}<div class="empty"><h2>Post not found</h2><p>It may have been deleted.</p></div>`;
  if (!draft) return html`${back}${err && html`<div class="empty"><h2>Couldn't load</h2><p>${err}</p></div>`}`;

  const len = [...draft.text].length;
  const over = draft.platforms.filter((p) => LIMITS[p] && len > LIMITS[p]);
  return html`
    ${back}
    <div class="scroll pad">
      <div class="editor">
        <${Field} label="WHERE IT GOES">
          <div class="chips">${POST_TO.map((p) => {
            const on = draft.platforms.includes(p);
            return html`<button class=${`chip ${on ? "on" : ""}`} aria-pressed=${on} onClick=${() => set({ platforms: on ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p] })}>${PLATFORM[p].label}</button>`;
          })}</div>
        <//>
        <${Field} label="POST">
          <${Area} rows=${6} max=${640} value=${draft.text} placeholder="What do you want to say? Or ask the chat to write it." onInput=${(v) => set({ text: v })} />
        <//>
        <div class="post-tools">
          <span class=${`muted-sm ${over.length ? "err-text" : ""}`}>${nf(len)} characters${over.length ? ` · too long for ${over.map((p) => PLATFORM[p].label).join(", ")}` : ""}</span>
          <div class="grow"></div>
          <button class="btn" disabled=${!draft.text} onClick=${() => copy(draft.text, ctx, "Post copied")}><${Icon} name="file" />Copy text</button>
        </div>
        <div class="section">
          <h3>Photos and video</h3>
          <div class="post-media">
            ${draft.media.map((k) => html`<div class="thumb">
              ${/\.(jpg|png|webp|gif|heic)$/.test(k) ? html`<img src=${mediaUrl(k)} alt="" />` : html`<a href=${mediaUrl(k)} target="_blank" rel="noopener" class="thumb-file">${k.split(".").pop().toUpperCase()}</a>`}
              <a class="dl" href=${mediaUrl(k)} download aria-label="Download"><${Icon} name="download" size=${14} /></a>
              <button class="x" aria-label="Remove" onClick=${() => set({ media: draft.media.filter((x) => x !== k) })}><${Icon} name="x" /></button>
            </div>`)}
            <button class="add-tile" onClick=${() => fileInput.current.click()}><${Icon} name="plus" /><span>Add</span></button>
            <input ref=${fileInput} type="file" hidden multiple accept="image/*,video/*" onChange=${(e) => { addPhotos([...e.target.files]); e.target.value = ""; }} />
          </div>
        </div>
        <div class="section">
          <h3>When</h3>
          <div class="seg" role="group" aria-label="Status">
            ${[["draft", "Draft"], ["scheduled", "Scheduled"], ["posted", "Posted"]].map(([k, l]) => html`<button class=${draft.status === k ? "on" : ""} aria-pressed=${draft.status === k} onClick=${() => set({ status: k })}>${l}</button>`)}
          </div>
          ${draft.status === "scheduled" && html`<${Field} label="POST ON">
            <input class="input" type="datetime-local" value=${toLocalInput(draft.scheduled_at)} onInput=${(e) => set({ scheduled_at: e.target.value ? new Date(e.target.value).getTime() : null })} />
          <//>`}
          ${draft.status === "posted" && html`<${Field} label="LINK TO THE POST (OPTIONAL)"><${Text} inputmode="url" placeholder="https://…" value=${draft.post_url} onInput=${(v) => set({ post_url: v })} /><//>`}
          <p class="hint">Instagram, Facebook, Google and LinkedIn aren't connected yet, so you post these yourself: copy the text, open the app, post, then mark it Posted. Once an account is connected, scheduled posts go out on their own.</p>
          ${draft.platforms.length > 0 && html`<div class="chips">${draft.platforms.map((p) => html`<a class="chip" href=${POST_HERE[p](draft.text)} target="_blank" rel="noopener"><${Icon} name="external" size=${13} /> Open ${PLATFORM[p].label}</a>`)}</div>`}
        </div>
        <${Field} label="NOTES (ONLY YOU SEE THESE)"><${Area} value=${draft.notes} placeholder="Which clip, who to tag…" onInput=${(v) => set({ notes: v })} /><//>
      </div>
    </div>
    <div class="foot">
      <span class=${`note ${err ? "err" : ""}`}>${err || (dirty ? "Unsaved changes" : isNew ? "" : "All changes saved")}</span>
      ${!isNew && html`<button class="btn danger" onClick=${remove}><${Icon} name="trash" />Delete</button>`}
      ${!isNew && draft.status !== "posted" && html`<button class="btn" disabled=${busy} onClick=${() => save({ status: "posted" })}><${Icon} name="check" />Mark posted</button>`}
      <button class="btn primary" disabled=${(!dirty && !isNew) || busy || (!draft.text && !draft.media.length)} onClick=${() => save()}>${busy ? "Saving…" : isNew ? "Save post" : "Save"}</button>
    </div>`;
}

// ---------- Inbox ----------

function InboxRow({ item: i, ctx, onChange }) {
  const [reply, setReply] = useState(i.suggested_reply || "");
  useEffect(() => setReply(i.suggested_reply || ""), [i.suggested_reply]);
  const put = async (body, msg) => {
    try {
      onChange(await api(`social/inbox/${encodeURIComponent(i.id)}`, { method: "PUT", body }));
      if (msg) ctx.setToast(msg);
    } catch (e) {
      ctx.setToast(e.message);
    }
  };
  const handled = i.status === "done" || !!i.replied;
  return html`<article class=${`inbox-item ${handled ? "handled" : ""}`}>
    <header>
      <${Dot} p=${i.platform} />
      <b>${i.author || "Someone"}</b>
      <span class="muted-sm">${i.kind}${i.context ? html` on <i>${i.context}</i>` : ""} · ${ago(i.at)}</span>
      <div class="grow"></div>
      ${i.replied ? html`<span class="pill ok">You replied</span>` : i.status === "done" ? html`<span class="pill">Handled</span>` : null}
    </header>
    <p class="inbox-text">${i.text}</p>
    ${!handled && html`<div class="reply-box">
      <${Area} rows=${2} value=${reply} placeholder="Your reply…" onInput=${setReply} />
      <div class="reply-actions">
        <button class="btn" onClick=${() => ctx.ask(`Suggest a reply to ${i.author}'s ${PLATFORM[i.platform]?.label || ""} ${i.kind} (inbox id ${i.id}) and save it on the item.`)}><${Icon} name="chat" />Ask chat</button>
        ${reply !== (i.suggested_reply || "") && html`<button class="btn" onClick=${() => put({ suggested_reply: reply }, "Reply saved")}>Save</button>`}
        <div class="grow"></div>
        ${reply && html`<button class="btn" onClick=${() => copy(reply, ctx, "Reply copied")}><${Icon} name="file" />Copy</button>`}
        <a class="btn" href=${i.url} target="_blank" rel="noopener"><${Icon} name="external" />Reply on ${PLATFORM[i.platform]?.label || "site"}</a>
      </div>
    </div>`}
    <div class="inbox-foot">
      ${i.status === "done"
        ? html`<button class="btn" onClick=${() => put({ status: "new" })}>Move back to waiting</button>`
        : !i.replied && html`<button class="btn" onClick=${() => put({ status: "done", suggested_reply: reply }, "Marked handled")}><${Icon} name="check" />Mark handled</button>`}
      ${handled && html`<a class="link-btn" href=${i.url} target="_blank" rel="noopener">Open</a>`}
    </div>
  </article>`;
}

function InboxPage({ ctx }) {
  const [show, setShow] = useState(() => store.get("social-inbox") || "needs");
  useEffect(() => { store.set("social-inbox", show); }, [show]);
  const { data, err, setData } = useSocial(show === "needs" ? "social/inbox?status=needs" : "social/inbox", ctx);
  const update = (it) => setData((list) => (show === "needs" && (it.status === "done" || it.replied) ? list.filter((x) => x.id !== it.id) : list.map((x) => (x.id === it.id ? it : x))));
  return html`
    <div class="bar">
      <h1>Inbox</h1>
      <div class="grow"></div>
      <div class="seg wide" role="group" aria-label="Show">
        <button class=${show === "needs" ? "on" : ""} aria-pressed=${show === "needs"} onClick=${() => setShow("needs")}>Waiting on you</button>
        <button class=${show === "all" ? "on" : ""} aria-pressed=${show === "all"} onClick=${() => setShow("all")}>Everything</button>
      </div>
    </div>
    <div class="scroll pad">
      <div class="inbox">
        <p class="hint">YouTube comments come in now. Instagram and Facebook messages and comments, and Google reviews, join once those accounts are connected.</p>
        ${err && html`<div class="empty"><h2>Couldn't load</h2><p>${err}</p></div>`}
        ${!data && !err && html`<p class="muted-sm">Loading…</p>`}
        ${data && data.length === 0 && html`<div class="empty"><h2>${show === "needs" ? "Nothing waiting on you" : "Nothing here yet"}</h2><p>New comments show up here after a refresh (Today → Refresh), or every few hours on their own.</p></div>`}
        ${(data || []).map((i) => html`<${InboxRow} key=${i.id} item=${i} ctx=${ctx} onChange=${update} />`)}
      </div>
    </div>`;
}

// ---------- Stats ----------

function VideoList({ videos }) {
  if (!videos?.length) return html`<p class="muted-sm">None yet.</p>`;
  return html`<div class="video-list">${videos.map((v) => html`<a class="video-row" href=${v.url} target="_blank" rel="noopener">
    <img src=${`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
    <span class="what"><b>${v.title}</b><span>${nf(v.views)} views${v.published ? ` · ${new Date(v.published).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""}</span></span>
  </a>`)}</div>`;
}

const SOCIAL_RANGES = [[30, "30 days"], [90, "90 days"], [365, "1 year"]];
function SocialStats({ ctx }) {
  const [days, setDays] = useState(30);
  const { data, err } = useSocial(`social/stats?days=${days}`, ctx);
  const yt = data?.latest?.youtube;
  const web = data?.latest?.website;
  // Views gained per day, from the daily lifetime totals.
  const ytRows = data?.series?.youtube || [];
  const gained = ytRows.slice(1).map((r, i) => ({ day: r.day, views: Math.max(0, (r.views ?? 0) - (ytRows[i].views ?? 0)) }));
  return html`
    <div class="bar">
      <h1>Stats</h1>
      <div class="grow"></div>
      <div class="seg wide" role="group" aria-label="Time range">
        ${SOCIAL_RANGES.map(([d, label]) => html`<button class=${days === d ? "on" : ""} aria-pressed=${days === d} onClick=${() => setDays(d)}>${label}</button>`)}
      </div>
    </div>
    <div class="scroll pad">
      <div class="stats">
        ${err && html`<div class="empty"><h2>Couldn't load stats</h2><p>${err}</p></div>`}
        ${!data && !err && html`<p class="muted-sm">Loading…</p>`}
        ${data && html`
          <section class="card-sec">
            <div class="sec-top"><h3><${Dot} p="youtube" /> YouTube</h3><a class="link-btn" href="https://studio.youtube.com/" target="_blank" rel="noopener">YouTube Studio</a></div>
            ${!yt ? html`<p class="muted-sm">No numbers yet. Today → Refresh pulls them in.</p>` : html`
              <div class="mini-tiles">
                <div><b>${nf(yt.followers)}</b><span>subscribers${yt.since ? ` (${signed(yt.change.followers)})` : ""}</span></div>
                <div><b>${nf(yt.views)}</b><span>views all time${yt.since ? ` (${signed(yt.change.views)})` : ""}</span></div>
                <div><b>${nf(yt.posts)}</b><span>videos</span></div>
              </div>
              ${gained.length >= 2 ? html`<${DayBars} data=${gained} series=${[{ key: "views", label: "Views gained", color: "var(--s-blue)" }]} label="YouTube views gained per day" />`
                : html`<p class="hint">The daily chart fills in as the app checks YouTube each day.</p>`}
              <div class="two-col">
                <div><h4>Most watched</h4><${VideoList} videos=${yt.extra?.top} /></div>
                <div><h4>Newest</h4><${VideoList} videos=${(yt.extra?.recent || []).slice(0, 5)} /></div>
              </div>`}
          </section>
          <section class="card-sec">
            <div class="sec-top"><h3><${Dot} p="website" /> Website</h3><button class="link-btn" onClick=${() => go("stats")}>Full website stats</button></div>
            ${!web ? html`<p class="muted-sm">No numbers yet.</p>` : html`<div class="mini-tiles">
              <div><b>${nf(web.views)}</b><span>visitors, 7 days</span></div>
              <div><b>${nf(web.extra?.booking_views_7d)}</b><span>booking page views</span></div>
              <div><b>${nf(web.extra?.ai_lookups_7d)}</b><span>AI look-ups</span></div>
            </div>`}
          </section>
          <section class="card-sec">
            <h3>Instagram, Facebook, Google, LinkedIn</h3>
            <p class="muted-sm">Their numbers show here once each account is connected.</p>
            <button class="btn" onClick=${() => go("social/accounts")}><${Icon} name="link" />Accounts</button>
          </section>`}
      </div>
    </div>`;
}

// ---------- Accounts ----------

function AccountsPage({ ctx }) {
  const { data, err, reload } = useSocial("social/accounts", ctx);
  const [syncing, setSyncing] = useState(false);
  const refresh = async () => {
    setSyncing(true);
    try { await api("social/sync", { method: "POST", body: {} }); await reload(); ctx.setToast("Up to date"); } catch (e) { ctx.setToast(e.message); }
    setSyncing(false);
  };
  return html`
    <div class="bar">
      <h1>Accounts</h1>
      <div class="grow"></div>
      <button class="btn" disabled=${syncing} onClick=${refresh}><${Icon} name="history" />${syncing ? "Refreshing…" : "Refresh now"}</button>
    </div>
    <div class="scroll pad">
      <div class="accounts">
        ${err && html`<div class="empty"><h2>Couldn't load</h2><p>${err}</p></div>`}
        ${(data || []).map((a) => html`<section class="card-sec account">
          <div class="sec-top">
            <h3><${Dot} p=${a.platform} /> ${PLATFORM[a.platform].label}</h3>
            <span class=${`pill ${a.connected ? (a.last_error ? "warn" : "ok") : ""}`}>${a.connected ? (a.last_error ? "Problem" : "Connected") : "Not connected"}</span>
          </div>
          <a class="acct-link" href=${a.url} target="_blank" rel="noopener">${a.name} <${Icon} name="external" size=${13} /></a>
          ${a.connected && html`<p class="muted-sm">${a.last_sync ? `Checked ${ago(a.last_sync)}` : "Not checked yet"}${a.platform === "youtube" ? " · numbers and comments (read-only)" : a.platform === "website" ? " · from your site's own stats" : ""}</p>`}
          ${a.last_error && html`<p class="err-text">${a.last_error}</p>`}
          ${a.how && html`<p class="hint">${a.how}</p>`}
        </section>`)}
      </div>
    </div>`;
}
