import { expect, test } from "@playwright/test";

// /backstage is Jon's private trick library. These checks stay signed out, so they
// never touch his data: the sign-in screen shows, the API refuses strangers, and
// the site's source files are never served.

test("backstage shows the sign-in screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/backstage/");
  await expect(page.getByRole("heading", { name: "Backstage" })).toBeVisible();
  await expect(page.getByLabel("PASSWORD")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(errors).toEqual([]);
});

test("backstage data needs a sign-in", async ({ request }) => {
  for (const path of ["/api/tricks", "/api/setlists", "/api/playlists", "/api/chats"]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  // Writes without the page's own header are refused before anything else.
  expect((await request.post("/api/login", { data: { password: "x" } })).status()).toBe(403);
});

test("source files are not served, even with encoded addresses", async ({ request }) => {
  for (const path of ["/%73erver/data.ts", "/server%2Fdata.ts", "/%77rangler.toml", "/%70ackage.json", "/functions%2F_middleware.ts", "/%43LAUDE.md"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("source files are not served", async ({ request }) => {
  for (const path of ["/wrangler.toml", "/server/auth.ts", "/functions/_middleware.ts", "/migrations/0001_backstage.sql", "/package.json", "/.dev.vars", "/CLAUDE.md", "/test-results/.last-run.json"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("a share link that doesn't exist says so", async ({ page, request }) => {
  expect((await request.get("/api/shared/AAAAAAAAAAAAAAAAAAAAAAAA")).status()).toBe(404);
  expect((await request.get("/api/shares/setlist/x")).status()).toBe(401);
  await page.goto("/share/AAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("stats need a sign-in", async ({ request }) => {
  expect((await request.get("/api/stats?days=30")).status()).toBe(401);
});
