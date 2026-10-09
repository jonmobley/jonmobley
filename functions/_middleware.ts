// Every page request passes through here (see _routes.json), for two jobs:
// 1. Never serve the repo's source files. They aren't uploaded at all (scripts/deploy.sh
//    leaves them out); this check is a backstop.
// 2. Count page views for Backstage → Stats (people, AI assistants, crawlers). Counting
//    happens after the page is sent and can never break or slow a page.
import type { Env } from "../server/env";
import { normalizePath, record } from "../server/stats";

const HIDDEN = [
  "/functions/", "/server/", "/migrations/", "/scripts/", "/e2e/", "/node_modules/", "/test-results/", "/playwright-report/",
];
const HIDDEN_FILES = new Set([
  "/wrangler.toml", "/tsconfig.json", "/package.json", "/package-lock.json", "/playwright.config.ts", "/_routes.json",
  "/.dev.vars", "/.gitignore", "/claude.md", "/about-this-app.md",
]);

export const onRequest: PagesFunction<Env> = async ({ request, next, env, waitUntil }) => {
  const url = new URL(request.url);
  const path = url.pathname;
  // Compare the decoded, tidied address so tricks like /%73erver/ or //server/ can't slip by.
  let lower = path;
  try {
    lower = decodeURIComponent(path);
  } catch {}
  lower = lower.toLowerCase().replace(/\/{2,}/g, "/");
  if (HIDDEN.some((p) => lower.startsWith(p) || lower === p.slice(0, -1)) || HIDDEN_FILES.has(lower)) {
    return new Response("Not found", { status: 404 });
  }
  if (path === "/api" || path.startsWith("/api/") || path === "/mcp") return next();

  const res = await next();
  const prefetch = /prefetch|prerender/i.test(request.headers.get("Sec-Purpose") || request.headers.get("Purpose") || "");
  const type = res.headers.get("Content-Type") || "";
  if (request.method === "GET" && res.status === 200 && !prefetch && (type.includes("text/html") || lower === "/llms.txt")) {
    waitUntil(record(env, request, normalizePath(path)));
  }
  return res;
};
