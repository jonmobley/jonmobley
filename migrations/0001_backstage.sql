-- Backstage: Jon's private trick library, set lists and playlists.
CREATE TABLE tricks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',      -- ready | learning | wishlist | retired
  effect TEXT NOT NULL DEFAULT '',           -- what the audience sees
  method TEXT NOT NULL DEFAULT '',           -- private: how it works
  props TEXT NOT NULL DEFAULT '',            -- what to pack
  reset TEXT NOT NULL DEFAULT '',            -- reset / prep notes
  duration_min REAL,
  location TEXT NOT NULL DEFAULT '',         -- which case / shelf
  source TEXT NOT NULL DEFAULT '',           -- where it came from
  cost REAL,
  audiences TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
  tags TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  links TEXT NOT NULL DEFAULT '[]',          -- JSON array of {label, url}
  images TEXT NOT NULL DEFAULT '[]',         -- JSON array of media keys
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE setlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',             -- YYYY-MM-DD or ''
  notes TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',          -- JSON array of {id, trick_id?, title?, duration_min?, notes?}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  setlist_id TEXT,
  tracks TEXT NOT NULL DEFAULT '[]',         -- JSON array of {id, title, artist?, url?, file_key?, duration_sec?, cue?, trick_id?}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempts_ip ON login_attempts (ip, at);
