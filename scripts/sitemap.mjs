// Builds sitemap.xml from the site's own folders, so a new page is listed the
// moment its folder (with an index.html) exists. Skips pages marked noindex and
// anything robots.txt disallows. lastmod = the page's last commit date.
//   node scripts/sitemap.mjs [outDir]   (deploy.sh runs it on every publish)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://jonmobley.com";
const root = new URL("..", import.meta.url).pathname;
const out = process.argv[2] ?? root;

const disallowed = readFileSync(join(root, "robots.txt"), "utf8")
  .split("\n")
  .filter((l) => /^disallow:/i.test(l.trim()))
  .map((l) => l.split(":")[1].trim())
  .filter(Boolean);

const pages = [""];
for (const d of readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith(".") || d.name === "node_modules") continue;
  if (existsSync(join(root, d.name, "index.html"))) pages.push(`${d.name}/`);
}

const lastmod = (file) => {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { cwd: root }).toString().trim();
  } catch {
    return "";
  }
};

const entries = pages
  .filter((p) => !disallowed.some((d) => `/${p}`.startsWith(d)))
  .filter((p) => !/<meta[^>]+noindex/i.test(readFileSync(join(root, p, "index.html"), "utf8")))
  .map((p) => {
    const date = lastmod(join(p, "index.html"));
    return `  <url>\n    <loc>${ORIGIN}/${p}</loc>${date ? `\n    <lastmod>${date}</lastmod>` : ""}\n  </url>`;
  });

writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`,
);
console.log(`sitemap: ${entries.length} pages`);
