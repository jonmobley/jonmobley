-- Gear that isn't a trick: mics, speakers, cases, tables, lights, cables...
CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'working',   -- working | repair | wishlist | retired
  quantity INTEGER NOT NULL DEFAULT 1,
  location TEXT NOT NULL DEFAULT '',
  make_model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  cost REAL,
  purchase_url TEXT NOT NULL DEFAULT '',
  purchased_on TEXT NOT NULL DEFAULT '',    -- YYYY-MM-DD or ''
  tags TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Which equipment a show needs (JSON array of equipment ids).
ALTER TABLE setlists ADD COLUMN equipment TEXT NOT NULL DEFAULT '[]';
