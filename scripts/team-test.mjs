// Checks the team passcode limits against a LOCAL Backstage (it creates and deletes data).
// Usage: npx wrangler pages dev . --port 8788, set a local password, then
//   BACKSTAGE_PASSWORD=... node scripts/team-test.mjs [http://127.0.0.1:8788]
const BASE = process.argv[2] || "http://127.0.0.1:8788";
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) throw new Error("Local only: this test writes data.");
const OWNER_PW = process.env.BACKSTAGE_PASSWORD;
if (!OWNER_PW) throw new Error("Set BACKSTAGE_PASSWORD to the local owner password.");
let failures = 0;
const ok = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) failures++; };
function client() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const headers = { "X-Backstage": "1" };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const owner = client(), team = client(), team2 = client();
let r = await owner("login", { method: "POST", body: { password: OWNER_PW } });
ok(r.status === 200 && r.data.role === "owner", "owner signs in");
r = await owner("team-passcode", { method: "PUT", body: { passcode: "123" } });
ok(r.status === 400, "short passcode refused");
r = await owner("team-passcode", { method: "PUT", body: { passcode: OWNER_PW } });
ok(r.status === 400, "passcode can't be the owner password");
r = await owner("team-passcode", { method: "PUT", body: { passcode: "crew-2468" } });
ok(r.status === 200 && r.data.teamPasscodeSet, "owner turns on team access");
r = await owner("session");
ok(r.data.role === "owner" && r.data.teamPasscodeSet === true, "owner session says team access is on");

const trick = (await owner("tricks", { method: "POST", body: { name: "Test Rings", method: "SECRET-METHOD", cost: 99, source: "Dealer X", notes: "private", purchase_url: "https://example.com/buy", effect: "rings link" } })).data;
const gear = (await owner("equipment", { method: "POST", body: { name: "Test Mic", cost: 250, purchase_url: "https://example.com/mic" } })).data;
const note = (await owner("notes", { method: "POST", body: { title: "secret note" } })).data;

r = await team("login", { method: "POST", body: { password: "crew-2468" } });
ok(r.status === 200 && r.data.role === "team", "team member signs in with the passcode");
r = await team("session");
ok(r.data.role === "team" && r.data.teamPasscodeSet === undefined, "team session is marked team");
r = await team("tricks");
const seen = r.data.find((t) => t.id === trick.id);
ok(r.status === 200 && seen && seen.effect === "rings link", "team sees tricks");
ok(seen && !JSON.stringify(seen).match(/SECRET-METHOD|Dealer X|private|example\.com\/buy/) && seen.cost === null, "…without method, price, source, notes, purchase link");
r = await team(`tricks/${trick.id}`);
ok(!JSON.stringify(r.data).includes("SECRET-METHOD"), "single trick also hides the method");
r = await team(`tricks/${trick.id}`, { method: "PUT", body: { name: "changed" } });
ok(r.status === 403, "team can't edit tricks");
r = await team("tricks", { method: "POST", body: { name: "new" } });
ok(r.status === 403, "team can't add tricks");
r = await team(`tricks/${trick.id}`, { method: "DELETE" });
ok(r.status === 403, "team can't delete tricks");
r = await team(`equipment/${gear.id}`);
ok(r.data.cost === null && r.data.purchase_url === "", "team sees gear without prices");
r = await team(`equipment/${gear.id}`, { method: "PUT", body: { location: "Van", cost: 1 } });
ok(r.status === 200, "team can update gear");
r = await owner(`equipment/${gear.id}`);
ok(r.data.location === "Van" && r.data.cost === 250, "…and the price stays as Jon set it");
for (const s of ["notes", "files", "chats", "stats", "agent-settings"]) {
  r = await team(s);
  ok(r.status === 403, `team blocked from ${s}`);
}
r = await team(`notes/${note.id}`);
ok(r.status === 403, "team can't open a note by id");
r = await team("team-passcode", { method: "PUT", body: { passcode: "takeover99" } });
ok(r.status === 403, "team can't change the passcode");
r = await team("password", { method: "POST", body: { current: "x", next: "yyyyyyyyyyyy" } });
ok(r.status === 403, "team can't change Jon's password");
const task = await team("tasks", { method: "POST", body: { title: "Pack the van" } });
ok(task.status === 201, "team can add tasks");
r = await team(`tasks/${task.data.id}`, { method: "PUT", body: { done: true } });
ok(r.status === 200 && r.data.done, "team can tick off tasks");
const set = await team("setlists", { method: "POST", body: { name: "Team set", items: [{ trick_id: trick.id }] } });
ok(set.status === 201, "team can build set lists");

r = await team2("login", { method: "POST", body: { password: "crew-2468" } });
r = await owner("team-passcode", { method: "PUT", body: { passcode: "crew-1357" } });
r = await team2("tasks");
ok(r.status === 401, "changing the passcode signs out team devices");
r = await team2("login", { method: "POST", body: { password: "crew-1357" } });
ok(r.status === 200, "new passcode works");
r = await owner("team-passcode", { method: "DELETE" });
r = await team2("tasks");
ok(r.status === 401, "turning team access off signs them out");
r = await team2("login", { method: "POST", body: { password: "crew-1357" } });
ok(r.status === 401, "old passcode no longer works");
r = await owner("tricks");
ok(r.status === 200, "owner still signed in");

// clean up
await owner(`tricks/${trick.id}`, { method: "DELETE" });
await owner(`equipment/${gear.id}`, { method: "DELETE" });
await owner(`notes/${note.id}`, { method: "DELETE" });
await owner(`tasks/${task.data.id}`, { method: "DELETE" });
await owner(`setlists/${set.data.id}`, { method: "DELETE" });
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
