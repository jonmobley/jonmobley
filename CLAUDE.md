# jonmobley.com

Static site: plain HTML, CSS and JS. No framework, no build step, no database, no sign-in.

## About this app
@ABOUT-THIS-APP.md

## Run, build, test
- Run: serve the repo root with any static server, e.g. `npx wrangler pages dev .` (Studio shows its own preview).
- Build: none. The files in the repo are what gets published.
- Test: `studio-test run` (Playwright, Chromium + WebKit). `studio-test shots / /booking/ ...` takes screenshots.

## Folders
- Each page is a folder with an `index.html`: `booking/`, `puzzle/`, `coloring-book/`, `locked/`, `seussical/`. The home page is `index.html` at the root.
- `css/` (`styles.css` for the site, `booking.css`, `player.css`), `js/` (`main.js`, `booking.js`), `images/` (includes the `og-*.jpg` share previews).
- Site-wide files at the root: `_headers`, `robots.txt`, `sitemap.xml`, `404.html`.
- New page: add its folder, a `sitemap.xml` entry and an og image.

## Don't touch
- `js/booking.js` origin checks and the `embedResize` name on the /booking iframe (they must match nxsportal).
- `_headers` security rules and the pages.dev noindex rule.
- Celebrity quotes, TV credits, the copyright line, and the phone/email in the JSON-LD block in `index.html`.
- `.wrangler/`, `e2e/.auth/`, `test-results/` are local and not committed.
- Never submit the real booking form from a test.

## Testing
Browser tests live in `e2e/` (`smoke.spec.ts`: one read-only check per page; `auth.setup.ts`: no sign-in on this site, so it saves an empty session). Config is `playwright.config.ts`. `package.json` exists only for these tests. Embeds (Wistia, Bunny, nxsportal) are checked for presence, never played or submitted.
