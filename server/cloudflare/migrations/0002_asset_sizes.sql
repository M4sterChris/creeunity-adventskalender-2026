-- Private metadata needed for streaming byte ranges; never publicly listed.
CREATE TABLE IF NOT EXISTS asset_sizes (path TEXT PRIMARY KEY, size INTEGER NOT NULL CHECK(size >= 0));
