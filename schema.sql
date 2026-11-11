-- Off Season leaderboard: one row per player (their best score).
CREATE TABLE IF NOT EXISTS scores (
  id      TEXT PRIMARY KEY,   -- public hash of the player's secret device id
  name    TEXT NOT NULL,
  faction TEXT NOT NULL,
  score   INTEGER NOT NULL,
  at      INTEGER NOT NULL    -- time of best score (ms since epoch)
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
