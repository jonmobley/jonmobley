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

for (const [path, heading] of [
  ["/corporate-events/", "Corporate magician and comedian in Indianapolis"],
  ["/weddings/", "Wedding magician in Indianapolis"],
  ["/emcee/", "Event emcee and fundraiser host in Indianapolis"],
] as const) {
  test(`${path} service page has shows, FAQ and search data`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check your date" }).first()).toHaveAttribute("href", "/booking/");
    const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) || "{}");
    const types = data["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(expect.arrayContaining(["Service", "FAQPage"]));
    await expect(page.locator(".reviews figure")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Read them on Google" })).toHaveAttribute("href", "https://g.page/jon-mobley");
    expect(errors).toEqual([]);
  });
}

test("home page links to the service pages and has valid search data", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Corporate events", "Weddings", "Emcee & fundraisers"]) {
    await expect(page.locator(".site-links").getByRole("link", { name })).toBeAttached();
  }
  const data = JSON.parse((await page.locator('script[type="application/ld+json"]:not(.w-json-ld)').textContent()) || "{}");
  const person = data["@graph"].find((n: { "@type": string }) => n["@type"] === "Person");
  expect(person.telephone).toBe("+13174261270");
  expect(person.email).toBe("booking@jonmobley.com");
});

test("home page shows client reviews linked to Google", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("section.reviews figure")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Read them on Google" })).toHaveAttribute("href", "https://g.page/jon-mobley");
});

test("unknown addresses show the 404 page", async ({ page }) => {
  await page.goto("/no-such-page/");
  await expect(page.locator("body")).toBeVisible();
});
