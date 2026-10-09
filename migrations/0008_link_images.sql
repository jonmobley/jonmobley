-- Link thumbnails: the site's preview image (og:image), or its icon, copied into R2.
ALTER TABLE links ADD COLUMN image_key TEXT NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN image_kind TEXT NOT NULL DEFAULT '';   -- '' not tried yet | preview | icon | none
