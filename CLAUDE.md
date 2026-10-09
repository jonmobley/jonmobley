# jonmobley.com

Public site: plain HTML, CSS and JS, no build step. Plus **/backstage**: Jon's private, password-protected trick library (tricks, set lists, playlists, chat assistant), backed by Cloudflare Pages Functions + D1 + R2.

## About this app
@ABOUT-THIS-APP.md

## Run, build, test
- Run: `npm ci` once, then `npx wrangler pages dev .` (serves the site and runs `functions/`). Local data lives in `.wrangler/`; first time run `npx wrangler d1 migrations apply jonmobley-backstage --local` and `node scripts/set-password.mjs --local`.
- Chat locally: put `ANTHROPIC_API_KEY=...` in `.dev.vars` (gitignored). `ANTHROPIC_BASE_URL` there can point at a fake Claude server for tests.
- Build: none for the pages. Wrangler bundles `functions/` (and `server/`, which they import) at deploy, so `node_modules` must be installed (`npm ci`) before `wrangler pages deploy`.
- Typecheck: `npx tsc -p .` (functions + server).
- Test: `studio-test run` (Playwright, Chromium + WebKit). `studio-test shots / /booking/ ...` takes screenshots.

## Backstage (/backstage)
- `backstage/`: the app page (`index.html`, `app.js`, `app.css`). No build: Preact + htm vendored in `backstage/vendor/preact-htm.js`.
- `functions/api/[[path]].ts`: every `/api/*` route. `functions/_middleware.ts` + `_routes.json` 404 the repo's source files (`server/`, `wrangler.toml`, `package.json`, …) so they're never served.
- `server/`: `auth.ts` (one password, PBKDF2 hash + HMAC session cookie, both in the `settings` table; login rate limit), `data.ts` (tricks/set lists/playlists, cleaning rules, R2 uploads), `chat.ts` (Claude `claude-opus-5-5` with tools over the library; streams NDJSON; transcripts in R2 `chats/<id>.json`).
- Data: D1 `jonmobley-backstage` (binding `DB`, schema in `migrations/`), R2 `jonmobley-backstage` (binding `MEDIA`: `media/<uuid>.<ext>` uploads, `chats/`). Config in `wrangler.toml`.
- Secrets: `ANTHROPIC_API_KEY` (Pages secret, production + preview; source: `op://Moxie/newapp/LLM_API_KEY`). Reset the password: `node scripts/set-password.mjs --remote`.
- Writes need the `X-Backstage: 1` header (CSRF guard); everything but session/login needs the cookie.
- Tricks page: grid/list toggle (remembered per device), status chips + category and tag filters. Trick fields include price (`cost` column) and `purchase_url` (migration 0003); both private, never in share links.
- Sections (`SECTIONS` in app.js): Tricks, Equipment (`#/gear`, table `equipment`), Set lists, Playlists, Tasks (`tasks`, optional `setlist_id`), Notes (`notes`, autosave ~0.7s after typing; blank new notes are deleted on leave). Phones get a bottom bar + a Chat button; desktop has top tabs. Set lists carry `equipment` (ids to bring) and show their tasks. Migrations 0004 (tasks, notes) and 0005 (equipment + setlists.equipment).
- Samples: `backstage/demo.js` shows sample tricks/set list/playlist while a section is empty (browser only, never stored); "Add to my library" saves a copy via `adopt()`.
- Share links: `server/shares.ts` + table `shares` (migration 0002). `/share/<token>` (rewritten by `_redirects` to `share/index.html`, script `backstage/share.js`) shows a view-only copy; `/api/shared/<token>` serves it with no sign-in and only the files that item uses. Never include method, cost, source, notes or links of a trick in a shared view. Deleting an item deletes its link.
- Reordering (set lists, playlist tracks): `useReorder` in app.js uses pointer events on the handle (works with fingers; HTML5 drag doesn't on iPhone); rows fold to one line while dragging; up/down buttons remain.
- Phone layout: inputs are 16px under 900px wide (stops iPhone zoom); check with Safari's engine at iPhone 15 and SE sizes.

## Folders
- Each page is a folder with an `index.html`: `booking/`, `puzzle/`, `coloring-book/`, `locked/`, `seussical/`. The home page is `index.html` at the root.
- `css/` (`styles.css` for the site, `booking.css`, `player.css`), `js/` (`main.js`, `booking.js`), `images/` (includes the `og-*.jpg` share previews).
- Site-wide files at the root: `_headers`, `robots.txt`, `sitemap.xml`, `404.html`.
- New page: add its folder, a `sitemap.xml` entry and an og image.

## Don't touch
- `js/booking.js` origin checks and the `embedResize` name on the /booking iframe (they must match nxsportal).
- `_headers` security rules and the pages.dev noindex rule.
- Celebrity quotes, TV credits, the copyright line, and the phone/email in the JSON-LD block in `index.html`.
- `.wrangler/`, `.dev.vars`, `node_modules/`, `e2e/.auth/`, `test-results/` are local and not committed.
- Never run tests that write to the live Backstage database; e2e checks stay signed out.
- Never submit the real booking form from a test.

## Testing
Browser tests live in `e2e/` (`smoke.spec.ts`: one read-only check per page; `backstage.spec.ts`: signed-out checks of /backstage and the hidden source files; `auth.setup.ts`: no sign-in on this site, so it saves an empty session). Config is `playwright.config.ts`. `package.json` exists only for these tests. Embeds (Wistia, Bunny, nxsportal) are checked for presence, never played or submitted.
