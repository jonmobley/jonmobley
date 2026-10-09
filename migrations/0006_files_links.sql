-- Files area (logos, insurance policies, contracts...) and quick-access links.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL,                 -- R2 media key
  type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  folder TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  setlist_id TEXT,
  expires TEXT NOT NULL DEFAULT '',  -- YYYY-MM-DD or '' (e.g. insurance policies)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
