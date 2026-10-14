-- Social: Jon's online presence (YouTube, Instagram, Facebook, Google, LinkedIn, the website).
-- Chats belong to a space so Backstage and Social keep separate chat histories.
ALTER TABLE chats ADD COLUMN space TEXT NOT NULL DEFAULT 'backstage';

-- One row per platform. `config` holds the handle/ids and any tokens (JSON, server-only).
CREATE TABLE social_accounts (
  platform TEXT PRIMARY KEY,         -- website | youtube | instagram | facebook | google | linkedin
  config TEXT NOT NULL DEFAULT '{}',
  last_sync INTEGER,
  last_error TEXT NOT NULL DEFAULT ''
);

-- A daily snapshot per platform, so trends build up over time.
CREATE TABLE social_stats (
  platform TEXT NOT NULL,
  day TEXT NOT NULL,                 -- YYYY-MM-DD
  followers INTEGER,                 -- subscribers / followers / reviews count for Google
  views INTEGER,                     -- lifetime views (YouTube) or visitors that day (website)
  posts INTEGER,                     -- videos / posts count
  extra TEXT NOT NULL DEFAULT '{}',  -- platform-specific numbers (rating, top videos…)
  PRIMARY KEY (platform, day)
);

-- Drafts, scheduled and posted posts. `platforms` is a JSON list; `media` a JSON list of media keys.
CREATE TABLE social_posts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '[]',
  media TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | posted
  scheduled_at INTEGER,               -- ms; when to post
  posted_at INTEGER,
  post_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX social_posts_when ON social_posts (status, scheduled_at);

-- Messages, comments and reviews pulled in from the platforms.
CREATE TABLE social_inbox (
  id TEXT PRIMARY KEY,                -- platform:external id, so a re-sync never duplicates
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- comment | message | review | mention
  author TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',   -- e.g. the video it was left on
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new | done (answered elsewhere or nothing to do)
  replied INTEGER NOT NULL DEFAULT 0, -- Jon already replied on the platform
  suggested_reply TEXT NOT NULL DEFAULT ''
);
CREATE INDEX social_inbox_new ON social_inbox (status, at);

-- The approval queue: things the assistant proposes (a reply, a post, a profile fix) that Jon
-- approves or skips in one click. `extra` holds kind-specific details (platforms, media).
CREATE TABLE social_actions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- reply | post | task
  title TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',      -- the reply or post text (Jon can edit before approving)
  platform TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',      -- where to act (the comment, the profile settings page)
  inbox_id TEXT,
  when_at INTEGER,                    -- posts: when to post
  extra TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | done | skipped
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX social_actions_open ON social_actions (status, created_at);
