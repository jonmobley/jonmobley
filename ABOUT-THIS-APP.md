# About this app

## What it does
jonmobley.com: the website for Jon Mobley, a magician, comedian and emcee based in Indianapolis. It's a set of plain web pages with no build step:
- **Home (/)**: hero with logo and video, celebrity quotes (Penn Jillette, Michael Strahan, Drew Brees), an "as seen on" row (Penn & Teller: Fool Us, The CW, Chicago Magic Lounge), and contact tiles.
- **/booking**: the booking request form, an nxsportal form shown inside our own page.
- **/puzzle** and **/coloring-book**: videos that reveal the secret of a trick (Bunny video).
- **/locked**: youth breakout discussion guide for the LOCKED keynote series on Romans 8.
- **/seussical**: rehearsal and performance calendar for a Seussical production.

## Who it's for
Event planners booking a show (corporate events, private parties), plus audience members sent to a specific page after a show or talk (trick reveals, LOCKED, Seussical cast).

## Brand
Colors (from `css/styles.css`):
- `#000000` black: main page background, video frames, theme color.
- `#FFFFFF` white: main text on black.
- `#C9A669` gold: the "|" dividers in "MAGICIAN | COMEDIAN | EMCEE".
- `#FFCF60` warm yellow: the big celebrity quotes.
- `#469AE1` blue: "BOOKING INFO" button (`#2B72AE` on hover) and focus outlines.
- `#FCFCFC` off-white: "Get in touch" section background; `#444` / `#666` grey for muted text.
- Contact tiles: red tint `#E21C21`, navy-blue tint `#045184`, light grey `#F0F0F0`.

Fonts (Google Fonts): Montserrat (main text), Raleway (booking button, contact section), Cinzel (quotes), League Spartan ("as seen on"), Great Vibes (the script "Chicago Magic Lounge" title).

Voice: short, confident and playful. Labels are in all caps ("BOOKING INFO", "GET IN TOUCH"). The copy leans on proof from others (TV credits, celebrity reactions) more than self-praise. Tagline: "Laugh and Be Amazed."

## Key decisions
- Plain HTML/CSS/JS only. No framework, no build step, no database.
- Hosted on Cloudflare Pages (guess — please confirm). `_headers` sets security and caching rules; `*.pages.dev` preview addresses are hidden from Google.
- Bookings go through the nxsportal form embedded on /booking. We don't run our own form or store visitor data.
- No sign-in and no payments on the site.
- Contact details used across the site: booking@jonmobley.com, 317-426-1270, Facebook/Instagram @mobleymagic, YouTube @jonmobley.
- The home video uses Wistia; trick-reveal videos use Bunny (iframe.mediadelivery.net).
- The Chicago Magic Lounge feature is a still image, not a video (the owner chose this).
- /booking is black with a centered logo and no header contact links.
- Every page has its own share preview image (og-*.jpg) and is listed in `sitemap.xml`.

## Never touch
- `js/booking.js` message checks (only trusts nxsportal.com) and the `embedResize` name on the /booking iframe. They must match or the form won't size itself.
- `_headers` security rules and the pages.dev "noindex" line.
- The copyright line with "Mobley Productions LLC", plus the phone/email in the page's hidden search-engine data (the JSON-LD block in `index.html`).
- Celebrity quotes and TV credits: keep them word-for-word.

## Notes
- New pages go in their own folder with an `index.html` (e.g. `/puzzle/index.html`), plus an entry in `sitemap.xml` and an og image.
- Cache rules: images are cached for a year, CSS/JS for a week. If you replace an image, give it a new file name.
