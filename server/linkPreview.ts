// Thumbnails for Backstage → Links. Captured once per link and copied into our own
// storage (R2), so the Links page never depends on the other site afterwards.
// 1. A screenshot of the page (Microlink's free screenshot API — it sees only the link).
// 2. Otherwise the page's own preview image (og:image).
// 3. Otherwise the site's icon. 4. Otherwise nothing (the page shows a letter tile).
import type { Env } from "./env";
import { newId } from "./data";

const UA = "Mozilla/5.0 (compatible; JonMobleyBackstage/1.0; link preview; +https://jonmobley.com/agents/)";
const MAX_IMAGE = 3 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Downloads an image (http/https only, image types only, size-capped) into R2. */
async function storeImage(env: Env, url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const res = await fetchWithTimeout(url, 15000, { headers: { "User-Agent": UA, Accept: "image/*" } });
  if (!res || !res.ok) return null;
  const type = (res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 200 || buf.byteLength > MAX_IMAGE) return null;
  const key = `media/${newId()}.${ext}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { name: "link-thumbnail" } });
  return key;
}

async function screenshot(env: Env, url: string): Promise<string | null> {
  const api = new URL("https://api.microlink.io/");
  api.searchParams.set("url", url);
  api.searchParams.set("screenshot", "true");
  api.searchParams.set("meta", "true");
  api.searchParams.set("waitForTimeout", "2500"); // let fonts and the hero section appear
  api.searchParams.set("viewport.width", "1280");
  api.searchParams.set("viewport.height", "800");
  api.searchParams.set("viewport.deviceScaleFactor", "1");
  const res = await fetchWithTimeout(api.toString(), 30000);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as { status?: string; data?: { title?: string; screenshot?: { url?: string } } } | null;
  // A bot wall ("Just a moment…", "Performing security verification") isn't a useful picture.
  const title = data?.data?.title || "";
  if (/just a moment|security verification|attention required|access denied|captcha|are you a robot/i.test(title)) return null;
  const shot = data?.status === "success" ? data.data?.screenshot?.url : undefined;
  return shot ? storeImage(env, shot) : null;
}

/** The page's og:image / twitter:image, or its icon. */
async function fromPage(env: Env, url: string): Promise<{ key: string; kind: "preview" | "icon" } | null> {
  const res = await fetchWithTimeout(url, 10000, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (res && res.ok && (res.headers.get("Content-Type") || "").includes("html")) {
    const html = (await res.text()).slice(0, 400_000);
    const base = res.url || url;
    const meta = (name: string) =>
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"))?.[1];
    const og = meta("og:image") || meta("twitter:image");
    if (og) {
      const key = await storeImage(env, new URL(og.replace(/&amp;/g, "&"), base).toString());
      if (key) return { key, kind: "preview" };
    }
    const icon = html.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i)?.[1];
    if (icon) {
      const key = await storeImage(env, new URL(icon.replace(/&amp;/g, "&"), base).toString());
      if (key) return { key, kind: "icon" };
    }
  }
  // Last resort: Google's public site-icon service (sees only the domain).
  const host = new URL(url).hostname;
  const key = await storeImage(env, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`);
  return key ? { key, kind: "icon" } : null;
}

/** Captures a thumbnail for one link and saves it on the link. Never throws. */
export async function refreshLinkImage(env: Env, linkId: string): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT url, image_key FROM links WHERE id = ?").bind(linkId).first<{ url: string; image_key: string }>();
    if (!row) return;
    // Mark as in progress so parallel page loads don't start the same capture.
    await env.DB.prepare("UPDATE links SET image_kind = 'working' WHERE id = ?").bind(linkId).run();
    let key = await screenshot(env, row.url);
    let kind = key ? "screenshot" : "";
    if (!key) {
      const alt = await fromPage(env, row.url);
      key = alt?.key ?? null;
      kind = alt?.kind ?? "none";
    }
    await env.DB.prepare("UPDATE links SET image_key = ?, image_kind = ? WHERE id = ?").bind(key ?? "", kind, linkId).run();
    if (row.image_key && row.image_key !== key) await env.MEDIA.delete(row.image_key);
  } catch (e) {
    console.error("link thumbnail failed", e);
    await env.DB.prepare("UPDATE links SET image_kind = 'none' WHERE id = ?").bind(linkId).run().catch(() => {});
  }
}
