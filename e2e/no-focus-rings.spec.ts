import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// The owner doesn't want focus rings anywhere. This reads the site's own CSS
// and pages (no browser needed) and fails if a :focus rule paints an outline,
// shadow or border again, or if the "outlines off" rule goes missing.

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", "test-results", "e2e", ".git"]);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(css|html)$/.test(name) ? [path] : [];
  });
}
const FOCUS_RULE = /([^{}]*:focus[^{}]*)\{([^}]*)\}/g;

test("no focus outlines, rings or borders", () => {
  const hits: string[] = [];
  for (const f of files(ROOT)) {
    const text = readFileSync(f, "utf8");
    // Pages: only what's inside their <style> tags is CSS.
    const css = f.endsWith(".html") ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join("\n") : text;
    for (const m of css.matchAll(FOCUS_RULE)) {
      const body = m[2]!;
      if (/outline(-color|-width|-offset)?\s*:(?!\s*none)/.test(body) || /box-shadow\s*:|border(-color)?\s*:/.test(body)) hits.push(`${f}: ${m[1]!.trim()}`);
    }
  }
  expect(hits).toEqual([]);
});

test("every stylesheet and inline page turns focus outlines off", () => {
  for (const f of ["css/styles.css", "css/booking.css", "css/player.css", "404.html", "locked/index.html", "seussical/index.html"]) {
    expect(readFileSync(join(ROOT, f), "utf8"), f).toMatch(/:focus,?\s*:focus-visible\s*\{\s*outline:\s*none !important;/);
  }
});
