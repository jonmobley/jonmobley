// Tells Bing (and other IndexNow search engines) which public pages exist or changed.
// Bing powers ChatGPT search and Copilot, so this helps AI answers stay current.
// Run after a deploy that adds or changes pages:  node scripts/indexnow.mjs
// The key file /dce0846fe85a387e6005e0425d05f5c4.txt is public on purpose: it proves we own the site.
const KEY = "dce0846fe85a387e6005e0425d05f5c4";
const HOST = "jonmobley.com";
const sitemap = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});
console.log(`IndexNow: ${res.status} for ${urlList.length} pages`);
if (!res.ok && res.status !== 202) process.exit(1);
