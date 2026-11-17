-- Knowledge Stream anonymous feedback follows SPEC section 5.
-- Stores only an HMAC hash of the anonymous client id, never the raw id.

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos (id),
  client_hash TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('helpful', 'wrong_category')),
  created_at TEXT NOT NULL,
  UNIQUE (video_id, client_hash, feedback_type)
);

CREATE INDEX idx_feedback_client_created ON feedback (client_hash, created_at);
