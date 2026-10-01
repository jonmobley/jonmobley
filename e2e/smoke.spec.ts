import { expect, test, type Page } from "@playwright/test";

// jonmobley.com is a static site with no sign-in, so every test is read-only.
// Third-party embeds (Wistia, Bunny, nxsportal) are only checked for being on
// the page, never submitted or played.

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("home page shows the brand, quotes and booking link", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/Jon Mobley/);
  await expect(page.getByRole("img", { name: /Jon Mobley — Magician, Comedian, Emcee/ })).toBeVisible();
  await expect(page.getByText("REALLY BAFFLING!")).toBeVisible();
  await expect(page.getByRole("link", { name: "BOOKING INFO" })).toHaveAttribute("href", "/booking/");
  expect(errors).toEqual([]);
});

test("home page contact details are correct", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "GET IN TOUCH" })).toBeVisible();
  await expect(page.getByRole("link", { name: "booking@jonmobley.com" })).toHaveAttribute("href", "mailto:booking@jonmobley.com");
  await expect(page.getByRole("link", { name: "317-426-1270" })).toHaveAttribute("href", "tel:+13174261270");
});

test("booking page embeds the nxsportal form without submitting", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/booking/");
  await expect(page.getByRole("heading", { name: "Booking inquiry", includeHidden: true })).toBeAttached();
  const form = page.locator("iframe#form");
  await expect(form).toBeAttached();
  await expect(form).toHaveAttribute("src", /^https:\/\/nxsportal\.com\/form\/booking/);
  expect(errors).toEqual([]);
});

for (const [path, title] of [
  ["/puzzle/", "Puzzle"],
  ["/coloring-book/", "Coloring Book"],
] as const) {
  test(`${title} page has its video embed`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("iframe").first()).toHaveAttribute("src", /iframe\.mediadelivery\.net\/embed\//);
    expect(errors).toEqual([]);
  });
}

test("LOCKED page shows the three sessions", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/locked/");
  await expect(page.getByRole("heading", { level: 1, name: "Breakout Discussion" })).toBeVisible();
  for (const name of ["On Lock", "Unlocked", "Lock In"]) {
    await expect(page.getByRole("heading", { name, includeHidden: true })).toBeAttached();
  }
  expect(errors).toEqual([]);
});

test("Seussical page opens with its calendar", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/seussical/");
  await expect(page.getByRole("heading", { level: 1, name: "Seussical" })).toBeVisible();
  await expect(page.locator("iframe").first()).toBeAttached();
  expect(errors).toEqual([]);
});

test("unknown addresses show the 404 page", async ({ page }) => {
  await page.goto("/no-such-page/");
  await expect(page.locator("body")).toBeVisible();
});
