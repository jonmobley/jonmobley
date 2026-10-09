// The view-only page behind a Backstage share link (/share/<token>): a set list, playlist
// or trick, laid out for someone working the show from their phone. Packing ticks are
// remembered on this device only.
import { html, render, useState, useEffect } from "./vendor/preact-htm.js";

const token = location.pathname.split("/").filter(Boolean)[1] || "";
const mediaUrl = (key) => `/api/shared/${token}/media/${key.replace(/^media\//, "")}`;

const fmtMin = (m) => {
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = Math.round((m % 60) * 10) / 10;
  return h ? `${h} hr${r ? ` ${r} min` : ""}` : `${r} min`;
};
const fmtSec = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};
const linkHref = (u) => (/^https?:/.test(u) ? u : `https://${u}`);

function useTicks() {
  const key = `share-ticks:${token}`;
  const [ticks, setTicks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
  });
  const toggle = (k) =>
    setTicks((t) => {
      const next = { ...t, [k]: !t[k] };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  const clear = () => {
    setTicks({});
    try { localStorage.removeItem(key); } catch {}
  };
  return { ticks, toggle, clear };
}

function Photos({ keys }) {
  if (!keys?.length) return null;
  return html`<div class="photos">${keys.map((k) => html`<a href=${mediaUrl(k)} target="_blank" rel="noopener noreferrer"><img src=${mediaUrl(k)} alt="" loading="lazy" /></a>`)}</div>`;
}

function Detail({ label, text }) {
  if (!text) return null;
  return html`<div class="detail"><span>${label}</span><p>${text}</p></div>`;
}

function Tracks({ playlist }) {
  return html`<div class="card">
    <div class="card-head"><h3>${playlist.name}</h3>${playlist.description && html`<p class="muted">${playlist.description}</p>`}</div>
    <ol class="tracks">
      ${playlist.tracks.map((t, i) => html`<li>
        <div class="row1">
          <span class="n">${i + 1}</span>
          <div class="grow"><b>${t.title}</b>${t.artist && html` <span class="muted">· ${t.artist}</span>`}</div>
          ${t.duration_sec ? html`<span class="muted tab">${fmtSec(t.duration_sec)}</span>` : null}
        </div>
        ${(t.cue || t.trick) && html`<div class="cue">${t.cue}${t.cue && t.trick ? " · " : ""}${t.trick && html`<span class="muted">${t.trick}</span>`}</div>`}
        ${t.file_key && html`<audio controls preload="none" src=${mediaUrl(t.file_key)}></audio>`}
        ${t.url && html`<a class="btn" href=${linkHref(t.url)} target="_blank" rel="noopener noreferrer">Open link ↗</a>`}
      </li>`)}
    </ol>
  </div>`;
}

function Setlist({ s }) {
  const { ticks, toggle, clear } = useTicks();
  const [open, setOpen] = useState({});
  const total = s.items.reduce((n, i) => n + (i.duration_min || 0), 0);
  const packing = s.items.filter((i) => i.trick && (i.trick.props || i.trick.location));
  const gear = s.equipment || [];
  const packed = packing.filter((_, n) => ticks[`p${n}`]).length + gear.filter((_, n) => ticks[`g${n}`]).length;
  const toPack = packing.length + gear.length;
  return html`
    <header class="hero">
      <h1>${s.name}</h1>
      <p class="meta">${[s.event, s.venue].filter(Boolean).join(" · ")}</p>
      <p class="meta">${[fmtDate(s.date), total ? `${fmtMin(total)} total` : ""].filter(Boolean).join(" · ")}</p>
    </header>
    ${s.notes && html`<div class="card notes"><h3>Show notes</h3><p>${s.notes}</p></div>`}

    <section>
      <h2>Running order</h2>
      <ol class="order">
        ${s.items.map((i, n) => {
          const t = i.trick;
          const more = t && (t.props || t.reset || t.location || t.effect || t.images?.length);
          return html`<li class="card">
            <button class="row1" onClick=${() => more && setOpen({ ...open, [n]: !open[n] })} aria-expanded=${!!open[n]}>
              <span class="n">${n + 1}</span>
              <span class="grow"><b>${i.name}</b></span>
              ${i.duration_min ? html`<span class="muted tab">${i.duration_min}′</span>` : null}
              ${more && html`<span class="chev">${open[n] ? "▴" : "▾"}</span>`}
            </button>
            ${i.notes && html`<p class="spot">${i.notes}</p>`}
            ${open[n] && t && html`<div class="more">
              <${Detail} label="What they see" text=${t.effect} />
              <${Detail} label="Props" text=${t.props} />
              <${Detail} label="Reset" text=${t.reset} />
              <${Detail} label="Where it lives" text=${t.location} />
              <${Photos} keys=${t.images} />
            </div>`}
          </li>`;
        })}
      </ol>
    </section>

    ${toPack > 0 && html`<section>
      <div class="sec-head"><h2>Packing list</h2><span class="muted">${packed} of ${toPack}</span>
        ${packed > 0 && html`<button class="link" onClick=${clear}>Clear</button>`}</div>
      <div class="card">
        ${packing.map((i, n) => html`<label class=${`check ${ticks[`p${n}`] ? "done" : ""}`}>
          <input type="checkbox" checked=${!!ticks[`p${n}`]} onChange=${() => toggle(`p${n}`)} />
          <span><b>${i.name}</b>${i.trick.props && html`<br />${i.trick.props}`}${i.trick.location && html`<br /><span class="muted">From: ${i.trick.location}</span>`}</span>
        </label>`)}
        ${gear.map((g, n) => html`<label class=${`check ${ticks[`g${n}`] ? "done" : ""}`}>
          <input type="checkbox" checked=${!!ticks[`g${n}`]} onChange=${() => toggle(`g${n}`)} />
          <span><b>${g.name}${g.quantity > 1 ? ` ×${g.quantity}` : ""}</b>${g.make_model && html`<br />${g.make_model}`}${g.location && html`<br /><span class="muted">From: ${g.location}</span>`}</span>
        </label>`)}
      </div>
    </section>`}

    ${s.playlists.length > 0 && html`<section><h2>Music & cues</h2>${s.playlists.map((p) => html`<${Tracks} playlist=${p} />`)}</section>`}
  `;
}

function Trick({ t }) {
  return html`
    <header class="hero">
      <h1>${t.name}</h1>
      <p class="meta">${[t.category, fmtMin(t.duration_min)].filter(Boolean).join(" · ")}</p>
    </header>
    <${Photos} keys=${t.images} />
    <div class="card">
      <${Detail} label="What they see" text=${t.effect} />
      <${Detail} label="Props" text=${t.props} />
      <${Detail} label="Reset" text=${t.reset} />
      <${Detail} label="Where it lives" text=${t.location} />
    </div>`;
}

function Page() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    fetch(`/api/shared/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setState({ view: await r.json() }) : setState({ error: "This link has been turned off, or it isn't right." })))
      .catch(() => setState({ error: "Can't load this right now. Check your connection and try again." }));
  }, []);
  useEffect(() => {
    const name = state.view?.data?.name;
    if (name) document.title = `${name} · Jon Mobley`;
  }, [state.view]);

  let body = null;
  if (state.error) body = html`<div class="empty"><h1>Not available</h1><p>${state.error}</p></div>`;
  else if (state.view?.kind === "setlist") body = html`<${Setlist} s=${state.view.data} />`;
  else if (state.view?.kind === "playlist") body = html`<header class="hero"><h1>${state.view.data.name}</h1></header><${Tracks} playlist=${state.view.data} />`;
  else if (state.view?.kind === "trick") body = html`<${Trick} t=${state.view.data} />`;

  return html`<div class="wrap">
    <div class="top">
      <span class="badge">JM</span>
      <span class="muted">Shared by Jon Mobley · view only</span>
      <span class="grow"></span>
      ${state.view && html`<button class="btn" onClick=${() => print()}>Print</button>`}
    </div>
    ${body}
  </div>`;
}

render(html`<${Page} />`, document.getElementById("app"));
