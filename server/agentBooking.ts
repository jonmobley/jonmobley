// The public "front door" that lets AI agents book Jon. The real work happens in Nexus
// (Jon's booking system): this file only passes requests through to Nexus's agent API and
// describes it as MCP tools. Nothing here touches the /booking page or its form.
import type { Env } from "./env";

const DEFAULT_NEXUS = "https://nxsportal.com/api/agent/booking";
const TIMEOUT_MS = 20_000;

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

type Json = Record<string, unknown>;

/** Calls Nexus's agent API. Returns its status and JSON body (or a friendly error). */
export async function nexus(env: Env, path: string, init?: { method?: string; body?: unknown; query?: Record<string, string>; key?: string }) {
  const base = (env.NEXUS_AGENT_URL || DEFAULT_NEXUS).replace(/\/+$/, "");
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(init?.query || {})) if (v) url.searchParams.set(k, v);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init?.method || "GET",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.key ? { Authorization: `Bearer ${init.key}` } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: "Jon's booking system sent an unexpected reply." };
    }
    return { status: res.status, body };
  } catch {
    return { status: 503, body: { error: "Jon's booking system can't be reached right now. Please try again shortly, or use https://jonmobley.com/booking/." } };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Owner settings: Backstage → AI booking ----------

/** Reads (GET) or changes (PUT) Jon's AI booking settings in Nexus. Signed-in Backstage only. */
export async function ownerSettings(env: Env, method: "GET" | "PUT", body?: unknown) {
  if (!env.NEXUS_AGENT_ADMIN_KEY) return { status: 503, body: { error: "AI booking settings aren't connected to Nexus yet." } };
  const res = await nexus(env, "/owner/settings", { method, body, key: env.NEXUS_AGENT_ADMIN_KEY });
  if (res.status === 404) return { status: 502, body: { error: "Nexus didn't accept Backstage's settings key." } };
  return res;
}

// ---------- REST pass-through: /api/agent/... ----------

/** Handles /api/agent/* (parts after "agent"). Public, no sign-in. */
export async function agentRest(request: Request, env: Env, parts: string[]): Promise<Response> {
  const respond = (status: number, body: unknown) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const [first, second] = parts;
  let out: { status: number; body: unknown };
  if (!first && request.method === "GET") out = await nexus(env, "");
  else if (first === "availability" && request.method === "GET") {
    out = await nexus(env, "/availability", { query: { from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" } });
  } else if ((first === "quote" || first === "book") && request.method === "POST") {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      return respond(400, { error: "Send a JSON body." });
    }
    out = await nexus(env, `/${first}`, { method: "POST", body });
  } else if (first === "bookings" && second && request.method === "GET") {
    out = await nexus(env, `/bookings/${encodeURIComponent(second)}`, { query: { email: url.searchParams.get("email") || "" } });
  } else {
    return respond(404, { error: "Not found. Start at GET https://jonmobley.com/api/agent — see https://jonmobley.com/agents/" });
  }
  return respond(out.status, out.body);
}

// ---------- MCP (Model Context Protocol) over Streamable HTTP, stateless ----------

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "jon-mobley-booking", title: "Book Jon Mobley (magician, comedian, emcee)", version: "1.0.0" };
const INSTRUCTIONS = `Book Jon Mobley — magician, comedian and emcee from Indianapolis (Penn & Teller: Fool Us, The CW) — for an event.
Steps: 1) get_offer to see shows, add-ons, prices and policies. 2) check_availability for the event date(s). 3) get_quote with the chosen show, add-ons, date and start time. 4) Confirm the details and price with your user, then book with the quote_id and the client's contact details. 5) Book holds the date and sends the request to Jon to approve (status pending_approval). Once he approves, the client is emailed a link to sign the agreement and pay the deposit; the booking confirms automatically when the deposit is paid. Tell your user to watch their email. Never book without your user's explicit approval of the date, show and price.`;

const dateProp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD (the event's local date)" };
const TOOLS = [
  {
    name: "get_offer",
    title: "Shows, prices and policies",
    description: "What Jon offers: shows/packages with prices and lengths, add-ons, event types, deposit and hold policy, and how booking works. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "check_availability",
    title: "Check open dates",
    description: "Which dates are available, limited (some commitments that day — quote with a start time to check) or unavailable. Up to 92 days per call.",
    inputSchema: { type: "object", properties: { from: dateProp, to: dateProp }, required: ["from", "to"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_quote",
    title: "Get an exact quote",
    description: "Exact price for a show (package) plus add-ons on a date and start time, and whether that time is free. Returns a quote_id that is valid for 24 hours and needed to book.",
    inputSchema: {
      type: "object",
      properties: {
        package_id: { type: "integer", description: "From get_offer" },
        addon_ids: { type: "array", items: { type: "integer" }, description: "Optional add-on ids from get_offer" },
        date: dateProp,
        start_time: { type: "string", pattern: "^\\d{2}:\\d{2}$", description: "24-hour local start time, e.g. 19:30" },
        guest_count: { type: "integer", minimum: 1 },
        event_type: { type: "string", description: "One of eventTypes from get_offer" },
        venue_address: { type: "string" },
      },
      required: ["package_id", "date", "start_time"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "book",
    title: "Hold the date and book",
    description: "Books Jon using a quote_id. Only call after your user approved the show, date, time and price. Holds the date and sends the request to Jon to approve. Once approved, the client is emailed a link to sign the agreement and pay the deposit, which confirms the booking automatically. Returns a booking reference and status.",
    inputSchema: {
      type: "object",
      properties: {
        quote_id: { type: "string" },
        client_name: { type: "string" },
        client_email: { type: "string", format: "email" },
        client_phone: { type: "string" },
        company: { type: "string" },
        event_title: { type: "string" },
        event_type: { type: "string" },
        venue_name: { type: "string" },
        venue_address: { type: "string" },
        guest_count: { type: "integer", minimum: 1 },
        notes: { type: "string", description: "Anything Jon should know (audience, schedule, special requests)" },
        agent_name: { type: "string", description: "Your name/product (e.g. 'ChatGPT', 'Claude')" },
        idempotency_key: { type: "string", description: "Any unique string; retrying with the same key never double-books" },
      },
      required: ["quote_id", "client_name", "client_email", "client_phone", "venue_address", "idempotency_key"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "booking_status",
    title: "Check a booking",
    description: "Status of a booking made with book: pending_approval, held (approved, waiting for the deposit), confirmed, expired or cancelled.",
    inputSchema: {
      type: "object",
      properties: { booking_ref: { type: "string" }, client_email: { type: "string", format: "email" } },
      required: ["booking_ref", "client_email"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? undefined : String(v));

async function callTool(env: Env, name: string, a: Json): Promise<{ status: number; body: unknown }> {
  switch (name) {
    case "get_offer":
      return nexus(env, "");
    case "check_availability":
      return nexus(env, "/availability", { query: { from: s(a.from) || "", to: s(a.to) || "" } });
    case "get_quote":
      return nexus(env, "/quote", {
        method: "POST",
        body: {
          packageId: a.package_id, addonIds: a.addon_ids, date: a.date, startTime: a.start_time,
          guestCount: a.guest_count, eventType: a.event_type, venueAddress: a.venue_address,
        },
      });
    case "book":
      return nexus(env, "/book", {
        method: "POST",
        body: {
          quoteId: a.quote_id,
          idempotencyKey: a.idempotency_key,
          client: { name: a.client_name, email: a.client_email, phone: a.client_phone, company: a.company },
          event: {
            title: a.event_title, type: a.event_type, venueName: a.venue_name, venueAddress: a.venue_address,
            guestCount: a.guest_count, notes: a.notes,
          },
          agent: { name: a.agent_name },
        },
      });
    case "booking_status":
      return nexus(env, `/bookings/${encodeURIComponent(s(a.booking_ref) || "")}`, { query: { email: s(a.client_email) || "" } });
    default:
      return { status: 404, body: { error: `Unknown tool ${name}` } };
  }
}

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

async function handleRpc(env: Env, msg: RpcRequest): Promise<Json | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(-32600, "Invalid request");
  switch (msg.method) {
    case "initialize": {
      const asked = s((msg.params || {}).protocolVersion);
      return ok({
        protocolVersion: asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const p = msg.params || {};
      const name = s(p.name) || "";
      if (!TOOLS.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      const out = await callTool(env, name, (p.arguments as Json) || {});
      const failed = out.status >= 400;
      return ok({
        content: [{ type: "text", text: JSON.stringify(out.body, null, 2) }],
        structuredContent: typeof out.body === "object" && out.body && !Array.isArray(out.body) ? out.body : { result: out.body },
        isError: failed,
      });
    }
    default:
      if (isNotification) return null; // e.g. notifications/initialized
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

/** POST /mcp: one JSON-RPC message (or a batch). Stateless; answers with plain JSON. */
export async function mcp(request: Request, env: Env): Promise<Response> {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET") {
    // No server-initiated stream; describe ourselves for anyone browsing.
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("text/event-stream")) return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
    return new Response(JSON.stringify({ ...SERVER_INFO, transport: "streamable-http", endpoint: "https://jonmobley.com/mcp", docs: "https://jonmobley.com/agents/" }, null, 2), { headers });
  }
  if (request.method === "DELETE") return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST", ...CORS } });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers });
  }
  if (Array.isArray(payload)) {
    const replies = (await Promise.all(payload.slice(0, 20).map((m) => handleRpc(env, m as RpcRequest)))).filter(Boolean);
    return replies.length ? new Response(JSON.stringify(replies), { headers }) : new Response(null, { status: 202, headers: CORS });
  }
  const reply = await handleRpc(env, payload as RpcRequest);
  return reply ? new Response(JSON.stringify(reply), { headers }) : new Response(null, { status: 202, headers: CORS });
}
