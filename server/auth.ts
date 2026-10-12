// Sign-in for /backstage: Jon's password, or an optional team passcode for an assistant
// (see "Team" below: team members get a limited view, enforced in functions/api).
// The password is stored as a PBKDF2 hash in the settings table; a signed,
// HttpOnly cookie keeps the session for 30 days.
import type { Env } from "./env";

const COOKIE = "bs_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000; // Workers' maximum
const MAX_FAILURES = 8; // per IP per 15 minutes
const WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${toHex(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltHex || !hashHex) return false;
  const hash = await pbkdf2(password, fromHex(saltHex), Number(iter));
  return sameBytes(new Uint8Array(hash), fromHex(hashHex));
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

// The signing key lives in the database so no extra secret has to be set up.
// Changing the password rotates it, which signs out every other device.
async function sessionKey(env: Env): Promise<CryptoKey> {
  let secret = await getSetting(env, "session_secret");
  if (!secret) {
    secret = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)").bind(secret).run();
    secret = (await getSetting(env, "session_secret"))!;
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(env: Env, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await sessionKey(env), enc.encode(payload));
  return toHex(sig);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export type Role = "owner" | "team";

/** Who is signed in: the owner, a team member, or nobody. */
export async function currentRole(request: Request, env: Env): Promise<Role | null> {
  const value = readCookie(request, COOKIE);
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length === 2) {
    const [exp, sig] = parts;
    if (!exp || !sig || Number(exp) < Date.now()) return null;
    return sameBytes(enc.encode(sig), enc.encode(await sign(env, `session.${exp}`))) ? "owner" : null;
  }
  if (parts.length === 3 && parts[0] === "t") {
    const [, exp, sig] = parts;
    const teamSecret = await getSetting(env, "team_secret");
    if (!teamSecret || !exp || !sig || Number(exp) < Date.now()) return null;
    return sameBytes(enc.encode(sig), enc.encode(await sign(env, `team.${exp}.${teamSecret}`))) ? "team" : null;
  }
  return null;
}

export async function isSignedIn(request: Request, env: Env): Promise<boolean> {
  return (await currentRole(request, env)) !== null;
}

async function teamCookie(env: Env): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const sig = await sign(env, `team.${exp}.${await getSetting(env, "team_secret")}`);
  return `${COOKIE}=t.${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

async function sessionCookie(env: Env): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const sig = await sign(env, `session.${exp}`);
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function hasPassword(env: Env): Promise<boolean> {
  return (await getSetting(env, "password_hash")) !== null;
}

/** Accepts Jon's password or the team passcode. Returns a Set-Cookie header and role, or an error message. */
export async function login(request: Request, env: Env, password: string): Promise<{ cookie: string; role: Role } | { error: string; status: number }> {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const since = Date.now() - WINDOW_MS;
  await env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since).run();
  // Record the attempt before checking, so parallel guesses all count.
  await env.DB.prepare("INSERT INTO login_attempts (ip, at) VALUES (?, ?)").bind(ip, Date.now()).run();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?").bind(ip).first<{ n: number }>();
  if ((recent?.n ?? 0) > MAX_FAILURES) {
    return { error: "Too many tries. Wait 15 minutes and try again.", status: 429 };
  }
  const stored = await getSetting(env, "password_hash");
  if (stored && (await verifyPassword(password, stored))) {
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
    return { cookie: await sessionCookie(env), role: "owner" };
  }
  const team = await getSetting(env, "team_passcode_hash");
  if (team && (await verifyPassword(password, team))) {
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
    return { cookie: await teamCookie(env), role: "team" };
  }
  return { error: "That password didn't work.", status: 401 };
}

/** Changes the password, signs out other devices, and returns a fresh cookie for this one. */
export async function changePassword(env: Env, current: string, next: string): Promise<{ cookie: string } | { error: string }> {
  const stored = await getSetting(env, "password_hash");
  if (!stored || !(await verifyPassword(current, stored))) return { error: "Your current password didn't match." };
  if (next.length < 10) return { error: "Use at least 10 characters." };
  await setSetting(env, "password_hash", await hashPassword(next));
  await setSetting(env, "session_secret", toHex(crypto.getRandomValues(new Uint8Array(32)).buffer));
  return { cookie: await sessionCookie(env) };
}

// ---------- Team ----------
// One shared passcode for an assistant or crew. Setting, changing or removing it signs
// out every team device (the team_secret that signs their cookies is replaced).

export const MIN_PASSCODE = 6;

export async function hasTeamPasscode(env: Env): Promise<boolean> {
  return (await getSetting(env, "team_passcode_hash")) !== null;
}

/** Sets the team passcode, or removes it (null). Owner only. */
export async function setTeamPasscode(env: Env, passcode: string | null): Promise<{ ok: true } | { error: string }> {
  if (passcode === null) {
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('team_passcode_hash', 'team_secret')").run();
    return { ok: true };
  }
  if (passcode.length < MIN_PASSCODE) return { error: `Use at least ${MIN_PASSCODE} characters.` };
  if (passcode.length > 100) return { error: "That passcode is too long." };
  const owner = await getSetting(env, "password_hash");
  if (owner && (await verifyPassword(passcode, owner))) return { error: "Use something different from your own password." };
  await setSetting(env, "team_passcode_hash", await hashPassword(passcode));
  await setSetting(env, "team_secret", toHex(crypto.getRandomValues(new Uint8Array(32)).buffer));
  return { ok: true };
}
