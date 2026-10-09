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

test("source files are not served", async ({ request }) => {
  for (const path of ["/wrangler.toml", "/server/auth.ts", "/functions/_middleware.ts", "/migrations/0001_backstage.sql", "/package.json"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
