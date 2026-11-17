-- Send a (silent) status message after every check. On by default.
ALTER TABLE monitors ADD COLUMN notify_every INTEGER NOT NULL DEFAULT 1;
