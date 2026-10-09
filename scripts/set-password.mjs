// Sets (or resets) the Backstage sign-in password and signs out every device.
//   node scripts/set-password.mjs --local            (local preview database)
//   node scripts/set-password.mjs --remote           (the live site)
// Type the password when asked, or pass it in BACKSTAGE_PASSWORD.
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { webcrypto as crypto } from "node:crypto";

const where = process.argv.includes("--remote") ? "--remote" : process.argv.includes("--local") ? "--local" : null;
if (!where) {
  console.error("Say where: --local or --remote");
  process.exit(1);
}
let password = process.env.BACKSTAGE_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("New Backstage password (10+ characters): ");
  rl.close();
}
if (!password || password.length < 10) {
  console.error("Use at least 10 characters.");
  process.exit(1);
}

const hex = (buf) => Buffer.from(buf).toString("hex");
const iterations = 100000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
const stored = `pbkdf2$${iterations}$${hex(salt)}$${hex(hash)}`;
const secret = hex(crypto.getRandomValues(new Uint8Array(32)));

const sql =
  `INSERT INTO settings (key, value) VALUES ('password_hash', '${stored}') ON CONFLICT(key) DO UPDATE SET value = excluded.value; ` +
  `INSERT INTO settings (key, value) VALUES ('session_secret', '${secret}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`;
execFileSync("npx", ["wrangler", "d1", "execute", "jonmobley-backstage", where, "--command", sql], { stdio: ["ignore", "ignore", "inherit"] });
console.log(`Password set (${where.slice(2)}).`);
