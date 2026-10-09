// Sample content shown while a section of Backstage is still empty. Never stored in the
// database: it disappears as soon as Jon adds his own, and the chat never sees it.
// Opening a sample and pressing "Add to my library" saves a real copy (see adopt()).

const t0 = Date.parse("2026-10-01T12:00:00Z");
const METHOD = "Private notes on how it works go here. Only you can see this field.";

export const DEMO_TRICKS = [
  {
    id: "demo-rings", emoji: "⭕", name: "Linking Rings", category: "stage", status: "ready",
    effect: "Solid steel rings link and unlink in the hands of a spectator, ending in a chain held high.",
    props: "8-ring set, ring bag", reset: "Rings back in order in the bag. Check the bag clasp.",
    duration_min: 6, location: "Stage case, left side", source: "", cost: null,
    audiences: ["family", "corporate"], tags: ["closer", "audience volunteer"],
  },
  {
    id: "demo-invisible", emoji: "🂠", name: "Invisible Deck", category: "parlor", status: "ready",
    effect: "A spectator names any card. The one reversed card in the deck turns out to be theirs.",
    props: "Invisible Deck, case", reset: "Square up and back in the case.",
    duration_min: 4, location: "Close-up bag", source: "", cost: null,
    audiences: ["corporate", "adults"], tags: ["cards", "mentalism"],
  },
  {
    id: "demo-cups", emoji: "🥤", name: "Cups and Balls", category: "close-up", status: "ready",
    effect: "Balls jump between three cups, then the cups are lifted to reveal lemons.",
    props: "3 cups, 4 balls, 3 final loads, wand", reset: "Loads in the right pocket, balls in the coin purse.",
    duration_min: 7, location: "Close-up bag", source: "", cost: null,
    audiences: ["family", "adults"], tags: ["classic", "table"],
  },
  {
    id: "demo-ring-spring", emoji: "💍", name: "Ring and Spring", category: "close-up", status: "ready",
    effect: "A borrowed ring vanishes and appears trapped on a spring.",
    props: "Spring, envelope", reset: "Envelope sealed, spring in its sleeve.",
    duration_min: 4, location: "Close-up bag", source: "", cost: null,
    audiences: ["corporate", "adults"], tags: ["borrowed object", "opener"],
  },
  {
    id: "demo-coloring", emoji: "🖍️", name: "Coloring Book", category: "kids", status: "ready",
    effect: "A blank coloring book fills with pictures, then the colors appear, then it goes blank again.",
    props: "Coloring book", reset: "Pages back to blank.",
    duration_min: 4, location: "Kids case", source: "", cost: null,
    audiences: ["kids", "family"], tags: ["kids", "comedy"],
  },
  {
    id: "demo-zombie", emoji: "🔮", name: "Zombie Ball", category: "stage", status: "learning",
    effect: "A silver ball floats around a cloth, behind it and over its edge.",
    props: "Zombie ball, foulard", reset: "Fold the foulard over the ball.",
    duration_min: 5, location: "Stage case", source: "", cost: null,
    audiences: ["family"], tags: ["music piece", "silent"],
  },
  {
    id: "demo-snowstorm", emoji: "❄️", name: "Snowstorm in China", category: "stage", status: "wishlist",
    effect: "Torn tissue paper becomes a blizzard of snow blown over the audience.",
    props: "Tissue, fan, refills", reset: "",
    duration_min: 4, location: "", source: "Magic shop", cost: 45,
    audiences: ["family", "corporate"], tags: ["closer", "holiday"],
  },
].map((t) => ({
  method: METHOD, purchase_url: "", links: [], images: [], notes: "", created_at: t0, updated_at: t0, demo: true, ...t,
}));

export const DEMO_SETLISTS = [
  {
    id: "demo-set", name: "Holiday party set", event: "Acme Co. holiday party", venue: "Hotel ballroom",
    date: "2026-12-12", notes: "Wireless mic. Stage left for the case. Contact: event planner on site.",
    items: [
      { id: "demo-i1", title: "Walk-on + intro", duration_min: 2 },
      { id: "demo-i2", trick_id: "demo-ring-spring", notes: "Borrow a ring from the front row." },
      { id: "demo-i3", trick_id: "demo-invisible" },
      { id: "demo-i4", trick_id: "demo-cups", duration_min: 6 },
      { id: "demo-i5", trick_id: "demo-coloring", notes: "Bring up a kid from a family table." },
      { id: "demo-i6", trick_id: "demo-rings", notes: "Closer. Big music cue." },
      { id: "demo-i7", title: "Thank you + bow", duration_min: 1 },
    ],
    created_at: t0, updated_at: t0, demo: true,
  },
];

export const DEMO_PLAYLISTS = [
  {
    id: "demo-playlist", name: "Walk-on & cues", description: "Music for the holiday party set",
    setlist_id: "demo-set",
    tracks: [
      { id: "demo-t1", title: "Walk-on music", artist: "", duration_sec: 45, cue: "House lights down, on the intro" },
      { id: "demo-t2", title: "Rings music", artist: "", duration_sec: 240, cue: "Linking Rings, start when the bag opens" },
      { id: "demo-t3", title: "Bow music", artist: "", duration_sec: 60, cue: "Final bow, play out" },
    ],
    created_at: t0, updated_at: t0, demo: true,
  },
];

const demoTrick = (id) => DEMO_TRICKS.find((t) => t.id === id);
const fresh = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

/** Turns a (possibly edited) sample into a real record to save. Links to other samples become plain text. */
export function adopt(kind, draft) {
  const { id, demo, emoji, created_at, updated_at, ...rest } = draft;
  if (kind === "tricks" && rest.method === METHOD) rest.method = "";
  if (kind === "setlists") {
    rest.items = rest.items.map((i) => {
      const t = i.trick_id && i.trick_id.startsWith("demo-") ? demoTrick(i.trick_id) : null;
      const item = { ...i, id: fresh() };
      if (t) {
        delete item.trick_id;
        item.title = t.name;
        item.duration_min = i.duration_min ?? t.duration_min;
      }
      return item;
    });
  }
  if (kind === "playlists") {
    if (rest.setlist_id && rest.setlist_id.startsWith("demo-")) rest.setlist_id = null;
    rest.tracks = rest.tracks.map(({ trick_id, ...t }) => ({
      ...t,
      id: fresh(),
      ...(trick_id && !trick_id.startsWith("demo-") ? { trick_id } : {}),
    }));
  }
  return rest;
}
