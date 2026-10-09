-- View-only share links for a set list, playlist or trick (e.g. for an assistant).
CREATE TABLE shares (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- setlist | playlist | trick
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX shares_item ON shares (kind, item_id);
