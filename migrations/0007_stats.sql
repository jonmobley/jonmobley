-- Privacy-friendly site stats: daily counts only, no IP addresses, no cookies.
CREATE TABLE stats_daily (
  day TEXT NOT NULL,        -- YYYY-MM-DD (America/New_York)
  kind TEXT NOT NULL,       -- human | ai_live | ai_index | ai_train | search | bot
  name TEXT NOT NULL,       -- traffic source for people (Google, ChatGPT…), bot name otherwise
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, name, path)
);
-- One row per visitor per day, keyed by a one-way hash that changes every day.
CREATE TABLE stats_visitors (
  day TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (day, hash)
);
